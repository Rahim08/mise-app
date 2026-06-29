import SwiftUI

// MARK: - GuestsView — лояльность гостей
//
// Агрегирует все брони за ~12 месяцев, группируя по нормализованному ключу
// (телефон-цифры, иначе lowercase-имя). Показывает количество визитов,
// дату последнего визита, суммарных гостей.

private let GS_ACCENT = BrandKit.bookings

// MARK: - Агрегация

private func guestKey(_ b: Booking) -> String {
    let digits = (b.phone ?? "").filter { $0.isNumber }
    if !digits.isEmpty { return digits }
    return (b.guest_name ?? "").lowercased().trimmingCharacters(in: .whitespaces)
}

private func buildProfiles(from bookings: [Booking]) -> [GuestProfile] {
    var dict: [String: GuestProfile] = [:]
    let sorted = bookings.sorted { ($0.booking_date ?? "") < ($1.booking_date ?? "") }

    for b in sorted {
        let key = guestKey(b)
        guard !key.isEmpty else { continue }
        let displayName = b.guest_name?.isEmpty == false ? b.guest_name! :
            (b.phone?.isEmpty == false ? b.phone! : key)

        if var existing = dict[key] {
            existing.visitCount += 1
            existing.totalGuests += b.guests_count ?? 0
            if let d = b.booking_date, d > (existing.lastVisitDate ?? "") {
                existing.lastVisitDate = d
            }
            existing.bookings.append(b)
            dict[key] = existing
        } else {
            dict[key] = GuestProfile(
                id: key,
                displayName: displayName,
                phone: (b.phone?.isEmpty == false) ? b.phone : nil,
                visitCount: 1,
                lastVisitDate: b.booking_date,
                totalGuests: b.guests_count ?? 0,
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
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var selectedGuest: GuestProfile?
    @State private var showDetail = false

    private var profiles: [GuestProfile] {
        buildProfiles(from: m.allBookings)
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
                if m.allBookings.isEmpty {
                    emptyState
                } else {
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
                                ForEach(filtered) { guest in
                                    GuestRow(guest: guest) {
                                        selectedGuest = guest
                                        showDetail = true
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 24)
                        }
                    }
                }
            }
            .navigationTitle(t("gs.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("done")) { dismiss() }
                }
            }
            .sheet(isPresented: $showDetail) {
                if let g = selectedGuest {
                    GuestDetailView(guest: g)
                }
            }
        }
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

struct GuestDetailView: View {
    let guest: GuestProfile
    @Environment(\.dismiss) private var dismiss

    private var sortedBookings: [Booking] {
        guest.bookings.sorted { ($0.booking_date ?? "") > ($1.booking_date ?? "") }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        // Шапка гостя
                        guestHeader

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
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("done")) { dismiss() }
                }
            }
        }
    }

    private var guestHeader: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(GS_ACCENT.opacity(0.18)).frame(width: 58, height: 58)
                Text(String((guest.displayName.first ?? "?").uppercased()))
                    .font(.system(size: 22, weight: .bold)).foregroundStyle(GS_ACCENT)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(guest.displayName).font(.system(size: 18, weight: .bold)).foregroundStyle(.primary)
                if let ph = guest.phone {
                    Text(ph).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
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

    private func historyRow(_ b: Booking) -> some View {
        let st = BkStatusPublic(rawValue: b.status ?? "new") ?? .new
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

            Text(st.label).font(.system(size: 10, weight: .bold)).foregroundStyle(st.color)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(st.color.opacity(0.16), in: Capsule())
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

// MARK: - BkStatusPublic (нужен в GuestsView без доступа к private enum)

enum BkStatusPublic: String {
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
