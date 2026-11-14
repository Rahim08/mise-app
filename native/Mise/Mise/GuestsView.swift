import SwiftUI

// MARK: - GuestsView — лояльность гостей
//
// Агрегирует полную историю броней по стабильному ключу гостя.
// Легаси-строки без ключа не объединяются по имени или суффиксу телефона. Показывает количество визитов,
// дату последнего визита, суммарных гостей.

private let GS_ACCENT = BrandKit.bookings

// MARK: - Агрегация

func buildGuestProfiles(from bookings: [Booking]) -> [GuestProfile] {
    var dict: [String: GuestProfile] = [:]
    let today = bookingDateKey(Date())
    let sorted = bookings.sorted { ($0.booking_date ?? "") < ($1.booking_date ?? "") }

    for b in sorted {
        let key = bookingGuestKey(b)
        guard !key.isEmpty else { continue }
        let displayName = b.guest_name?.isEmpty == false ? b.guest_name! :
            (b.phone?.isEmpty == false ? b.phone! : key)
        let visit = bookingIsVisit(b, today: today)
        let noShow = b.status == "no_show"

        if var existing = dict[key] {
            if visit {
                existing.visitCount += 1
                existing.totalGuests += b.guests_count ?? 0
                if let d = b.booking_date, d > (existing.lastVisitDate ?? "") {
                    existing.lastVisitDate = d
                }
            }
            if noShow { existing.noShowCount += 1 }
            // Дополняем недостающие имя/телефон из любой брони гостя — иначе у тех,
            // чья ПЕРВАЯ бронь была без имени/телефона, префилл открывался пустым.
            if existing.phone == nil, let ph = b.phone, !ph.isEmpty { existing.phone = ph }
            if let nm = b.guest_name, !nm.isEmpty,
               (existing.displayName.isEmpty || existing.displayName == existing.id || existing.displayName == (existing.phone ?? "")) {
                existing.displayName = nm
            }
            existing.bookings.append(b)
            dict[key] = existing
        } else {
            dict[key] = GuestProfile(
                id: key,
                displayName: displayName,
                phone: (b.phone?.isEmpty == false) ? b.phone : nil,
                visitCount: visit ? 1 : 0,
                noShowCount: noShow ? 1 : 0,
                lastVisitDate: visit ? b.booking_date : nil,
                totalGuests: visit ? (b.guests_count ?? 0) : 0,
                bookings: [b]
            )
        }
    }

    // Сортируем: больше визитов — выше
    return dict.values.sorted { $0.visitCount > $1.visitCount }
}

// MARK: - GuestsView

struct GuestsView: View {
    let m: BookingsModel
    var onNewBooking: (String?, String?, Int, Int, String) -> Void = { _, _, _, _, _ in }
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var searchText = ""
    @State private var selectedGuest: GuestProfile?
    @State private var editingGuest: GuestProfile?
    // Форсит пересоздание GuestDetailView (полный ре-фетч loadNote) после успешного
    // сохранения в GuestEditSheet — иначе уже открытая карточка не увидит свежие данные.
    @State private var detailRefreshTick = 0
    @State private var deleteTarget: GuestProfile?
    @State private var errorMsg: String?
    @State private var showReviews = false
    @State private var deletingGuest = false

    // Как canEdit(_:) в BookingsView, но для гостя целиком: массовая правка/удаление
    // разрешены только должностным лицам или если ВСЕ брони гостя создал текущий сотрудник.
    private func canEditGuest(_ guest: GuestProfile) -> Bool {
        app.isOfficial || guest.bookings.allSatisfy { $0.created_by != nil && $0.created_by == app.staff?.id }
    }

    private var profiles: [GuestProfile] {
        buildGuestProfiles(from: m.allBookings)
    }

    private var filtered: [GuestProfile] {
        guard !searchText.isEmpty else { return profiles }
        let q = searchText.lowercased()
        return profiles.filter {
            $0.displayName.lowercased().contains(q) ||
            ($0.phone ?? "").contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 0) {
                        // Поиск
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4))
                            TextField(t("bk.searchPh"), text: $searchText).font(.system(size: 15))
                            if !searchText.isEmpty {
                                Button { searchText = "" } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(.primary.opacity(0.4))
                                }
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .padding(.horizontal, 16).padding(.vertical, 10)

