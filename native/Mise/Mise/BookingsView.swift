import SwiftUI

// MARK: - Mise Bookings — CRM-бронирование столов
//
// Любой сотрудник создаёт бронь, все видят брони ресторана. Редактировать может автор
// и должностные лица (owner/manager). Навигация по дням — как в Manager.
// Поля гостя опциональны: имя, кол-во, время, телефон, стол, комментарий.

private let BK_ACCENT = BrandKit.bookings

// MARK: Статусы
//
// 3 бакета максимум (было 6 — юзер-фидбек: слишком много вариаций на floor). Сырые
// значения в БД (text, без CHECK) не трогаем ради истории/аналитики/веб-паритета —
// "new"/"confirmed" схлопываются в .waiting, "no_show" схлопывается в .cancelled
// (причина различается флагом «Гость не пришёл» в редакторе, не отдельной пилюлей).
// «Опаздывает» больше не ручной статус — авто-бейдж по времени поверх .waiting
// (см. BookingCard.badgeLabel/badgeColor).

enum BkBucket: String, CaseIterable {
    case waiting, arrived, cancelled
    var color: Color {
        switch self {
        case .waiting:   return BrandKit.manager
        case .arrived:   return BrandKit.analytics
        case .cancelled: return BrandKit.accent
        }
    }
    var label: String {
        switch self {
        case .waiting:   return t("bk.stWaiting")
        case .arrived:   return t("bk.stArrived")
        case .cancelled: return t("bk.stCancelled")
        }
    }
}

func bkBucket(for raw: String?) -> BkBucket? {
    guard let raw, !raw.isEmpty else { return nil }
    switch raw {
    case "arrived": return .arrived
    case "cancelled", "no_show": return .cancelled
    default: return .waiting   // new, confirmed, легаси "late" — всё в ожидании
    }
}

// MARK: - Диапазон

enum BookingRange: Int, CaseIterable {
    case today, tomorrow, week
    var label: String {
        switch self {
        case .today:    return t("bk.today")
        case .tomorrow: return t("bk.tomorrow")
        case .week:     return t("bk.week")
        }
    }
}

// MARK: - Модель

private nonisolated struct BookingDay: Codable, Sendable { let booking_date: String? }

@MainActor
@Observable
final class BookingsModel {
    let rid: String
    var currentDate = Date()           // выбранный день (показываем его брони)
    var visibleMonth = Date()          // месяц, открытый в календаре
    var bookings: [Booking] = []
    var rangeBookings: [Booking] = []  // для режима Today/Tomorrow/Week
    var monthDays: Set<String> = []    // дни месяца, где есть брони (точки в календаре)
    var loading = true
    var saving = false
    var toast: String?
    var rangeLoading = false
    var allBookings: [Booking] = []    // все брони для гостей-лояльности
    var allBookingsLoaded = false

    init(rid: String) { self.rid = rid }

    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

    func load() async {
        loading = true
        defer { loading = false }
        // Только при успехе перезаписываем — сбой на refresh не должен стирать данные.
        do {
            let rows = try await DB.from("bookings").select()
                .eq("booking_date", key(currentDate))
                .order("booking_time").list(Booking.self)
            // Сортировка: брони без времени — в конец.
            bookings = rows.sorted {
                ($0.booking_time ?? "~", $0.created_by_name ?? "") < ($1.booking_time ?? "~", $1.created_by_name ?? "")
            }
        } catch {
            // Причина найдена (юзер-фидбек 2026-07-22): pull-to-refresh отменяет предыдущий
            // Task, URLSession кидает .cancelled — не настоящая ошибка сети, молчим.
            let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
            if !cancelled && !bookings.isEmpty { flash(t("refreshFailed")) }
        }
    }

    /// Загрузить брони за диапазон (today/tomorrow/week).
    func loadRange(from: Date, to: Date) async {
        rangeLoading = true
        defer { rangeLoading = false }
        if let rows = try? await DB.from("bookings").select()
            .gte("booking_date", key(from))
            .lte("booking_date", key(to))
            .order("booking_date")
            .order("booking_time").list(Booking.self) {
            rangeBookings = rows
        }
    }

    /// Загрузить все брони для CRM гостей (~12 месяцев назад).
    /// force: игнорировать флаг «уже загружено» — для pull-to-refresh (брони с других
    /// устройств не попадают в этот кеш иначе до перезапуска приложения).
    func loadAllBookings(force: Bool = false) async {
        guard !allBookingsLoaded || force else { return }
        let cal = Calendar.current
        let from = cal.date(byAdding: .month, value: -12, to: Date()) ?? Date()
        if let rows = try? await DB.from("bookings").select()
            .gte("booking_date", key(from))
            .order("booking_date").list(Booking.self) {
            allBookings = rows
            allBookingsLoaded = true
        }
    }

