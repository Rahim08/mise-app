import SwiftUI

// MARK: - Mise Bookings — CRM-бронирование столов
//
// Любой сотрудник создаёт бронь, все видят брони ресторана. Редактировать может автор
// и должностные лица (owner/manager). Навигация по дням — как в Manager.
// Поля гостя опциональны: имя, кол-во, время, телефон, стол, комментарий.

private let BK_ACCENT = BrandKit.bookings

// MARK: Статусы

private enum BkStatus: String, CaseIterable {
    case new, confirmed, cancelled
    var color: Color {
        switch self {
        case .new:       return BrandKit.manager
        case .confirmed: return BrandKit.analytics
        case .cancelled: return BrandKit.accent
        }
    }
    var label: String {
        switch self {
        case .new:       return t("bk.stNew")
        case .confirmed: return t("bk.stConfirmed")
        case .cancelled: return t("bk.stCancelled")
        }
    }
}

// MARK: Модель

private nonisolated struct BookingDay: Codable, Sendable { let booking_date: String? }

@MainActor
@Observable
final class BookingsModel {
    let rid: String
    var currentDate = Date()           // выбранный день (показываем его брони)
    var visibleMonth = Date()          // месяц, открытый в календаре
    var bookings: [Booking] = []
    var monthDays: Set<String> = []    // дни месяца, где есть брони (точки в календаре)
    var loading = true

    init(rid: String) { self.rid = rid }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

    func load() async {
        loading = true
        defer { loading = false }
        let rows = (try? await DB.from("bookings").select()
            .eq("booking_date", key(currentDate))
            .order("booking_time").list(Booking.self)) ?? []
        // Сортировка: брони без времени — в конец.
        bookings = rows.sorted {
            ($0.booking_time ?? "~", $0.created_by_name ?? "") < ($1.booking_time ?? "~", $1.created_by_name ?? "")
        }
    }

    /// Дни текущего месяца календаря, где есть брони — для точек-пометок.
    func loadMonth() async {
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: visibleMonth)) ?? visibleMonth
        let next = cal.date(byAdding: .month, value: 1, to: first) ?? first
        let last = cal.date(byAdding: .day, value: -1, to: next) ?? next
        let rows = (try? await DB.from("bookings").select("booking_date")
            .gte("booking_date", key(first)).lte("booking_date", key(last)).list(BookingDay.self)) ?? []
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
    }

    /// Краткий текст пуша по брони: «Анна · 4 гостя · 19:30 · стол 5».
    private func notifyBody(_ b: Booking) -> String {
        var parts: [String] = []
        if let n = b.guest_name, !n.isEmpty { parts.append(n) }
        if let g = b.guests_count { parts.append("\(g)") }
        if let tm = b.booking_time, !tm.isEmpty { parts.append(tm) }
        if let tbl = b.table_label, !tbl.isEmpty { parts.append("стол \(tbl)") }
        let day = b.booking_date ?? key(currentDate)
        if day != key(Date()) { parts.append(day) }
        return parts.isEmpty ? "Добавлена бронь" : parts.joined(separator: " · ")
    }

    func delete(_ b: Booking) async {
        try? await DB.from("bookings").delete().eq("id", b.id).run()
        await load()
        await loadMonth()
    }
}

// MARK: Экран

struct BookingsView: View {
    @Environment(AppModel.self) private var app
    @State private var m: BookingsModel?
    @State private var editing: Booking?
    @State private var showEditor = false

    private func canEdit(_ b: Booking) -> Bool {
        app.isOfficial || (b.created_by != nil && b.created_by == app.staff?.id)
    }

    var body: some View {
        Group {
            if let m {
                AppTabPage(refresh: { await m.load(); await m.loadMonth() }) {
                    BookingCalendar(m: m)
                    dayHeader(m)
                    if m.loading && m.bookings.isEmpty {
                        ProgressView().tint(BK_ACCENT).frame(maxWidth: .infinity).padding(.top, 40)
                    } else if m.bookings.isEmpty {
                        emptyState
                    } else {
                        ForEach(m.bookings) { b in
                            BookingCard(b: b, editable: canEdit(b)) {
                                if canEdit(b) { editing = b; showEditor = true }
                            }
                        }
                    }
                }
                .overlay(alignment: .bottomTrailing) { addButton }
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
            } else {
                Color.miseBg
            }
        }
        .task {
            if m == nil, let rid = app.restaurant?.id {
                let model = BookingsModel(rid: rid); m = model
                await model.load(); await model.loadMonth()
            }
        }
    }

    private func dayHeader(_ m: BookingsModel) -> some View {
        HStack(spacing: 6) {
            Text(dateTitle(m.currentDate)).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
            Text(dow(m.currentDate)).font(.system(size: 13, weight: .medium)).foregroundStyle(BK_ACCENT)
            Spacer()
            if !m.bookings.isEmpty {
                Text("\(m.bookings.count)").font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
            }
        }
        .padding(.horizontal, 4).padding(.top, 4)
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

    private var addButton: some View {
        Button {
            editing = nil; showEditor = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        } label: {
            Image(systemName: "plus").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                .frame(width: 58, height: 58).background(BK_ACCENT, in: Circle())
                .shadow(color: BK_ACCENT.opacity(0.4), radius: 12, y: 4)
        }
        .padding(20)
    }

    private func dateTitle(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "d MMMM"; f.locale = Locale(identifier: I18n.code)
        return f.string(from: d)
    }
    private func dow(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEEE"; f.locale = Locale(identifier: I18n.code)
        return f.string(from: d).capitalized
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
    let onTap: () -> Void

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
                    Text(b.guest_name?.isEmpty == false ? b.guest_name! : t("bk.noName"))
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                    HStack(spacing: 10) {
                        if let tbl = b.table_label, !tbl.isEmpty {
                            label("tablecells", tbl)
                        }
                        if let ph = b.phone, !ph.isEmpty {
                            label("phone.fill", ph)
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
