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

    var dayError: String?
    var rangeError: String?
    var monthError: String?
    var guestsError: String?
    var guestsLoading = false
    private var dayGeneration = 0
    private var rangeGeneration = 0
    private var monthGeneration = 0
    private var guestsGeneration = 0
    private var loadedDay: String?
    private var loadedRange: String?
    private var loadedMonth: String?
    private var statusGeneration: [String: Int] = [:]
    private var statusTasks: [String: Task<Void, Never>] = [:]
    private struct StatusSnapshot { let value: String? }
    private var confirmedStatus: [String: StatusSnapshot] = [:]
    private var pendingStatus: [String: String] = [:]
    private var statusEpoch = 0
    private var statusWrittenEpoch: [String: Int] = [:]

    private func isCancelled(_ error: Error) -> Bool {
        Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    private func withPendingStatus(_ rows: [Booking], since readEpoch: Int) -> [Booking] {
        rows.map { row in
            var copy = row
            if let status = pendingStatus[row.id] { copy.status = status }
            else if (statusWrittenEpoch[row.id] ?? 0) > readEpoch { copy.status = confirmedStatus[row.id]?.value }
            else { confirmedStatus[row.id] = StatusSnapshot(value: row.status) }
            return copy
        }
    }

    func load(force: Bool = false) async {
        dayGeneration += 1
        let request = dayGeneration
        let readEpoch = statusEpoch
        let day = key(currentDate)
        if loadedDay != day { bookings = []; loadedDay = day }
        loading = true; dayError = nil
        defer { if request == dayGeneration { loading = false } }
        do {
            let query = DB.from("bookings").select().eq("booking_date", day).order("booking_time")
            if force { query.fresh() }
            let rows = try await query.list(Booking.self)
            guard request == dayGeneration, !Task.isCancelled else { return }
            bookings = withPendingStatus(rows.sorted {
                ($0.booking_time ?? "~", $0.created_by_name ?? "") < ($1.booking_time ?? "~", $1.created_by_name ?? "")
            }, since: readEpoch)
        } catch {
            guard request == dayGeneration, !isCancelled(error) else { return }
            dayError = error.localizedDescription
        }
    }

    func loadRange(from: Date, to: Date, force: Bool = false) async {
        rangeGeneration += 1
        let request = rangeGeneration
        let readEpoch = statusEpoch
        let fromKey = key(from), toKey = key(to), scope = key(from) + ":" + key(to)
        if loadedRange != scope { rangeBookings = []; loadedRange = scope }
        rangeLoading = true; rangeError = nil
        defer { if request == rangeGeneration { rangeLoading = false } }
        do {
            let query = DB.from("bookings").select().gte("booking_date", fromKey).lte("booking_date", toKey)
                .order("booking_date").order("booking_time")
            if force { query.fresh() }
            let rows = try await query.list(Booking.self)
            guard request == rangeGeneration, !Task.isCancelled else { return }
            rangeBookings = withPendingStatus(rows, since: readEpoch)
        } catch {
            guard request == rangeGeneration, !isCancelled(error) else { return }
            rangeError = error.localizedDescription
        }
    }

    /// Complete history, fetched through a tenant-scoped cursor RPC; never a cached 12-month subset.
    func loadAllBookings(force: Bool = false) async {
        guard !allBookingsLoaded || force else { return }
        guestsGeneration += 1
        let request = guestsGeneration
        let readEpoch = statusEpoch
        guestsLoading = true; guestsError = nil
        defer { if request == guestsGeneration { guestsLoading = false } }
        nonisolated struct Page: Decodable { let data: [Booking]? }
        var rows: [Booking] = [], seen = Set<String>()
        var afterDate: String?, afterId: String?
        do {
            while true {
                var args: [String: Any] = ["p_limit": 500]
                if let afterDate, let afterId { args["p_after_date"] = afterDate; args["p_after_id"] = afterId }
                let data = try await API.dbRequest(["op": "rpc", "fn": "booking_history_page", "args": args])
                guard request == guestsGeneration, !Task.isCancelled else { return }
                guard let page = try JSONDecoder().decode(Page.self, from: data).data else { throw bookingError("refreshFailed") }
                let fresh = page.filter { seen.insert($0.id).inserted }
                rows.append(contentsOf: fresh)
                if page.count < 500 { break }
                guard !fresh.isEmpty, let last = page.last, let date = last.booking_date,
                      afterDate == nil || (date, last.id.lowercased()) < (afterDate!, afterId!.lowercased()) else {
                    throw bookingError("refreshFailed")
                }
                afterDate = date; afterId = last.id
            }
            guard request == guestsGeneration, !Task.isCancelled else { return }
            allBookings = withPendingStatus(rows, since: readEpoch)
            allBookingsLoaded = true
        } catch {
            guard request == guestsGeneration, !isCancelled(error) else { return }
            guestsError = error.localizedDescription
        }
    }

    func loadMonth(force: Bool = false) async {
        monthGeneration += 1
        let request = monthGeneration
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: visibleMonth)) ?? visibleMonth
        let last = cal.date(byAdding: DateComponents(month: 1, day: -1), to: first) ?? first
        let scope = key(first)
        if loadedMonth != scope { monthDays = []; loadedMonth = scope }
        monthError = nil
        do {
            let query = DB.from("bookings").select("booking_date").gte("booking_date", scope).lte("booking_date", key(last))
            if force { query.fresh() }
            let rows = try await query.list(BookingDay.self)
            guard request == monthGeneration, !Task.isCancelled else { return }
            monthDays = Set(rows.compactMap { $0.booking_date })
        } catch {
            guard request == monthGeneration, !isCancelled(error) else { return }
            monthError = error.localizedDescription
        }
    }

    func selectDay(_ date: Date) async {
        let changedMonth = String(key(visibleMonth).prefix(7)) != String(key(date).prefix(7))
        currentDate = date; visibleMonth = date
        if changedMonth {
            async let day: Void = load()
            async let month: Void = loadMonth()
            await day; await month
        } else { await load() }
    }

    func changeMonth(_ dir: Int) async {
        visibleMonth = Calendar.current.date(byAdding: .month, value: dir, to: visibleMonth) ?? visibleMonth
        await loadMonth()
    }

    private func invalidateGuestData(cancelReads: Bool = true) {
        if cancelReads { guestsGeneration += 1; guestsLoading = false }
        allBookingsLoaded = false
    }

    private func invalidateVisibleReads() {
        dayGeneration += 1; rangeGeneration += 1; monthGeneration += 1
        loading = false; rangeLoading = false
    }

    private func publish(_ row: Booking) {
        let display = withPendingStatus([row], since: statusEpoch)[0]
        if let index = allBookings.firstIndex(where: { $0.id == row.id }) { allBookings[index] = display }
        else { allBookings.append(display) }
        let day = key(currentDate)
        if loadedDay != day { bookings = []; loadedDay = day }
        bookings.removeAll { $0.id == row.id }
        if row.booking_date == day { bookings.append(display) }
        bookings.sort { ($0.booking_time ?? "~", $0.created_by_name ?? "") < ($1.booking_time ?? "~", $1.created_by_name ?? "") }
        rangeBookings.removeAll { $0.id == row.id }
        if let scope = loadedRange?.split(separator: ":"), scope.count == 2, let day = row.booking_date,
           day >= scope[0] && day <= scope[1] { rangeBookings.append(display) }
        rangeBookings.sort { ($0.booking_date ?? "", $0.booking_time ?? "~") < ($1.booking_date ?? "", $1.booking_time ?? "~") }
    }

    private func refreshVisibleInBackground() {
        Task { @MainActor in
            async let day: Void = load(force: true)
            async let month: Void = loadMonth(force: true)
            await day; await month
        }
    }

    @discardableResult
    func save(_ booking: Booking, isNew: Bool, lastName: String? = nil) async throws -> Booking {
        guard !saving else { throw bookingError("saving") }
        guard UUID(uuidString: booking.id) != nil else { throw bookingError("bk.saveFailed") }
        saving = true; defer { saving = false }
        var values: [String: Any] = ["booking_date": booking.booking_date ?? key(currentDate)]
        if !isNew || booking.status != nil { values["status"] = booking.status ?? "new" }
        values["booking_time"] = booking.booking_time ?? NSNull()
        values["guest_name"] = booking.guest_name ?? NSNull()
        values["guests_count"] = booking.guests_count ?? NSNull()
        values["phone"] = booking.phone ?? NSNull()
        values["table_label"] = booking.table_label ?? NSNull()
        values["note"] = booking.note ?? NSNull()
        let persisted: Booking?
        if isNew {
            values["id"] = booking.id.lowercased()
            if let key = booking.guest_key {
                guard bookingHasCanonicalGuestKey(key) else { throw bookingError("gs.refreshProfile") }
                values["guest_key"] = key
            }
            persisted = try await DB.from("bookings").insert(values).single(Booking.self)
        } else {
            values["updated_at"] = ISO8601DateFormatter().string(from: Date())
            persisted = try await DB.from("bookings").update(values).eq("id", booking.id).single(Booking.self)
        }
        guard let persisted else { throw bookingError("bk.saveFailed") }
        // Retry uses the same booking ID if this second, profile-only step fails.
        if isNew, let lastName, !lastName.isEmpty {
            try await BookingGuestService.update(key: bookingGuestKey(persisted), profile: ["last_name": lastName])
        }
        invalidateVisibleReads(); invalidateGuestData(); publish(persisted)
        if isNew {
            let segments = notifyBodySegments(persisted)
            Task { @MainActor in
                await Notify.send(type: "booking", title: t("bk.new"), body: notifyBody(persisted),
                                  audience: ["managers": true], titleKey: "notify.bookingTitle",
                                  bodySegments: segments.isEmpty ? nil : segments,
                                  data: ["module": "bookings", "booking_date": persisted.booking_date ?? "", "booking_id": persisted.id])
            }
        }
        refreshVisibleInBackground()
        return persisted
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

    func delete(_ booking: Booking) async throws {
        try await DB.from("bookings").delete().eq("id", booking.id).run()
        invalidateVisibleReads(); invalidateGuestData()
        allBookings.removeAll { $0.id == booking.id }
        bookings.removeAll { $0.id == booking.id }
        rangeBookings.removeAll { $0.id == booking.id }
        refreshVisibleInBackground()
    }

    func deleteGuest(_ guest: GuestProfile) async throws {
        try await BookingGuestService.delete(key: guest.id)
        invalidateVisibleReads(); invalidateGuestData()
        allBookings.removeAll { bookingGuestKey($0) == guest.id }
        bookings.removeAll { bookingGuestKey($0) == guest.id }
        rangeBookings.removeAll { bookingGuestKey($0) == guest.id }
        refreshVisibleInBackground()
    }

    func guestDidUpdate(key: String, name: String?, phone: String?) {
        invalidateGuestData()
        func changed(_ rows: [Booking]) -> [Booking] {
            rows.map { row in
                guard bookingGuestKey(row) == key else { return row }
                var copy = row
                if let name { copy.guest_name = name.isEmpty ? nil : name }
                if let phone { copy.phone = phone.isEmpty ? nil : phone }
                return copy
            }
        }
        bookings = changed(bookings); rangeBookings = changed(rangeBookings); allBookings = changed(allBookings)
    }

    private func publishStatus(_ id: String, _ status: String?) {
        if let i = bookings.firstIndex(where: { $0.id == id }) { bookings[i].status = status }
        if let i = rangeBookings.firstIndex(where: { $0.id == id }) { rangeBookings[i].status = status }
        if let i = allBookings.firstIndex(where: { $0.id == id }) { allBookings[i].status = status }
    }

    /// Serialize writes per booking; a failed older action cannot undo a newer action.
    func setStatus(_ booking: Booking, to status: String) async {
        let id = booking.id
        let request = (statusGeneration[id] ?? 0) + 1
        statusGeneration[id] = request
        if confirmedStatus[id] == nil { confirmedStatus[id] = StatusSnapshot(value: booking.status) }
        pendingStatus[id] = status
        publishStatus(id, status)
        let previous = statusTasks[id]
        let task = Task { @MainActor in
            await previous?.value
            do {
                try await DB.from("bookings").update(["status": status, "updated_at": ISO8601DateFormatter().string(from: Date())])
                    .eq("id", id).run()
                confirmedStatus[id] = StatusSnapshot(value: status)
                statusEpoch += 1; statusWrittenEpoch[id] = statusEpoch
                invalidateGuestData(cancelReads: false)
            } catch {
                if statusGeneration[id] == request {
                    publishStatus(id, confirmedStatus[id]?.value)
                    flash(error.localizedDescription)
                }
            }
            if statusGeneration[id] == request { pendingStatus[id] = nil; statusTasks[id] = nil }
        }
        statusTasks[id] = task
        await task.value
    }

}