    /// Дни текущего месяца календаря, где есть брони — для точек-пометок.
    func loadMonth() async {
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: visibleMonth)) ?? visibleMonth
        let next = cal.date(byAdding: .month, value: 1, to: first) ?? first
        let last = cal.date(byAdding: .day, value: -1, to: next) ?? next
        guard let rows = try? await DB.from("bookings").select("booking_date")
            .gte("booking_date", key(first)).lte("booking_date", key(last)).list(BookingDay.self) else { return }
        monthDays = Set(rows.compactMap { $0.booking_date })
    }

    func selectDay(_ d: Date) async {
        currentDate = d
        await load()
    }

    func changeMonth(_ dir: Int) async {
        visibleMonth = Calendar.current.date(byAdding: .month, value: dir, to: visibleMonth) ?? visibleMonth
        await loadMonth()
    }

    func save(_ b: Booking, isNew: Bool) async {
        guard !saving else { return }
        saving = true; defer { saving = false }
        var values: [String: Any] = [
            "booking_date": b.booking_date ?? key(currentDate),
        ]
        // status NOT NULL DEFAULT 'new' в БД. Новая бронь создаётся БЕЗ статуса (пусть БД
        // поставит default) — статус ставится свайпом. При РЕДАКТИРОВАНИИ статус шлём всегда,
        // включая явный сброс на «нет статуса» из пикера (nil → "new", это одно и то же для БД) —
        // иначе выбор «Нет статуса» в редакторе молча не сохранялся.
        if isNew {
            if let status = b.status { values["status"] = status }
        } else {
            values["status"] = b.status ?? "new"
        }
        values["booking_time"] = b.booking_time ?? NSNull()
        values["guest_name"] = b.guest_name ?? NSNull()
        values["guests_count"] = b.guests_count ?? NSNull()
        values["phone"] = b.phone ?? NSNull()
        values["table_label"] = b.table_label ?? NSNull()
        values["note"] = b.note ?? NSNull()

        if isNew {
            values["created_by"] = b.created_by ?? NSNull()
            values["created_by_name"] = b.created_by_name ?? NSNull()
            do {
                try await DB.from("bookings").insert(values).run()
            } catch {
                flash(t("bk.saveFailed"))
                return
            }
            let segs = notifyBodySegments(b)
            // booking_date в data — чтобы тап по уведомлению открыл ИМЕННО эту дату в Bookings,
            // а не просто модуль (юзер-фидбек 2026-07-22).
            await Notify.send(type: "booking", title: t("bk.new"), body: notifyBody(b),
                              audience: ["managers": true], titleKey: "notify.bookingTitle",
                              bodySegments: segs.isEmpty ? nil : segs,
                              data: ["module": "bookings", "booking_date": b.booking_date ?? ""])
        } else {
            values["updated_at"] = ISO8601DateFormatter().string(from: Date())
            do {
                try await DB.from("bookings").update(values).eq("id", b.id).run()
            } catch {
                flash(t("bk.saveFailed"))
                return
            }
        }
        await load()
        await loadMonth()
        allBookingsLoaded = false // invalidate cache
    }

    /// Краткий текст пуша по брони: «Анна · 4 гостя · 19:30 · стол 5». Литерал-фолбэк
    /// (язык отправителя) — реальный рендер получателю уходит через notifyBodySegments.
    private func notifyBody(_ b: Booking) -> String {
        var parts: [String] = []
        if let n = b.guest_name, !n.isEmpty { parts.append(n) }
        if let g = b.guests_count { parts.append("\(g)") }
        if let tm = b.booking_time, !tm.isEmpty { parts.append(tm) }
        if let tbl = b.table_label, !tbl.isEmpty { parts.append("\(t("bk.table")) \(tbl)") }
        let day = b.booking_date ?? key(Date())
        if day != key(Date()) { parts.append(day) }
        return parts.isEmpty ? t("bk.new") : parts.joined(separator: " · ")
    }

    /// То же самое, но «стол» переводится сервером на язык получателя — остальные части
    /// (имя, число, время, дата) без лейбла, переводить нечего.
    private func notifyBodySegments(_ b: Booking) -> [[String: String]] {
        var segs: [[String: String]] = []
        if let n = b.guest_name, !n.isEmpty { segs.append(["value": n]) }
        if let g = b.guests_count { segs.append(["value": "\(g)"]) }
        if let tm = b.booking_time, !tm.isEmpty { segs.append(["value": tm]) }
        if let tbl = b.table_label, !tbl.isEmpty { segs.append(["key": "notify.bookingTable", "value": tbl]) }
        let day = b.booking_date ?? key(Date())
        if day != key(Date()) { segs.append(["value": day]) }
        return segs
    }

    func delete(_ b: Booking) async {
        do {
            try await DB.from("bookings").delete().eq("id", b.id).run()
        } catch {
            flash(t("bk.saveFailed"))
            return
        }
        await load()
        await loadMonth()
        allBookingsLoaded = false
    }

    /// Свайп-отметка статуса (пришёл/опаздывает) — мгновенно локально (в обоих списках —
    /// «сегодня» и текущий диапазон, иначе на вкладках Завтра/Неделя статус визуально не
    /// меняется), затем на сервер; при сбое — откат + тост, а не тихое рассинхронивание.
    func setStatus(_ b: Booking, to status: String) async {
        let prevStatus = b.status
        if let i = bookings.firstIndex(where: { $0.id == b.id }) { bookings[i].status = status }
        if let i = rangeBookings.firstIndex(where: { $0.id == b.id }) { rangeBookings[i].status = status }
        do {
            try await DB.from("bookings").update([
                "status": status, "updated_at": ISO8601DateFormatter().string(from: Date()),
            ]).eq("id", b.id).run()
        } catch {
            if let i = bookings.firstIndex(where: { $0.id == b.id }) { bookings[i].status = prevStatus }
            if let i = rangeBookings.firstIndex(where: { $0.id == b.id }) { rangeBookings[i].status = prevStatus }
            flash(t("bk.saveFailed"))
        }
    }
}

// MARK: - Гостевой профиль (агрегат)

struct GuestProfile: Identifiable, Hashable {
    let id: String       // нормализованный ключ: телефон-цифры или lowercase-имя
    var displayName: String
    var phone: String?
    var visitCount: Int
    var noShowCount: Int = 0
    var lastVisitDate: String?   // "yyyy-MM-dd"
    var totalGuests: Int
    var bookings: [Booking]