                        LazyVStack(spacing: 10) {
                            ReviewsEntryRow { showReviews = true }
                            if m.guestsLoading && m.allBookings.isEmpty { RowListSkeleton(rows: 4) }
                            if let error = m.guestsError {
                                VStack(spacing: 8) {
                                    Text(t("loadFailed")).font(.system(size: 15, weight: .semibold))
                                    Text(error).font(.system(size: 12)).foregroundStyle(.secondary)
                                    Button(t("retry")) { Task { await m.loadAllBookings(force: true) } }.frame(minHeight: 44)
                                }.padding(14)
                            }
                            if m.allBookings.isEmpty && !m.guestsLoading && m.guestsError == nil {
                                emptyState
                            } else {
                                ForEach(filtered) { guest in
                                    GuestRow(guest: guest) {
                                        selectedGuest = guest
                                    }
                                    .contextMenu {
                                        if canEditGuest(guest) {
                                            Button { editingGuest = guest } label: {
                                                Label(t("edit"), systemImage: "pencil")
                                            }
                                            Button(role: .destructive) { deleteTarget = guest } label: {
                                                Label(t("delete"), systemImage: "trash")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .refreshable { await m.loadAllBookings(force: true) }
                if let errorMsg {
                    Text(errorMsg)
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                        .padding(.horizontal, 18).padding(.vertical, 12)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 60)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: errorMsg)
            .navigationTitle(t("gs.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("done")) { dismiss() }
                }
            }
            .sheet(isPresented: $showReviews) {
                GoogleReviewsView()
            }
            // Push, не sheet-на-sheet: карточка гостя больше не отдельный модал внутри
            // модала (список гостей). "Новая бронь" теперь единственный dismiss на выходе
            // (см. onNewBooking) вместо цепочки из нескольких закрывающихся шитов подряд.
            .navigationDestination(item: $selectedGuest) { g in
                GuestDetailView(guest: g, rid: m.rid, canEdit: canEditGuest(g), onNewBooking: onNewBooking, onEdit: { _ in
                    editingGuest = g
                }, onDelete: {
                    try await m.deleteGuest(g)
                })
                .id(detailRefreshTick)
            }
            .sheet(item: $editingGuest) { g in
                GuestEditSheet(guest: g, rid: m.rid) { newName, newPhone in
                    editingGuest = nil
                    m.guestDidUpdate(key: g.id, name: newName, phone: newPhone)
                    if selectedGuest?.id == g.id { selectedGuest = buildGuestProfiles(from: m.allBookings).first { $0.id == g.id } }
                    detailRefreshTick += 1
                }
            }
            .alert(t("gs.deleteGuest"), isPresented: .init(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            )) {
                Button(t("cancel"), role: .cancel) { deleteTarget = nil }
                Button(t("delete"), role: .destructive) {
                    if let g = deleteTarget { deleteGuest(g) }
                }
            } message: {
                Text(t("gs.deleteGuestConfirm", ["name": deleteTarget?.displayName ?? ""]))
            }
        }
    }

    private func deleteGuest(_ guest: GuestProfile) {
        guard !deletingGuest else { return }
        deletingGuest = true
        Task {
            defer { deletingGuest = false }
            do {
                try await m.deleteGuest(guest)
                deleteTarget = nil
                if selectedGuest?.id == guest.id { selectedGuest = nil }
            } catch { flash(error.localizedDescription) }
        }
    }

    private func flash(_ msg: String) {
        errorMsg = msg
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if errorMsg == msg { errorMsg = nil } }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2").font(.system(size: 34, weight: .light)).foregroundStyle(GS_ACCENT)
            Text(t("gs.empty")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
            Text(t("gs.emptyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 60)
    }
}

// MARK: - ReviewsEntryRow — вход в Google-отзывы, первая строка списка клиентов

private struct ReviewsEntryRow: View {
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(GS_ACCENT.opacity(0.18)).frame(width: 44, height: 44)
                    Image(systemName: "star.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(GS_ACCENT)
                }
                Text(t("bk.rvTitle")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.2))
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - GuestRow

private struct GuestRow: View {
    let guest: GuestProfile
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Аватар-инициал
                ZStack {
                    Circle().fill(GS_ACCENT.opacity(0.18)).frame(width: 44, height: 44)
                    Text(String((guest.displayName.first ?? "?").uppercased()))
                        .font(.system(size: 17, weight: .bold)).foregroundStyle(GS_ACCENT)
                }

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(guest.displayName)
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        if guest.visitCount >= 5 {
                            Text(t("gs.regularBadge"))
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(GS_ACCENT, in: Capsule())
                        }
                    }
                    HStack(spacing: 10) {
                        label("calendar", t("gs.visits", ["n": "\(guest.visitCount)"]))
                        if let ph = guest.phone {
                            label("phone", ph)
                        }
                    }
                }

                Spacer(minLength: 4)

                VStack(alignment: .trailing, spacing: 3) {
                    if let last = guest.lastVisitDate {
                        Text(formatDate(last))
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(.primary.opacity(0.45))
                    }
                    if guest.totalGuests > 0 {
                        Text(t("gs.totalGuests", ["n": "\(guest.totalGuests)"]))
                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3))
                    }
                }

                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.2))
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func label(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 10))
            Text(text).font(.system(size: 12))
        }.foregroundStyle(.primary.opacity(0.55))
    }

    private func formatDate(_ s: String) -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        guard let d = df.date(from: s) else { return s }
        let out = DateFormatter(); out.dateFormat = "d MMM"; out.locale = Locale(identifier: I18n.code)
        return out.string(from: d)
    }
}

