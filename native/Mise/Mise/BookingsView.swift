import SwiftUI

// MARK: - Mise Bookings — CRM-бронирование столов
//
// Любой сотрудник создаёт бронь, все видят брони ресторана. Редактировать может автор
// и должностные лица (owner/manager). Навигация по дням — как в Manager.
// Поля гостя опциональны: имя, кол-во, время, телефон, стол, комментарий.

private let BK_ACCENT = BrandKit.bookings

// MARK: Статусы

private enum BkStatus: String, CaseIterable {
    case new, confirmed, arrived, late, cancelled
    var color: Color {
        switch self {
        case .new:       return BrandKit.manager
        case .confirmed: return BrandKit.analytics
        case .arrived:   return BrandKit.analytics
        case .late:      return BrandKit.stash
        case .cancelled: return BrandKit.accent
        }
    }
    var label: String {
        switch self {
        case .new:       return t("bk.stNew")
        case .confirmed: return t("bk.stConfirmed")
        case .arrived:   return t("bk.stArrived")
        case .late:      return t("bk.stLate")
        case .cancelled: return t("bk.stCancelled")
        }
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
    var rangeLoading = false
    var allBookings: [Booking] = []    // все брони для гостей-лояльности
    var allBookingsLoaded = false

    init(rid: String) { self.rid = rid }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

    func load() async {
        loading = true
        defer { loading = false }
        if let rows = try? await DB.from("bookings").select()
            .eq("booking_date", key(currentDate))
            .order("booking_time").list(Booking.self) {
            bookings = rows.sorted {
                ($0.booking_time ?? "~", $0.created_by_name ?? "") < ($1.booking_time ?? "~", $1.created_by_name ?? "")
            }
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
    func loadAllBookings() async {
        guard !allBookingsLoaded else { return }
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
        if let rows = try? await DB.from("bookings").select("booking_date")
            .gte("booking_date", key(first)).lte("booking_date", key(last)).list(BookingDay.self) {
            monthDays = Set(rows.compactMap { $0.booking_date })
        }
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
        var values: [String: Any] = [
            "booking_date": b.booking_date ?? key(currentDate),
            "status": b.status ?? "new",
        ]
        values["booking_time"] = b.booking_time ?? NSNull()
        values["guest_name"] = b.guest_name ?? NSNull()
        values["guests_count"] = b.guests_count ?? NSNull()
        values["phone"] = b.phone ?? NSNull()
        values["table_label"] = b.table_label ?? NSNull()
        values["note"] = b.note ?? NSNull()

        if isNew {
            values["created_by"] = b.created_by ?? NSNull()
            values["created_by_name"] = b.created_by_name ?? NSNull()
            try? await DB.from("bookings").insert(values).run()
            await Notify.send(type: "booking", title: "Новая бронь", body: notifyBody(b),
                              audience: ["managers": true], data: ["module": "bookings"])
        } else {
            values["updated_at"] = ISO8601DateFormatter().string(from: Date())
            try? await DB.from("bookings").update(values).eq("id", b.id).run()
        }
        await load()
        await loadMonth()
        allBookingsLoaded = false // invalidate cache
    }

    func setStatus(_ b: Booking, status: String) async {
        try? await DB.from("bookings").update(["status": status]).eq("id", b.id).run()
        await load()
        await loadMonth()
        allBookingsLoaded = false
    }

    /// Краткий текст пуша по брони: «Анна · 4 гостя · 19:30 · стол 5».
    private func notifyBody(_ b: Booking) -> String {
        var parts: [String] = []
        if let n = b.guest_name, !n.isEmpty { parts.append(n) }
        if let g = b.guests_count { parts.append("\(g)") }
        if let tm = b.booking_time, !tm.isEmpty { parts.append(tm) }
        if let tbl = b.table_label, !tbl.isEmpty { parts.append("стол \(tbl)") }
        let day = b.booking_date ?? key(Date())
        if day != key(Date()) { parts.append(day) }
        return parts.isEmpty ? "Добавлена бронь" : parts.joined(separator: " · ")
    }

    func delete(_ b: Booking) async {
        try? await DB.from("bookings").delete().eq("id", b.id).run()
        await load()
        await loadMonth()
        allBookingsLoaded = false
    }
}

// MARK: - Гостевой профиль (агрегат)

struct GuestProfile: Identifiable {
    let id: String       // нормализованный ключ: телефон-цифры или lowercase-имя
    let displayName: String
    let phone: String?
    var visitCount: Int
    var lastVisitDate: String?   // "yyyy-MM-dd"
    var totalGuests: Int
    var bookings: [Booking]
}

// MARK: Экран

struct BookingsView: View {
    @Environment(AppModel.self) private var app
    @State private var m: BookingsModel?
    @State private var editing: Booking?
    @State private var showEditor = false
    @State private var showGuests = false
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
            other.status != "cancelled"
        }.count
    }

    private func guestKey(_ b: Booking) -> String {
        let phone = (b.phone ?? "").filter { $0.isNumber }
        if !phone.isEmpty { return phone }
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
                                ProgressView().tint(BK_ACCENT).frame(maxWidth: .infinity).padding(.top, 40)
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
                                ProgressView().tint(BK_ACCENT).frame(maxWidth: .infinity).padding(.top, 40)
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
                .sheet(isPresented: $showEditor) {
                    BookingEditor(
                        booking: editing,
                        defaultDate: m.key(m.currentDate),
                        canDelete: editing != nil && (editing.map(canEdit) ?? false),
                        onSave: { b, isNew in Task { await m.save(b, isNew: isNew) } },
                        onDelete: { b in Task { await m.delete(b) } },
                        author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner"))
                    )
                }
                .sheet(isPresented: $showGuests) {
                    GuestsView(m: m)
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
                                status: "new",
                                created_by: app.staff?.id ?? b.created_by,
                                created_by_name: app.staff?.name ?? b.created_by_name
                            )
                            Task { await m.save(copy, isNew: true) }
                        }
                    }
                    Button(t("cancel"), role: .cancel) {}
                } message: {
                    Text(t("bk.duplicateFor") + ": " + (duplicating.map { _ in m.key(duplicateDate) } ?? ""))
                }

            } else {
                Color.miseBg
            }
        }
        .task {
            if m == nil, let rid = app.restaurant?.id {
                let model = BookingsModel(rid: rid); m = model
                async let l: () = model.load()
                async let lm: () = model.loadMonth()
                async let lr: () = loadInitialRange(model)
                _ = await (l, lm, lr)
            }
        }
        .onChange(of: selectedRange) { _, _ in
            if let m { Task { await refreshRange(m) } }
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
        BookingCard(b: b, editable: canEdit(b), pastVisits: visits) {
            if canEdit(b) { editing = b; showEditor = true }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            // Свайп вправо — «Arrived»
            if canEdit(b) {
                Button {
                    Task { await m.setStatus(b, status: "arrived") }
                } label: {
                    Label(t("bk.markArrived"), systemImage: "checkmark.circle.fill")
                }
                .tint(BrandKit.analytics)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            // Полный свайп влево — удалить
            if canEdit(b) {
                Button(role: .destructive) {
                    Task { await m.delete(b) }
                } label: {
                    Label(t("bk.delete"), systemImage: "trash")
                }
                // Частичный свайп влево — опоздал
                Button {
                    Task { await m.setStatus(b, status: "late") }
                } label: {
                    Label(t("bk.markLate"), systemImage: "clock.badge.exclamationmark")
                }
                .tint(BrandKit.stash)
            }
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
                    editing = b; showEditor = true
                } label: {
                    Label(t("edit"), systemImage: "pencil")
                }
                Button(role: .destructive) {
                    Task { await m.delete(b) }
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
            editing = nil; showEditor = true
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
        let first = cal.date(from: cal.dateComponents([.year, .month], from: m.visibleMonth))!
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
    let onTap: () -> Void

    @State private var showPhoneMenu = false

    private var st: BkStatus { BkStatus(rawValue: b.status ?? "new") ?? .new }

    var body: some View {
        Button(action: onTap) {
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
                    Text(st.label).font(.system(size: 11, weight: .bold)).foregroundStyle(st.color)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(st.color.opacity(0.16), in: Capsule())
                    if !editable {
                        Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(.primary.opacity(0.25))
                    }
                }
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(st == .cancelled ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(!editable)
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

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var phone = ""
    @State private var guests = ""
    @State private var table = ""
    @State private var note = ""
    @State private var status = "new"
    @State private var hasTime = false
    @State private var time = Date()
    @State private var confirmDelete = false

    private var isNew: Bool { booking == nil }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("bk.secGuest")) {
                        field(t("bk.name"), text: $name)
                        field(t("bk.phone"), text: $phone).keyboardType(.phonePad)
                        field(t("bk.guests"), text: $guests).keyboardType(.numberPad)
                    }
                    Section(t("bk.secBooking")) {
                        Toggle(t("bk.setTime"), isOn: $hasTime).tint(BK_ACCENT)
                        if hasTime {
                            DatePicker(t("bk.time"), selection: $time, displayedComponents: .hourAndMinute)
                        }
                        field(t("bk.table"), text: $table)
                    }
                    Section(t("bk.status")) {
                        Picker(t("bk.status"), selection: $status) {
                            ForEach(BkStatus.allCases, id: \.rawValue) { s in
                                Text(s.label).tag(s.rawValue)
                            }
                        }.pickerStyle(.segmented)
                    }
                    Section(t("bk.note")) {
                        TextField(t("bk.notePh"), text: $note, axis: .vertical).lineLimit(2...5)
                    }
                    if canDelete, let b = booking {
                        Section {
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label(t("bk.delete"), systemImage: "trash")
                            }
                            .confirmationDialog(t("bk.delete"), isPresented: $confirmDelete, titleVisibility: .visible) {
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
        guard let b = booking else { return }
        name = b.guest_name ?? ""
        phone = b.phone ?? ""
        guests = b.guests_count.map(String.init) ?? ""
        table = b.table_label ?? ""
        note = b.note ?? ""
        status = b.status ?? "new"
        if let ts = b.booking_time, let parsed = Self.timeFmt.date(from: ts) {
            hasTime = true; time = parsed
        }
    }

    private func commit() {
        let trimmed = { (s: String) -> String? in
            let v = s.trimmingCharacters(in: .whitespacesAndNewlines); return v.isEmpty ? nil : v
        }
        let b = Booking(
            id: booking?.id ?? "",
            booking_date: booking?.booking_date ?? defaultDate,
            booking_time: hasTime ? Self.timeFmt.string(from: time) : nil,
            guest_name: trimmed(name),
            guests_count: Int(guests.trimmingCharacters(in: .whitespaces)),
            phone: trimmed(phone),
            table_label: trimmed(table),
            note: trimmed(note),
            status: status,
            created_by: booking?.created_by ?? author.0,
            created_by_name: booking?.created_by_name ?? author.1
        )
        onSave(b, isNew)
        dismiss()
    }

    private static let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}