    // Hashable по id — нужен для navigationDestination(item:); полное сравнение по всем
    // полям (включая массив bookings) избыточно, id уже уникально идентифицирует гостя.
    static func == (lhs: GuestProfile, rhs: GuestProfile) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Цель редактора брони (identity для .sheet(item:))
//
// Раньше редактор открывался через ДВА отдельных @State (editing + showEditor) — .sheet(isPresented:)
// не переоткрывает/не обновляет контент, если true уже установлено (или два State применяются не
// атомарно) → тап иногда не открывал ничего или открывал пустую «новую» бронь вместо нужной.
// .sheet(item:) с Identifiable-целью пересоздаёт шит при каждой смене цели — гонки нет.
private enum BookingEditorTarget: Identifiable {
    case create(name: String?, phone: String?, visits: Int, noShows: Int)
    case edit(Booking)

    var id: String {
        switch self {
        case .create: return "new"
        case .edit(let b): return b.id
        }
    }
}

// MARK: Экран

struct BookingsView: View {
    @Environment(AppModel.self) private var app
    @State private var m: BookingsModel?
    @State private var editorTarget: BookingEditorTarget?
    @State private var pendingDelete: Booking?
    @State private var showGuests = false
    @State private var pendingNewBooking: (name: String?, phone: String?, visits: Int, noShows: Int)?
    @State private var selectedRange: BookingRange = .today
    @State private var searchText = ""
    @State private var duplicating: Booking?
    @State private var duplicateDate = Date()
    @State private var showDuplicateDialog = false

    private func canEdit(_ b: Booking) -> Bool {
        app.isOfficial || (b.created_by != nil && b.created_by == app.staff?.id)
    }

    // Брони текущего дня, отфильтрованные по поиску
    private func filteredBookings(_ m: BookingsModel) -> [Booking] {
        guard !searchText.isEmpty else { return m.bookings }
        let q = searchText.lowercased()
        return m.bookings.filter {
            ($0.guest_name ?? "").lowercased().contains(q) ||
            ($0.phone ?? "").lowercased().contains(q)
        }
    }

    // Брони диапазона, отфильтрованные по поиску
    private func filteredRange(_ m: BookingsModel) -> [Booking] {
        guard !searchText.isEmpty else { return m.rangeBookings }
        let q = searchText.lowercased()
        return m.rangeBookings.filter {
            ($0.guest_name ?? "").lowercased().contains(q) ||
            ($0.phone ?? "").lowercased().contains(q)
        }
    }

    // Сгруппированные по дням брони для режима Week
    private func groupedByDay(_ bookings: [Booking]) -> [(String, [Booking])] {
        var dict: [(String, [Booking])] = []
        var seen: [String: Int] = [:]
        for b in bookings {
            let day = b.booking_date ?? ""
            if let idx = seen[day] {
                dict[idx].1.append(b)
            } else {
                seen[day] = dict.count
                dict.append((day, [b]))
            }
        }
        return dict
    }

    // Кол-во предыдущих визитов гостя по текущей брони
    private func pastVisitCount(for b: Booking, in allBookings: [Booking]) -> Int {
        guard let bDate = b.booking_date else { return 0 }
        let key = guestKey(b)
        return allBookings.filter { other in
            guestKey(other) == key &&
            (other.booking_date ?? "") < bDate &&
            other.status != "cancelled" && other.status != "no_show"
        }.count
    }