// MARK: - GuestDetailView

private nonisolated struct GuestNote: Codable, Sendable {
    let note: String?
    let last_name: String?
    let email: String?
    let birthday: String?
}

/// Снимок профиля гостя, переданный из GuestDetailView в GuestEditSheet — одна форма
/// на весь гость (имя/телефон/фамилия/email/ДР/заметка), см. онEdit ниже.
struct GuestEditPrefill {
    var lastName: String
    var email: String
    var birthday: Date?
    var note: String
}

struct GuestDetailView: View {
    let guest: GuestProfile
    let rid: String
    var canEdit: Bool = true
    var onNewBooking: (String?, String?, Int, Int, String) -> Void = { _, _, _, _, _ in }
    // Передаём уже загруженный профиль (фамилия/email/ДР) в шторку правки — там и только
    // там их теперь можно менять (юзер-фидбек: не дублировать поля в самой карточке, они
    // должны появляться только если зайти в «Редактировать» и заполнить).
    var onEdit: (GuestEditPrefill) -> Void = { _ in }
    var onDelete: () async throws -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var note = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var hasBirthday = false
    @State private var birthday = Date()
    @State private var noteLoaded = false
    @State private var noteError: String?
    @State private var noteGeneration = 0
    @State private var deleteState = BookingSaveState()
    @State private var showPhoneMenu = false
    @State private var confirmDelete = false

    private static let bdayFmt: DateFormatter = {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        return df
    }()
    private static let bdayDisplayFmt: DateFormatter = {
        let df = DateFormatter(); df.dateFormat = "d MMM yyyy"; df.locale = Locale(identifier: I18n.code)
        return df
    }()

    private var sortedBookings: [Booking] {
        guest.bookings.sorted { ($0.booking_date ?? "") > ($1.booking_date ?? "") }
    }

    // Имя гостя для префилла новой брони (не телефон). Берём из самой свежей брони с именем.
    private var guestName: String? {
        sortedBookings.compactMap { $0.guest_name }.first { !$0.isEmpty }
    }

    // Телефон для префилла — из любой брони гостя, не только профильной (которая берётся
    // из самой ранней брони и могла быть без телефона).
    private var guestPhone: String? {
        guest.phone ?? guest.bookings.compactMap { $0.phone }.first { !$0.isEmpty }
    }

    // Пуш внутри NavigationStack родителя (GuestsView), не отдельный sheet — назад
    // системный back-chevron, без Done-кнопки (см. точку 4 фидбека: убрать каскад шитов).
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    guestHeader
                    newBookingButton
                    statsCard
                    noteSection
                    if let error = noteError {
                        Text(error).font(.system(size: 13)).foregroundStyle(.secondary)
                        Button(t("retry")) { Task { await loadNote() } }.frame(minHeight: 44)
                    }
                    if let error = deleteState.error { Text(error).font(.system(size: 13)).foregroundStyle(.red) }