// MARK: - Гостевой профиль (агрегат)

struct GuestProfile: Identifiable, Hashable {
    let id: String       // стабильный guest_key; для старых read-only строк — полный телефон или id брони
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
    case create(name: String?, phone: String?, visits: Int, noShows: Int, guestKey: String?)
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
    @State private var pendingNewBooking: (name: String?, phone: String?, visits: Int, noShows: Int, guestKey: String)?
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
    private func pastVisitCount(for booking: Booking, in allBookings: [Booking]) -> Int {
        guard let date = booking.booking_date else { return 0 }
        let key = bookingGuestKey(booking), today = bookingDateKey(Date())
        return allBookings.filter {
            bookingGuestKey($0) == key && ($0.booking_date ?? "") < date && bookingIsVisit($0, today: today)
        }.count
    }

    private func defaultBookingDate(_ model: BookingsModel) -> Date {
        switch selectedRange {
        case .today: return model.currentDate
        case .tomorrow: return Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        case .week: return Date()
        }
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
                        async let month: Void = m.loadMonth(force: true)
                        await refreshRange(m, force: true)
                        await month
                    }, clearCacheOnRefresh: false) {
                        if let error = selectedRange == .today ? m.dayError : m.rangeError {
                            loadFailure(error) { Task { await refreshRange(m, force: true) } }
                        } else if selectedRange == .today, let error = m.monthError {
                            loadFailure(error) { Task { await m.loadMonth(force: true) } }
                        }
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
                                    if (selectedRange == .today ? m.dayError : m.rangeError) == nil { emptyState }
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
                                    if m.rangeError == nil { emptyState }
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
                        if let b = pendingDelete { requestDelete(b, m: m) }; pendingDelete = nil
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
                            onSave: { nb, isNew, lastName in try await saveAndSync(nb, isNew: isNew, lastName: lastName, m: m) },
                            onDelete: { nb in try await deleteAndSync(nb, m: m) },
                            author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner"))
                        )
                    case .create(let name, let phone, let visits, let noShows, let guestKey):
                        BookingEditor(
                            booking: nil,
                            defaultDate: m.key(defaultBookingDate(m)),
                            canDelete: false,
                            onSave: { nb, isNew, lastName in try await saveAndSync(nb, isNew: isNew, lastName: lastName, m: m) },
                            onDelete: { _ in },
                            author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner")),
                            prefillName: name,
                            prefillPhone: phone,
                            prefillVisits: visits,
                            prefillNoShows: noShows,
                            prefillGuestKey: guestKey
                        )
                    }
                }
                // onDismiss вместо ручного asyncAfter — единственный dismiss (не каскад из
                // нескольких вложенных sheet) и editor открывается сразу как только система
                // подтвердила, что шит гостей реально закрылся (Apple-паттерн present-after-dismiss).
                .sheet(isPresented: $showGuests, onDismiss: {
                    if let p = pendingNewBooking {
                        pendingNewBooking = nil
                        editorTarget = .create(name: p.name, phone: p.phone, visits: p.visits, noShows: p.noShows, guestKey: p.guestKey)
                    }
                }) {
                    GuestsView(m: m, onNewBooking: { name, phone, visits, noShows, guestKey in
                        pendingNewBooking = (name, phone, visits, noShows, guestKey)
                        showGuests = false
                    })
                }
                .confirmationDialog(t("bk.duplicateTitle"), isPresented: $showDuplicateDialog, titleVisibility: .visible) {
                    Button(t("bk.duplicate")) {
                        if let b = duplicating {
                            let newId = UUID().uuidString.lowercased()
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
                                created_by_name: app.staff?.name ?? b.created_by_name,
                                guest_key: b.guest_key
                            )
                            Task {
                                do { try await saveAndSync(copy, isNew: true, m: m) }
                                catch { m.flash(error.localizedDescription) }
                            }
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
                    model.currentDate = d; model.visibleMonth = d
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
    private func saveAndSync(_ booking: Booking, isNew: Bool, lastName: String? = nil, m: BookingsModel) async throws {
        try await m.save(booking, isNew: isNew, lastName: lastName)
        if selectedRange != .today { Task { await refreshRange(m, force: true) } }
    }

    private func deleteAndSync(_ booking: Booking, m: BookingsModel) async throws {
        try await m.delete(booking)
        if selectedRange != .today { Task { await refreshRange(m, force: true) } }
    }

    private func requestDelete(_ booking: Booking, m: BookingsModel) {
        Task { do { try await deleteAndSync(booking, m: m) } catch { m.flash(error.localizedDescription) } }
    }

    private func loadInitialRange(_ m: BookingsModel) async {
        let cal = Calendar.current
        let today = Date()
        let in7 = cal.date(byAdding: .day, value: 6, to: today) ?? today
        await m.loadRange(from: today, to: in7)
    }

    private func refreshRange(_ m: BookingsModel, force: Bool = false) async {
        let cal = Calendar.current
        let today = Date()
        switch selectedRange {
        case .today:
            await m.load(force: force)
        case .tomorrow:
            let tomorrow = cal.date(byAdding: .day, value: 1, to: today) ?? today
            await m.loadRange(from: tomorrow, to: tomorrow, force: force)
        case .week:
            let in7 = cal.date(byAdding: .day, value: 6, to: today) ?? today
            await m.loadRange(from: today, to: in7, force: force)
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
                    requestDelete(b, m: m)
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

    private func loadFailure(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Text(t("loadFailed")).font(.system(size: 15, weight: .semibold))
            Text(message).font(.system(size: 12)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button(t("retry"), action: retry).frame(minHeight: 44)
        }
        .padding(14).frame(maxWidth: .infinity)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .contain)
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
            editorTarget = .create(name: nil, phone: nil, visits: 0, noShows: 0, guestKey: nil)
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
    let onSave: (Booking, Bool, String?) async throws -> Void
    let onDelete: (Booking) async throws -> Void
    let author: (String, String)
    var prefillName: String? = nil     // префилл для «Новая бронь» из карточки гостя
    var prefillPhone: String? = nil
    var prefillVisits: Int = 0         // визитов/неявок у гостя — подсказка при создании из карточки
    var prefillNoShows: Int = 0
    var prefillGuestKey: String? = nil

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var lastName = ""   // только для isNew — см. bk.secGuest
    @State private var phone = ""
    @State private var guests = ""
    @State private var table = ""
    @State private var note = ""
    // Двойной тап «Сохранить» до закрытия шита создавал две брони (аудит дублей 2026-10-26).
    @State private var saveState = BookingSaveState()
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
                                Button(t("bk.delete"), role: .destructive) {
                                    Task { if await saveState.perform({ try await onDelete(b) }) { dismiss() } }
                                }
                                Button(t("cancel"), role: .cancel) {}
                            }
                        }
                    }
                }
                .disabled(saveState.saving)
                .scrollContentBackground(.hidden)
                .tint(BK_ACCENT)
            }
            .navigationTitle(isNew ? t("bk.new") : t("bk.edit")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() }.disabled(saveState.saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saveState.saving ? t("saving") : t("bk.save")) { commit() }.bold().disabled(saveState.saving) }
            }
        }
        .interactiveDismissDisabled(saveState.saving)
        .safeAreaInset(edge: .bottom) {
            if let error = saveState.error {
                Text(error).font(.system(size: 13)).foregroundStyle(.red).multilineTextAlignment(.center)
                    .padding(14).frame(maxWidth: .infinity).background(.regularMaterial)
                    .accessibilityIdentifier("booking-save-error")
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
        guard !saveState.saving else { return }
        let trimmedGuests = guests.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedGuests.isEmpty && (Int(trimmedGuests).map { $0 > 0 && $0 <= 2_147_483_647 } != true) {
            saveState.error = t("bk.invalidGuests"); return
        }
        let trimmed = { (s: String) -> String? in
            let v = s.trimmingCharacters(in: .whitespacesAndNewlines); return v.isEmpty ? nil : v
        }
        // При создании — имя и фамилия из раздельных полей склеиваются в guest_name (бронь
        // хранит одну строку); фамилия ОТДЕЛЬНО уходит в профиль гостя (guest_notes) ниже.
        let fullName = isNew
            ? [name, lastName].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
            : name
        let b = Booking(
            id: booking?.id ?? saveState.id,
            booking_date: booking?.booking_date ?? Self.dateFmt.string(from: bookingDate),
            booking_time: hasTime ? Self.timeFmt.string(from: time) : nil,
            guest_name: trimmed(fullName),
            guests_count: Int(guests.trimmingCharacters(in: .whitespaces)),
            phone: trimmed(phone),
            table_label: trimmed(table),
            note: trimmed(note),
            status: isNew ? nil : status,
            created_by: booking?.created_by ?? author.0,
            created_by_name: booking?.created_by_name ?? author.1,
            guest_key: booking?.guest_key ?? prefillGuestKey
        )
        let profileLastName = isNew ? lastName.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        Task {
            if await saveState.perform({ try await onSave(b, isNew, profileLastName) }) { dismiss() }
        }
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