    // Последние 9 цифр (не весь номер) — иначе один и тот же гость, введённый один раз как
    // «079…» (местный формат) и второй раз как «+4179…» (международный), давал два разных
    // ключа, и его история/визиты рассыпались на два профиля.
    private func guestKey(_ b: Booking) -> String {
        let phone = (b.phone ?? "").filter { $0.isNumber }
        if !phone.isEmpty { return String(phone.suffix(9)) }
        return (b.guest_name ?? "").lowercased().trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        Group {
            if let m {
                VStack(spacing: 0) {
                    // Поисковая строка
                    searchBar

                    // Сегментированный контроль
                    rangePicker(m)

                    AppTabPage(refresh: {
                        await m.load()
                        await m.loadMonth()
                        await refreshRange(m)
                    }) {
                        if selectedRange == .today || selectedRange == .tomorrow {
                            // Calendar mode only for "today" to keep calendar navigation working
                            if selectedRange == .today {
                                BookingCalendar(m: m)
                                dayHeader(m, bookings: filteredBookings(m))
                            } else {
                                tomorrowHeader(m)
                            }
                            if (selectedRange == .today ? m.loading : m.rangeLoading) &&
                               (selectedRange == .today ? m.bookings : m.rangeBookings).isEmpty {
                                RowListSkeleton(rows: 4)
                            } else {
                                let list = selectedRange == .today ? filteredBookings(m) : filteredRange(m)
                                if list.isEmpty {
                                    emptyState
                                } else {
                                    ForEach(list) { b in
                                        bookingRow(b, m: m)
                                    }
                                }
                            }
                        } else {
                            // Week view — grouped by day
                            if m.rangeLoading && m.rangeBookings.isEmpty {
                                RowListSkeleton(rows: 4)
                            } else {
                                let groups = groupedByDay(filteredRange(m))
                                if groups.isEmpty {
                                    emptyState
                                } else {
                                    ForEach(groups, id: \.0) { day, bks in
                                        weekDayHeader(day: day, bookings: bks)
                                        ForEach(bks) { b in
                                            bookingRow(b, m: m)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    VStack(spacing: 12) {
                        guestsButton(m)
                        addButton
                    }
                }
                .overlay(alignment: .bottom) {
                    if let toast = m.toast {
                        Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 60)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: m.toast)
                .confirmationDialog(t("bk.delete"),
                                    isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                    titleVisibility: .hidden) {
                    Button(t("bk.delete"), role: .destructive) {
                        if let b = pendingDelete { deleteAndSync(b, m: m) }; pendingDelete = nil
                    }
                    Button(t("cancel"), role: .cancel) { pendingDelete = nil }
                }
                .sheet(item: $editorTarget) { target in
                    switch target {
                    case .edit(let b):
                        BookingEditor(
                            booking: b,
                            defaultDate: m.key(m.currentDate),
                            canDelete: canEdit(b),
                            onSave: { nb, isNew in saveAndSync(nb, isNew: isNew, m: m) },
                            onDelete: { nb in deleteAndSync(nb, m: m) },
                            author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner"))
                        )
                    case .create(let name, let phone, let visits, let noShows):
                        BookingEditor(
                            booking: nil,
                            defaultDate: m.key(m.currentDate),
                            canDelete: false,
                            onSave: { nb, isNew in saveAndSync(nb, isNew: isNew, m: m) },
                            onDelete: { _ in },
                            author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner")),
                            prefillName: name,
                            prefillPhone: phone,
                            prefillVisits: visits,
                            prefillNoShows: noShows
                        )
                    }
                }
                // onDismiss вместо ручного asyncAfter — единственный dismiss (не каскад из
                // нескольких вложенных sheet) и editor открывается сразу как только система
                // подтвердила, что шит гостей реально закрылся (Apple-паттерн present-after-dismiss).
                .sheet(isPresented: $showGuests, onDismiss: {
                    if let p = pendingNewBooking {
                        pendingNewBooking = nil
                        editorTarget = .create(name: p.name, phone: p.phone, visits: p.visits, noShows: p.noShows)
                    }
                }) {
                    GuestsView(m: m, onNewBooking: { name, phone, visits, noShows in
                        pendingNewBooking = (name, phone, visits, noShows)
                        showGuests = false
                    })
                }
                .confirmationDialog(t("bk.duplicateTitle"), isPresented: $showDuplicateDialog, titleVisibility: .visible) {
                    Button(t("bk.duplicate")) {
                        if let b = duplicating {
                            let newId = UUID().uuidString
                            let copy = Booking(
                                id: newId,
                                booking_date: m.key(duplicateDate),
                                booking_time: b.booking_time,
                                guest_name: b.guest_name,
                                guests_count: b.guests_count,
                                phone: b.phone,
                                table_label: b.table_label,
                                note: b.note,
                                status: nil,
                                created_by: app.staff?.id ?? b.created_by,
                                created_by_name: app.staff?.name ?? b.created_by_name
                            )
                            saveAndSync(copy, isNew: true, m: m)
                        }
                    }
                    Button(t("cancel"), role: .cancel) {}
                } message: {
                    Text(t("bk.duplicateFor") + ": " + (duplicating.map { _ in m.key(duplicateDate) } ?? ""))
                }

            } else {
                BookingsSkeleton()
            }
        }
        .tabEdgeSwipe(tabs: ["only"], selection: .constant("only"),
                      onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
        .task {
            if m == nil, let rid = app.restaurant?.id {
                let model = BookingsModel(rid: rid); m = model
                // Переход из уведомления (см. AppModel.routeNotification) — прыгаем на дату
                // ДО первой загрузки, чтобы не грузить «сегодня» впустую и сразу открыть нужное.
                if let dateStr = app.pendingBookingsDate, let d = Self.parseDateKey(dateStr) {
                    app.pendingBookingsDate = nil
                    model.currentDate = d
                }
                async let l: () = model.load()
                async let lm: () = model.loadMonth()
                async let lr: () = loadInitialRange(model)
                // Нужно не только для «карточки гостя» — бейдж «постоянный гость» на строке
                // брони тоже читает allBookings, иначе он не появляется до захода в Guests.
                async let la: () = model.loadAllBookings()
                _ = await (l, lm, lr, la)
            }
        }
        .onChange(of: selectedRange) { _, _ in
            if let m { Task { await refreshRange(m) } }
        }
        // Bookings уже открыт (модель жива) и прилетело новое уведомление — прыгаем на лету.
        .onChange(of: app.pendingBookingsDate) { _, dateStr in
            guard let dateStr, let d = Self.parseDateKey(dateStr), let m else { return }
            app.pendingBookingsDate = nil
            selectedRange = .today
            Task { await m.selectDay(d) }
        }
    }

    private static func parseDateKey(_ s: String) -> Date? {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        return df.date(from: s)
    }

    // save()/delete() всегда обновляют только «сегодня» — если открыта Завтра/Неделя,
    // без этого правка/удаление брони не видны на экране до ручного pull-to-refresh.
    private func saveAndSync(_ b: Booking, isNew: Bool, m: BookingsModel) {
        Task {
            await m.save(b, isNew: isNew)
            if selectedRange != .today { await refreshRange(m) }
        }
    }

    private func deleteAndSync(_ b: Booking, m: BookingsModel) {
        Task {
            await m.delete(b)
            if selectedRange != .today { await refreshRange(m) }
        }
    }

    private func loadInitialRange(_ m: BookingsModel) async {
        let cal = Calendar.current
        let today = Date()
        let in7 = cal.date(byAdding: .day, value: 6, to: today) ?? today
        await m.loadRange(from: today, to: in7)
    }

    private func refreshRange(_ m: BookingsModel) async {
        let cal = Calendar.current
        let today = Date()
        switch selectedRange {
        case .today:
            await m.load()
        case .tomorrow:
            let tomorrow = cal.date(byAdding: .day, value: 1, to: today) ?? today
            await m.loadRange(from: tomorrow, to: tomorrow)
        case .week:
            let in7 = cal.date(byAdding: .day, value: 6, to: today) ?? today
            await m.loadRange(from: today, to: in7)
        }
    }

    // MARK: - Строка брони со свайпами

    @ViewBuilder
    private func bookingRow(_ b: Booking, m: BookingsModel) -> some View {
        let visits = pastVisitCount(for: b, in: m.allBookings)
        // WhatsApp-свайп: вправо=пришёл, неполный влево=[отменить][удалить], полный влево=удалить (с подтв.).
        // «Опаздывает» больше не ручной статус (см. BkBucket) — свайпом больше не ставится.
        SwipeActionRow(
            leading: canEdit(b) ? SwipeAction(label: t("bk.stArrived"), systemImage: "checkmark.circle.fill", tint: BrandKit.analytics) {
                Task { await m.setStatus(b, to: "arrived") }
            } : nil,
            trailing: canEdit(b) ? [
                SwipeAction(label: t("bk.stCancelled"), systemImage: "xmark.circle.fill", tint: BrandKit.stash) {
                    Task { await m.setStatus(b, to: "cancelled") }
                },
                SwipeAction(label: t("bk.delete"), systemImage: "trash.fill", tint: BrandKit.menu) {
                    pendingDelete = b
                },
            ] : [],
            onTap: canEdit(b) ? { editorTarget = .edit(b) } : nil
        ) {
            BookingCard(b: b, editable: canEdit(b), pastVisits: visits)
        }
        .contextMenu {
            if canEdit(b) {
                Button {
                    duplicating = b
                    duplicateDate = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
                    showDuplicateDialog = true
                } label: {
                    Label(t("bk.duplicate"), systemImage: "doc.on.doc")
                }
                Button {
                    editorTarget = .edit(b)
                } label: {
                    Label(t("edit"), systemImage: "pencil")
                }
                Button(role: .destructive) {
                    deleteAndSync(b, m: m)
                } label: {
                    Label(t("bk.delete"), systemImage: "trash")
                }
            }
        }
    }

    // MARK: - Вспомогательные View

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4))
            TextField(t("bk.searchPh"), text: $searchText)
                .font(.system(size: 15))
            if !searchText.isEmpty {
                Button { searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 4)
    }

    private func rangePicker(_ m: BookingsModel) -> some View {
        Picker("", selection: $selectedRange) {
            ForEach(BookingRange.allCases, id: \.self) { r in
                Text(r.label).tag(r)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16).padding(.vertical, 6)
    }

    private func dayHeader(_ m: BookingsModel, bookings: [Booking]) -> some View {
        HStack(spacing: 6) {
            Text(dateTitle(m.currentDate)).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
            Text(dow(m.currentDate)).font(.system(size: 13, weight: .medium)).foregroundStyle(BK_ACCENT)
            Spacer()
            if !bookings.isEmpty {
                let total = bookings.compactMap { $0.guests_count }.reduce(0, +)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(bookings.count)").font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
                    if total > 0 {
                        Text(t("bk.totalGuests", ["n": "\(total)"]))
                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3))
                    }
                }
            }
        }
        .padding(.horizontal, 4).padding(.top, 4)
    }

    private func tomorrowHeader(_ m: BookingsModel) -> some View {
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let bks = filteredRange(m)
        return HStack(spacing: 6) {
            Text(dateTitle(tomorrow)).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
            Text(dow(tomorrow)).font(.system(size: 13, weight: .medium)).foregroundStyle(BK_ACCENT)
            Spacer()
            if !bks.isEmpty {
                let total = bks.compactMap { $0.guests_count }.reduce(0, +)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(bks.count)").font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
                    if total > 0 {
                        Text(t("bk.totalGuests", ["n": "\(total)"]))
                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3))
                    }
                }
            }
        }
        .padding(.horizontal, 4).padding(.top, 4)
    }