                    // История броней
                    VStack(alignment: .leading, spacing: 10) {
                        Text(t("gs.history"))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.primary.opacity(0.5))
                            .padding(.horizontal, 4)

                        ForEach(sortedBookings) { b in
                            historyRow(b)
                        }
                    }
                }
                .padding(16).padding(.bottom, 24)
            }
        }
        .navigationTitle(guest.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.miseBg, for: .navigationBar)
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { onEdit(GuestEditPrefill(lastName: lastName, email: email, birthday: hasBirthday ? birthday : nil, note: note)) } label: { Label(t("edit"), systemImage: "pencil") }
                        Button(role: .destructive) { confirmDelete = true } label: { Label(t("delete"), systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").foregroundStyle(GS_ACCENT)
                    }
                }
            }
        }
        .alert(t("gs.deleteGuest"), isPresented: $confirmDelete) {
            Button(t("cancel"), role: .cancel) {}
            Button(t("delete"), role: .destructive) {
                Task { if await deleteState.perform({ try await onDelete() }) { dismiss() } }
            }.disabled(deleteState.saving)
        } message: {
            Text(t("gs.deleteGuestConfirm", ["name": guest.displayName]))
        }
        .task { if !noteLoaded { await loadNote() } }
    }

    private var newBookingButton: some View {
        Button { onNewBooking(guestName, guestPhone, guest.visitCount, guest.noShowCount, guest.id) } label: {
            Label(t("gs.newBooking"), systemImage: "calendar.badge.plus")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(GS_ACCENT, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var guestHeader: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(GS_ACCENT.opacity(0.18)).frame(width: 58, height: 58)
                Text(String((guest.displayName.first ?? "?").uppercased()))
                    .font(.system(size: 22, weight: .bold)).foregroundStyle(GS_ACCENT)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(guest.displayName).font(.system(size: 18, weight: .bold)).foregroundStyle(.primary)
                    if guest.visitCount >= 5 {
                        Text(t("gs.regularBadge"))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(GS_ACCENT, in: Capsule())
                    }
                }
                if guest.noShowCount > 0 {
                    Text(t("gs.noShows", ["n": "\(guest.noShowCount)"]))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.accent)
                }
                if let ph = guest.phone, !ph.isEmpty {
                    Button { showPhoneMenu = true } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "phone.fill").font(.system(size: 11))
                            Text(ph).font(.system(size: 13, weight: .medium))
                        }.foregroundStyle(GS_ACCENT)
                    }
                    .buttonStyle(.plain)
                    .confirmationDialog(t("bk.contactGuest"), isPresented: $showPhoneMenu, titleVisibility: .visible) {
                        let digits = ph.filter { $0.isNumber }
                        if !digits.isEmpty {
                            Button(t("bk.callAction")) {
                                if let url = URL(string: "tel:\(digits)") { UIApplication.shared.open(url) }
                            }
                            Button("WhatsApp") {
                                if let url = URL(string: "https://wa.me/\(digits)") { UIApplication.shared.open(url) }
                            }
                        }
                        Button(t("cancel"), role: .cancel) {}
                    }
                }
                // Только то, что реально заполнено — пусто просто не показываем (заполняется
                // через «...» → «Редактировать», не пустыми полями прямо в карточке).
                if !lastName.isEmpty {
                    Text(lastName).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                }
                if !email.isEmpty {
                    Text(email).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                }
                if hasBirthday {
                    Text(Self.bdayDisplayFmt.string(from: birthday)).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(t("gs.visits", ["n": "\(guest.visitCount)"]))
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(GS_ACCENT)
                if guest.totalGuests > 0 {
                    Text(t("gs.totalGuests", ["n": "\(guest.totalGuests)"]))
                        .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: статистика гостя

    private var avgParty: Int? {
        guest.visitCount > 0 && guest.totalGuests > 0 ? Int((Double(guest.totalGuests) / Double(guest.visitCount)).rounded()) : nil
    }

    private var favTable: String? {
        let tables = guest.bookings.compactMap { $0.table_label }.filter { !$0.isEmpty }
        guard !tables.isEmpty else { return nil }
        let counts = Dictionary(grouping: tables, by: { $0 }).mapValues(\.count)
        return counts.max { $0.value < $1.value }?.key
    }

    private var sinceLastVisit: String? {
        guard let last = guest.lastVisitDate else { return nil }
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        guard let d = df.date(from: last) else { return nil }
        let days = Calendar.current.dateComponents([.day], from: d, to: Date()).day ?? 0
        if days <= 0 { return t("gs.today") }
        if days < 30 { return t("gs.daysAgo", ["n": "\(days)"]) }
        return t("gs.monthsAgo", ["n": "\(days / 30)"])
    }

    @ViewBuilder private var statsCard: some View {
        let items: [(String, String)] = {
            var a: [(String, String)] = []
            if let p = avgParty { a.append((t("gs.avgParty"), "\(p)")) }
            if let tbl = favTable { a.append((t("gs.favTable"), tbl)) }
            if let s = sinceLastVisit { a.append((t("gs.lastVisit"), s)) }
            return a
        }()
        if !items.isEmpty {
            HStack(spacing: 10) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    VStack(spacing: 3) {
                        Text(it.1).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                        Text(it.0).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.45))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    // MARK: заметка о госте — read-only здесь; редактируется вместе с остальным профилем
    // ТОЛЬКО через «...» → «Редактировать» (GuestEditSheet), одной формой на весь гость —
    // юзер-фидбек 2026-07-22: нелогично разносить имя/фамилию/заметку по разным местам,
    // это всё об одном госте.

    @ViewBuilder private var noteSection: some View {
        if !note.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(t("gs.note"))
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.5))
                    .padding(.horizontal, 4)
                Text(note).font(.system(size: 14)).foregroundStyle(.primary)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func loadNote() async {
        noteGeneration += 1
        let request = noteGeneration
        noteError = nil
        do {
            let row = try await DB.from("guest_notes").fresh().select().eq("guest_key", guest.id).single(GuestNote.self)
            guard request == noteGeneration, !Task.isCancelled else { return }
            note = row?.note ?? ""; lastName = row?.last_name ?? ""; email = row?.email ?? ""
            if let birthdayValue = row?.birthday, let date = Self.bdayFmt.date(from: birthdayValue) {
                birthday = date; hasBirthday = true
            } else { hasBirthday = false }
            noteLoaded = true
        } catch {
            guard request == noteGeneration, !Task.isCancelled else { return }
            noteError = error.localizedDescription
        }
    }

    private func historyRow(_ b: Booking) -> some View {
        let bucket = bkBucket(for: b.status)
        return HStack(spacing: 12) {
            VStack(spacing: 2) {
                Text(b.booking_time ?? "—").font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                if let gc = b.guests_count {
                    HStack(spacing: 2) {
                        Image(systemName: "person.2.fill").font(.system(size: 8))
                        Text("\(gc)").font(.system(size: 11))
                    }.foregroundStyle(.primary.opacity(0.5))
                }
            }
            .frame(width: 48)

            VStack(alignment: .leading, spacing: 2) {
                Text(formatDate(b.booking_date ?? "")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                if let tbl = b.table_label, !tbl.isEmpty {
                    HStack(spacing: 3) {
                        Image(systemName: "tablecells").font(.system(size: 9))
                        Text(tbl).font(.system(size: 12))
                    }.foregroundStyle(.primary.opacity(0.5))
                }
                if let note = b.note, !note.isEmpty {
                    Text(note).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4)).lineLimit(1)
                }
            }

            Spacer()

            if let bucket {
                Text(bucket.label).font(.system(size: 10, weight: .bold)).foregroundStyle(bucket.color)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(bucket.color.opacity(0.16), in: Capsule())
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func formatDate(_ s: String) -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        guard let d = df.date(from: s) else { return s }
        let out = DateFormatter(); out.dateFormat = "d MMM yyyy"; out.locale = Locale(identifier: I18n.code)
        return out.string(from: d)
    }
}

// MARK: - GuestEditSheet

private struct GuestEditSheet: View {
    let guest: GuestProfile
    let rid: String
    var onDone: (String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var phone: String
    private let originalName: String
    private let originalPhone: String
    @State private var lastName = ""
    @State private var email = ""
    @State private var note = ""
    @State private var hasBirthday = false
    @State private var birthday = Date()
    @State private var profile: BookingGuestDetailsModel
    @State private var saveState = BookingSaveState()

    private static let bdayFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()

    init(guest: GuestProfile, rid: String, onDone: @escaping (String?, String?) -> Void) {
        self.guest = guest; self.rid = rid; self.onDone = onDone
        let newest = guest.bookings.sorted { ($0.booking_date ?? "") > ($1.booking_date ?? "") }
        let name = newest.compactMap(\.guest_name).first { !$0.isEmpty } ?? ""
        let phone = guest.phone ?? ""
        self.originalName = name; self.originalPhone = phone
        _name = State(initialValue: name); _phone = State(initialValue: phone)
        _profile = State(initialValue: BookingGuestDetailsModel(key: guest.id))
    }

    var body: some View {
        NavigationStack {
            Form {
                if profile.loading { ProgressView() }
                if let error = profile.error {
                    Section {
                        Text(t("loadFailed")).fontWeight(.semibold)
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button(t("retry")) { Task { await loadProfile() } }
                    }
                }
                Group {
                    Section(t("gs.guestInfo")) {
                        TextField(t("gs.namePh"), text: $name)
                        TextField(t("gs.lastName"), text: $lastName)
                        if hasBirthday {
                            HStack {
                                DatePicker(t("gs.birthday"), selection: $birthday, displayedComponents: .date)
                                Button { hasBirthday = false } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                }.buttonStyle(.plain).accessibilityLabel(t("delete"))
                            }
                        } else {
                            Button { hasBirthday = true; birthday = Date() } label: { Label(t("gs.birthday"), systemImage: "plus.circle") }
                        }
                    }
                    Section(t("gs.secContacts")) {
                        TextField(t("gs.phonePh"), text: $phone).keyboardType(.phonePad)
                        TextField(t("gs.email"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    }
                    Section(t("gs.note")) {
                        TextField(t("gs.notePh"), text: $note, axis: .vertical).lineLimit(2...5)
                    }
                }
                .disabled(!profile.loaded || saveState.saving)
            }
            .tint(GS_ACCENT)
            .navigationTitle(t("gs.editGuest"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() }.disabled(saveState.saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveState.saving ? t("saving") : t("bk.save")) { save() }
                        .disabled(!profile.loaded || saveState.saving)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let error = saveState.error {
                    Text(error).font(.system(size: 13)).foregroundStyle(.red).multilineTextAlignment(.center)
                        .padding(14).frame(maxWidth: .infinity).background(.regularMaterial)
                }
            }
        }
        .interactiveDismissDisabled(saveState.saving)
        .task { await loadProfile() }
    }

    private func loadProfile() async {
        await profile.load()
        guard profile.loaded, !Task.isCancelled else { return }
        lastName = profile.details.last_name ?? ""; email = profile.details.email ?? ""; note = profile.details.note ?? ""
        if let text = profile.details.birthday, let date = Self.bdayFmt.date(from: text) { birthday = date; hasBirthday = true }
        else { hasBirthday = false }
    }

    private func save() {
        guard profile.loaded, !saveState.saving else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let changedName: String? = trimmedName == originalName ? nil : trimmedName
        let changedPhone: String? = trimmedPhone == originalPhone ? nil : trimmedPhone
        var patch: [String: Any] = [:]
        let last = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let birthdayValue = hasBirthday ? Self.bdayFmt.string(from: birthday) : nil
        if last != (profile.details.last_name ?? "") { patch["last_name"] = last }
        if mail != (profile.details.email ?? "") { patch["email"] = mail }
        if text != (profile.details.note ?? "") { patch["note"] = text }
        if birthdayValue != profile.details.birthday { patch["birthday"] = birthdayValue ?? NSNull() }
        Task {
            if await saveState.perform({ try await BookingGuestService.update(key: guest.id, name: changedName, phone: changedPhone, profile: patch) }) {
                onDone(changedName, changedPhone); dismiss()
            }
        }
    }
}