    private func weekDayHeader(day: String, bookings: [Booking]) -> some View {
        let total = bookings.compactMap { $0.guests_count }.reduce(0, +)
        return HStack(spacing: 6) {
            Text(formatWeekDay(day)).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
            Spacer()
            Text("\(bookings.count)").font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
            if total > 0 {
                Text(t("bk.totalGuests", ["n": "\(total)"]))
                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3))
            }
        }
        .padding(.horizontal, 4).padding(.top, 8).padding(.bottom, 2)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "calendar.badge.clock").font(.system(size: 34, weight: .light)).foregroundStyle(BK_ACCENT)
            Text(t("bk.empty")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
            Text(t("bk.emptyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 40)
    }

    private func guestsButton(_ m: BookingsModel) -> some View {
        Button {
            Task { await m.loadAllBookings() }
            showGuests = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            Image(systemName: "person.2").font(.system(size: 19, weight: .semibold)).foregroundStyle(BK_ACCENT)
                .frame(width: 46, height: 46)
                .background(.ultraThinMaterial, in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        }
        .padding(.trailing, 20)
    }

    private var addButton: some View {
        Button {
            editorTarget = .create(name: nil, phone: nil, visits: 0, noShows: 0)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        } label: {
            Image(systemName: "plus").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                .frame(width: 58, height: 58).background(BK_ACCENT, in: Circle())
                .shadow(color: BK_ACCENT.opacity(0.4), radius: 12, y: 4)
        }
        .padding(.horizontal, 20).padding(.bottom, 4)
    }

    private func dateTitle(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "d MMMM"; f.locale = Locale(identifier: I18n.code)
        return f.string(from: d)
    }
    private func dow(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEEE"; f.locale = Locale(identifier: I18n.code)
        return f.string(from: d).capitalized
    }
    private func formatWeekDay(_ dayStr: String) -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        guard let d = df.date(from: dayStr) else { return dayStr }
        let out = DateFormatter(); out.dateFormat = "EEEE, d MMM"; out.locale = Locale(identifier: I18n.code)
        return out.string(from: d).capitalized
    }
}

// MARK: Календарь месяца с пометками дней

private struct BookingCalendar: View {
    @Bindable var m: BookingsModel
    private let cal = Calendar.current

    var body: some View {
        VStack(spacing: 10) {
            header
            weekdayRow
            grid
        }
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var header: some View {
        HStack {
            Button { Task { await m.changeMonth(-1) } } label: {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.primary).frame(width: 34, height: 34).background(.ultraThinMaterial, in: Circle())
            }
            Spacer()
            Text(monthTitle).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
            Spacer()
            Button { Task { await m.changeMonth(1) } } label: {
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.primary).frame(width: 34, height: 34).background(.ultraThinMaterial, in: Circle())
            }
        }
    }

    private var weekdayRow: some View {
        HStack(spacing: 0) {
            ForEach(orderedWeekdaySymbols, id: \.self) { s in
                Text(s).font(.system(size: 11, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
        return LazyVGrid(columns: cols, spacing: 6) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                if let d = day { cell(d) } else { Color.clear.frame(height: 38) }
            }
        }
    }

    private func cell(_ d: Date) -> some View {
        let key = m.key(d)
        let selected = key == m.key(m.currentDate)
        let today = key == m.key(Date())
        let hasBooking = m.monthDays.contains(key)
        return Button { Task { await m.selectDay(d) } } label: {
            VStack(spacing: 2) {
                Text("\(cal.component(.day, from: d))")
                    .font(.system(size: 15, weight: selected ? .bold : .regular))
                    .foregroundStyle(selected ? .white : (today ? BK_ACCENT : .primary))
                    .frame(width: 32, height: 32)
                    .background(selected ? BK_ACCENT : .clear, in: Circle())
                    .overlay(today && !selected ? Circle().strokeBorder(BK_ACCENT.opacity(0.5), lineWidth: 1) : nil)
                Circle().fill(hasBooking ? BK_ACCENT : .clear).frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    // Дни месяца с ведущими пустыми ячейками до первого дня недели.
    private var cells: [Date?] {
        let first = cal.date(from: cal.dateComponents([.year, .month], from: m.visibleMonth)) ?? Date()
        let count = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let weekday = cal.component(.weekday, from: first)
        let leading = (weekday - cal.firstWeekday + 7) % 7
        var out: [Date?] = Array(repeating: nil, count: leading)
        for i in 0..<count { out.append(cal.date(byAdding: .day, value: i, to: first)) }
        return out
    }

    private var orderedWeekdaySymbols: [String] {
        let f = DateFormatter(); f.locale = Locale(identifier: I18n.code)
        let syms = f.veryShortStandaloneWeekdaySymbols ?? ["S","M","T","W","T","F","S"]
        let start = cal.firstWeekday - 1
        return (0..<7).map { syms[(start + $0) % 7] }
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.locale = Locale(identifier: I18n.code); f.dateFormat = "LLLL yyyy"
        return f.string(from: m.visibleMonth).capitalized
    }
}

// MARK: Карточка брони

private struct BookingCard: View {
    let b: Booking
    let editable: Bool
    let pastVisits: Int

    @Environment(AppModel.self) private var app
    @State private var showPhoneMenu = false

    private var bucket: BkBucket? { bkBucket(for: b.status) }

    // Авто-«опаздывает»: ожидание + бронь сегодня + время уже прошло на 15+ минут.
    // Не хранится в БД — чисто вычисляемый бейдж, чтобы не плодить ручной статус.
    //
    // dayStartHour (операционный день заведения, по умолчанию 6:00) — бронь на 00:00-05:59
    // это "поздний вечер вчера" для заведений, работающих допоздна, а не начало нового дня
    // (юзер-фидбек 2026-07-22): без этого 00:00 сразу считалась просроченной.
    private var isOverdue: Bool {
        guard bucket == .waiting, let timeStr = b.booking_time, let dateStr = b.booking_date else { return false }
        let cal = Calendar.current
        let dateDf = DateFormatter(); dateDf.dateFormat = "yyyy-MM-dd"; dateDf.locale = Locale(identifier: "en_US_POSIX")
        guard var day = dateDf.date(from: dateStr) else { return false }
        let hour = Int(timeStr.prefix(2)) ?? 0
        if hour < app.dayStartHour { day = cal.date(byAdding: .day, value: 1, to: day) ?? day }
        let timeDf = DateFormatter(); timeDf.dateFormat = "HH:mm"; timeDf.locale = Locale(identifier: "en_US_POSIX")
        guard let timeOnly = timeDf.date(from: timeStr) else { return false }
        let comps = cal.dateComponents([.hour, .minute], from: timeOnly)
        guard let dt = cal.date(bySettingHour: comps.hour ?? 0, minute: comps.minute ?? 0, second: 0, of: day) else { return false }
        return Date().timeIntervalSince(dt) > 15 * 60
    }
    private var badgeLabel: String { isOverdue ? t("bk.stLate") : (bucket?.label ?? "") }
    private var badgeColor: Color { isOverdue ? BrandKit.stash : (bucket?.color ?? .clear) }

    var body: some View {
        // Тап по ряду обрабатывает SwipeActionRow (onTap) — здесь просто контент,
        // не Button (голый .gesture на драге в SwipeActionRow иначе крадёт тап).
        HStack(spacing: 12) {
                VStack(spacing: 2) {
                    Text(b.booking_time ?? "—").font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                    if let n = b.guests_count {
                        HStack(spacing: 2) {
                            Image(systemName: "person.2.fill").font(.system(size: 9))
                            Text("\(n)").font(.system(size: 12, weight: .semibold))
                        }.foregroundStyle(.primary.opacity(0.5))
                    }
                }
                .frame(width: 56)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(b.guest_name?.isEmpty == false ? b.guest_name! : t("bk.noName"))
                            .font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                        // Badge гостевой лояльности
                        if pastVisits >= 5 {
                            Text(t("gs.regularBadge"))
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(BK_ACCENT, in: Capsule())
                        } else if pastVisits >= 3 {
                            Text(t("gs.visitBadge", ["n": "\(pastVisits + 1)"]))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(BK_ACCENT)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(BK_ACCENT.opacity(0.15), in: Capsule())
                        }
                    }
                    HStack(spacing: 10) {
                        if let tbl = b.table_label, !tbl.isEmpty {
                            label("tablecells", tbl)
                        }
                        if let ph = b.phone, !ph.isEmpty {
                            // Телефон — нажимаемый
                            Button {
                                showPhoneMenu = true
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "phone.fill").font(.system(size: 10))
                                    Text(ph).font(.system(size: 12))
                                }.foregroundStyle(BK_ACCENT)
                            }
                            .buttonStyle(.plain)
                            .confirmationDialog(t("bk.contactGuest"), isPresented: $showPhoneMenu, titleVisibility: .visible) {
                                let digits = ph.filter { $0.isNumber }
                                if !digits.isEmpty {
                                    Button(t("bk.callAction")) {
                                        if let url = URL(string: "tel:\(digits)") {
                                            UIApplication.shared.open(url)
                                        }
                                    }
                                    Button("WhatsApp") {
                                        if let url = URL(string: "https://wa.me/\(digits)") {
                                            UIApplication.shared.open(url)
                                        }
                                    }
                                }
                                Button(t("cancel"), role: .cancel) {}
                            }
                        }
                    }
                    if let note = b.note, !note.isEmpty {
                        Text(note).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5)).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 6) {
                    if bucket != nil {
                        Text(badgeLabel).font(.system(size: 11, weight: .bold)).foregroundStyle(badgeColor)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(badgeColor.opacity(0.16), in: Capsule())
                    }
                    if !editable {
                        Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(.primary.opacity(0.25))
                    }
                }
            }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .opacity(bucket == .cancelled ? 0.55 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func label(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 10))
            Text(text).font(.system(size: 12))
        }.foregroundStyle(.primary.opacity(0.55))
    }
}

// MARK: Редактор брони

private struct BookingEditor: View {
    let booking: Booking?
    let defaultDate: String
    let canDelete: Bool
    let onSave: (Booking, Bool) -> Void
    let onDelete: (Booking) -> Void
    let author: (String, String)
    var prefillName: String? = nil     // префилл для «Новая бронь» из карточки гостя
    var prefillPhone: String? = nil
    var prefillVisits: Int = 0         // визитов/неявок у гостя — подсказка при создании из карточки
    var prefillNoShows: Int = 0

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var lastName = ""   // только для isNew — см. bk.secGuest
    @State private var phone = ""
    @State private var guests = ""
    @State private var table = ""
    @State private var note = ""
    @State private var status: String? = nil    // nil = без статуса (новая бронь)
    @State private var hasTime = false
    @State private var time = Date()
    @State private var bookingDate = Date()
    @State private var confirmDelete = false

    private var isNew: Bool { booking == nil }

    // 3-бакетный Picker поверх сырого status-string (см. bkBucket) — раздельный "не пришёл"
    // только виден когда выбрана «Отменена», не занимает отдельный сегмент.
    private var statusBucket: Binding<BkBucket> {
        Binding(
            get: { bkBucket(for: status) ?? .waiting },
            set: { newBucket in
                switch newBucket {
                case .waiting:   status = "new"
                case .arrived:   status = "arrived"
                case .cancelled: status = (status == "no_show") ? "no_show" : "cancelled"
                }
            }
        )
    }
    private var noShowFlag: Binding<Bool> {
        Binding(get: { status == "no_show" }, set: { flag in status = flag ? "no_show" : "cancelled" })
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    // Выбор даты — только для НОВОЙ брони, сверху формы: не всегда удобно
                    // сначала мотать календарь на нужный день, потом жать «+» (юзер-фидбек 2026-07-22).
                    // При редактировании дата брони не меняется здесь — остаётся как есть.
                    if isNew {
                        Section {
                            DatePicker(t("bk.date"), selection: $bookingDate, displayedComponents: .date)
                        }
                    }
                    Section(t("bk.secGuest")) {
                        // Имя/фамилия раздельно только при СОЗДАНИИ (юзер-фидбек 2026-07-22) —
                        // фамилия заодно уходит в профиль гостя (guest_notes), не только в бронь.
                        // При редактировании существующей брони — как раньше, одно поле (не
                        // разбираем уже сохранённую строку эвристикой, это ненадёжно).
                        if isNew {
                            field(t("bk.firstName"), text: $name)
                            field(t("gs.lastName"), text: $lastName)
                        } else {
                            field(t("bk.name"), text: $name)
                        }
                        field(t("bk.phone"), text: $phone).keyboardType(.phonePad)
                        // Подсказка сотруднику при создании брони из карточки известного гостя —
                        // для брони «с нуля» (без выбора гостя) не показываем, данных ещё нет.
                        if isNew && (prefillVisits > 0 || prefillNoShows > 0) {
                            HStack(spacing: 6) {
                                if prefillVisits >= 3 {
                                    Label(t("gs.regularBadge"), systemImage: "star.fill")
                                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.bookings)
                                }
                                if prefillVisits > 0 {
                                    Text(t("gs.visits", ["n": "\(prefillVisits)"]))
                                        .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.55))
                                }
                                if prefillNoShows > 0 {
                                    Text(t("gs.noShows", ["n": "\(prefillNoShows)"]))
                                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.accent)
                                }
                            }
                        }
                    }
                    // Кол-во гостей — свойство БРОНИ (меняется от визита к визиту), а не гостя
                    // (имя/телефон) — раньше стояло в секции «Гость», путало.
                    Section(t("bk.secBooking")) {
                        field(t("bk.guests"), text: $guests).keyboardType(.numberPad)
                        // Кастомный Binding вместо .onChange(of: hasTime) — .onChange ловил и
                        // программную установку hasTime=true из prime() при открытии УЖЕ
                        // сохранённой брони, затирая распарсенное время округлённым «сейчас»
                        // ещё до того как юзер успевал покрутить колесо (юзер-фидбог 2026-07-22:
                        // «выставляю время а оно не меняется»). Округление до ближайших 15 минут
                        // нужно только когда юзер САМ включает тумблер, не при программном prime().
                        Toggle(t("bk.setTime"), isOn: Binding(
                            get: { hasTime },
                            set: { on in
                                hasTime = on
                                guard on else { return }
                                let cal = Calendar.current
                                let mins = cal.component(.minute, from: Date())
                                let rounded = ((mins / 15) + 1) * 15
                                time = cal.date(byAdding: .minute, value: rounded - mins, to: Date()) ?? Date()
                            }
                        ).animation()).tint(BK_ACCENT)
                        if hasTime {
                            DatePicker(t("bk.time"), selection: $time, displayedComponents: .hourAndMinute)
                        }
                        field(t("bk.table"), text: $table)
                    }
                    // Статус задаётся только при редактировании существующей брони
                    // (новая создаётся без статуса; пришёл/опоздал ставятся свайпом).
                    if !isNew {
                        Section(t("bk.status")) {
                            Picker(t("bk.status"), selection: statusBucket) {
                                ForEach(BkBucket.allCases, id: \.rawValue) { b in
                                    Text(b.label).tag(b)
                                }
                            }.pickerStyle(.segmented)
                            if statusBucket.wrappedValue == .cancelled {
                                Toggle(t("bk.stNoShow"), isOn: noShowFlag).tint(BK_ACCENT)
                            }
                        }
                    }
                    Section(t("bk.note")) {
                        TextField(t("bk.notePh"), text: $note, axis: .vertical).lineLimit(2...5)
                    }
                    if canDelete, let b = booking {
                        Section {
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label(t("bk.delete"), systemImage: "trash")
                            }
                            .confirmationDialog(t("bk.delete"), isPresented: $confirmDelete, titleVisibility: .hidden) {
                                Button(t("bk.delete"), role: .destructive) { onDelete(b); dismiss() }
                                Button(t("cancel"), role: .cancel) {}
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .tint(BK_ACCENT)
            }
            .navigationTitle(isNew ? t("bk.new") : t("bk.edit")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("bk.save")) { commit() }.bold() }
            }
        }
        .onAppear(perform: prime)
    }

    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
    }

    private func prime() {
        guard let b = booking else {
            // Новая бронь: префилл из карточки гостя (имя/телефон), статуса нет.
            name = prefillName ?? ""
            phone = prefillPhone ?? ""
            bookingDate = Self.dateFmt.date(from: defaultDate) ?? Date()
            return
        }
        name = b.guest_name ?? ""
        phone = b.phone ?? ""
        guests = b.guests_count.map(String.init) ?? ""
        table = b.table_label ?? ""
        note = b.note ?? ""
        status = (b.status?.isEmpty == false) ? b.status : nil
        if let ts = b.booking_time, let parsed = Self.timeFmt.date(from: ts) {
            hasTime = true; time = parsed
        }
    }

    private func commit() {
        let trimmed = { (s: String) -> String? in
            let v = s.trimmingCharacters(in: .whitespacesAndNewlines); return v.isEmpty ? nil : v
        }
        // При создании — имя и фамилия из раздельных полей склеиваются в guest_name (бронь
        // хранит одну строку); фамилия ОТДЕЛЬНО уходит в профиль гостя (guest_notes) ниже.
        let fullName = isNew
            ? [name, lastName].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
            : name
        let b = Booking(
            id: booking?.id ?? "",
            booking_date: booking?.booking_date ?? Self.dateFmt.string(from: bookingDate),
            booking_time: hasTime ? Self.timeFmt.string(from: time) : nil,
            guest_name: trimmed(fullName),
            guests_count: Int(guests.trimmingCharacters(in: .whitespaces)),
            phone: trimmed(phone),
            table_label: trimmed(table),
            note: trimmed(note),
            status: isNew ? nil : status,
            created_by: booking?.created_by ?? author.0,
            created_by_name: booking?.created_by_name ?? author.1
        )
        onSave(b, isNew)
        if isNew {
            let lastTrim = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
            let digits = phone.filter { $0.isNumber }
            let key = !digits.isEmpty ? digits : fullName.lowercased().trimmingCharacters(in: .whitespaces)
            if !lastTrim.isEmpty, !key.isEmpty {
                Task { try? await DB.from("guest_notes").upsert(["guest_key": key, "last_name": lastTrim], onConflict: "restaurant_id,guest_key").run() }
            }
        }
        dismiss()
    }

    private static let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    private static let dateFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}
