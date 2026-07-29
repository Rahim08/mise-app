import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timeline entry

struct MiseEntry: TimelineEntry {
    let date: Date
    let snapshot: MiseSnapshot
    let config: MiseWidgetConfig
}

// MARK: - Provider (reads ONLY the shared App Group snapshot — no network)

struct MiseProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MiseEntry {
        MiseEntry(date: Date(), snapshot: .placeholder, config: MiseWidgetConfig())
    }

    func snapshot(for configuration: MiseWidgetConfig, in context: Context) async -> MiseEntry {
        let snap = MiseSnapshotStore.read() ?? .placeholder
        return MiseEntry(date: Date(), snapshot: snap, config: configuration)
    }

    func timeline(for configuration: MiseWidgetConfig, in context: Context) async -> Timeline<MiseEntry> {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        let entry = MiseEntry(date: Date(), snapshot: snap, config: configuration)
        // The app refreshes the snapshot + calls reloadAllTimelines on foreground.
        // We also ask the system to refresh in ~30 min as a safety net.
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        return Timeline(entries: [entry], policy: .after(next))
    }
}

// MARK: - Widget definition

struct MiseWidget: Widget {
    let kind = "MiseWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: MiseWidgetConfig.self, provider: MiseProvider()) { entry in
            MiseWidgetView(entry: entry)
        }
        .configurationDisplayName("Mise")
        .description("Касса или ближайшие брони. / Cash or upcoming bookings.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Accent mapping

private extension WidgetAccent {
    var color: Color {
        switch self {
        case .mint:   return Color(red: 0.20, green: 0.85, blue: 0.62)
        case .blue:   return Color(red: 0.30, green: 0.62, blue: 1.00)
        case .amber:  return Color(red: 1.00, green: 0.72, blue: 0.20)
        case .violet: return Color(red: 0.66, green: 0.50, blue: 1.00)
        }
    }
}

// MARK: - Root view (dispatch by metric)

struct MiseWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MiseEntry

    private var accent: Color { entry.config.accent.color }

    // Deep-link: тап по виджету открывает приложение на нужном модуле.
    private var deepLink: URL? {
        switch entry.config.metric {
        case .cash:     return URL(string: "mise://analytics")
        case .hookahs:  return URL(string: "mise://stash")
        case .bookings: return URL(string: "mise://bookings")
        }
    }

    private var isAccessory: Bool {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: return true
        default: return false
        }
    }

    @ViewBuilder private var content: some View {
        if isAccessory {
            AccessoryWidgetView(snap: entry.snapshot, metric: entry.config.metric, family: family)
        } else {
            switch entry.config.metric {
            case .cash:     CashWidget(snap: entry.snapshot, accent: accent, family: family)
            case .hookahs:  HookahWidget(snap: entry.snapshot, accent: accent, family: family)
            case .bookings: BookingWidget(snap: entry.snapshot, accent: accent, family: family)
            }
        }
    }

    var body: some View {
        content
            .widgetURL(deepLink)
            .containerBackground(for: .widget) { isAccessory ? Color.clear : Color.black }
    }
}

// MARK: - Accessory (lock screen) — компактные виджеты

private struct AccessoryWidgetView: View {
    let snap: MiseSnapshot
    let metric: WidgetMetric
    let family: WidgetFamily

    private func money(_ v: Double) -> String { SnapMoney.s(v, symbol: snap.currencySymbol) }
    private var nextBooking: SnapBooking? { snap.bookings.first }

    var body: some View {
        switch family {
        case .accessoryInline:
            switch metric {
            case .cash:     Text("\(money(snap.cashClosing))")
            case .hookahs:  Text("\(snap.hookahPaid) \(wt("wg.hookahsShort"))")
            case .bookings: Text(nextBooking.map { "\($0.time) \($0.guest)" } ?? wt("wg.noBookings"))
            }

        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                switch metric {
                case .cash:
                    VStack(spacing: 0) {
                        Image(systemName: "creditcard.fill").font(.system(size: 11, weight: .bold))
                        Text(shortMoney(snap.cashClosing)).font(.system(size: 13, weight: .bold)).minimumScaleFactor(0.5).lineLimit(1)
                    }
                case .hookahs:
                    VStack(spacing: 0) {
                        Image(systemName: "smoke.fill").font(.system(size: 11, weight: .bold))
                        Text("\(snap.hookahPaid)").font(.system(size: 16, weight: .bold))
                    }
                case .bookings:
                    VStack(spacing: 0) {
                        Image(systemName: "calendar").font(.system(size: 11, weight: .bold))
                        Text("\(snap.bookings.count)").font(.system(size: 16, weight: .bold))
                    }
                }
            }

        default: // .accessoryRectangular
            VStack(alignment: .leading, spacing: 2) {
                switch metric {
                case .cash:
                    Label(wt("wg.cashTitle"), systemImage: "creditcard.fill").font(.system(size: 12, weight: .semibold))
                    Text(money(snap.cashClosing)).font(.system(size: 18, weight: .bold))
                    Text("\(wt("wg.revenue")) \(money(snap.cashIncome))").font(.system(size: 11)).foregroundStyle(.secondary)
                case .hookahs:
                    Label(wt("wg.hookahShort"), systemImage: "smoke.fill").font(.system(size: 12, weight: .semibold))
                    Text("\(snap.hookahPaid) \(wt("wg.paid"))").font(.system(size: 16, weight: .bold))
                    Text("+\(snap.hookahFree) \(wt("wg.free"))").font(.system(size: 11)).foregroundStyle(.secondary)
                case .bookings:
                    Label(wt("wg.bookingsShort"), systemImage: "calendar.badge.clock").font(.system(size: 12, weight: .semibold))
                    if let b = nextBooking {
                        Text("\(b.time) · \(b.guest)").font(.system(size: 15, weight: .bold)).lineLimit(1)
                        Text(b.table.isEmpty ? "\(b.party) \(wt("wg.guestsShort"))" : "\(b.table) · \(b.party) \(wt("wg.guestsShort"))")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    } else {
                        Text(wt("wg.noBookings")).font(.system(size: 13)).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func shortMoney(_ v: Double) -> String {
        let n = NumberFormatter(); n.numberStyle = .decimal; n.maximumFractionDigits = 0; n.groupingSeparator = "\u{00A0}"
        return (snap.currencySymbol) + (n.string(from: NSNumber(value: v)) ?? "0")
    }
}

// MARK: - Shared chrome

private struct WidgetHeader: View {
    let title: String
    let symbol: String
    let accent: Color
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12, weight: .bold)).foregroundStyle(accent)
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
            Spacer(minLength: 0)
        }
    }
}

private struct EmptyState: View {
    let text: String
    var body: some View {
        VStack { Spacer(); Text(text).font(.system(size: 13)).foregroundStyle(.white.opacity(0.45)); Spacer() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Касса дня

/// Владельцу важнее состав кассы (выручка, нал/карта, расход, инкассация), чем итоговый
/// остаток — его показываем мелкой пометкой в углу, а не героем экрана.
private struct CashWidget: View {
    let snap: MiseSnapshot
    let accent: Color
    let family: WidgetFamily

    private func money(_ v: Double) -> String { SnapMoney.s(v, symbol: snap.currencySymbol) }

    private var cashRatio: CGFloat {
        let total = snap.cashCash + snap.cashCard
        guard total > 0 else { return 0.5 }
        return CGFloat(snap.cashCash / total)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(title: wt("wg.cashTitle"), symbol: "creditcard.fill", accent: accent)
            if !snap.cashAvailable {
                EmptyState(text: wt("wg.noShift"))
            } else if family == .systemSmall {
                Spacer(minLength: 4)
                Text(wt("wg.revenue")).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                Text(money(snap.cashIncome)).font(.system(size: 21, weight: .bold)).foregroundStyle(accent)
                    .minimumScaleFactor(0.6).lineLimit(1)
                Spacer(minLength: 6)
                HStack(spacing: 4) {
                    Text(wt("wg.cash")).font(.system(size: 10)).foregroundStyle(.white.opacity(0.45))
                    Text(money(snap.cashCash)).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                }.minimumScaleFactor(0.6).lineLimit(1)
            } else {
                Spacer(minLength: 6)
                Text(money(snap.cashIncome)).font(.system(size: 26, weight: .bold)).foregroundStyle(accent)
                    .minimumScaleFactor(0.6).lineLimit(1)
                // Полоска сравнения нал/карта — обе нейтральные (без акцента), различаются
                // только яркостью; акцент зарезервирован за итоговой выручкой выше.
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        Capsule().fill(Color.white.opacity(0.85)).frame(width: geo.size.width * cashRatio)
                        Capsule().fill(Color.white.opacity(0.26))
                    }
                }
                .frame(height: 7)
                .padding(.top, 9)
                HStack {
                    splitLabel(wt("wg.cash"), money(snap.cashCash))
                    Spacer()
                    splitLabel(wt("wg.card"), money(snap.cashCard), trailing: true)
                }.padding(.top, 7)
                Spacer(minLength: 6)
                HStack(spacing: 12) {
                    cell(wt("wg.expense"), money(snap.cashExpense), .white.opacity(0.55))
                    cell(wt("wg.inkassation"), money(snap.cashInkassation), .white.opacity(0.55))
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            if snap.cashAvailable && family != .systemSmall {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(wt("wg.balance")).font(.system(size: 9.5)).foregroundStyle(.white.opacity(0.35))
                    Text(money(snap.cashClosing)).font(.system(size: 11.5, weight: .bold)).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    private func splitLabel(_ label: String, _ value: String, trailing: Bool = false) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 1) {
            Text(label).font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.5))
            Text(value).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                .minimumScaleFactor(0.6).lineLimit(1)
        }
    }

    private func cell(_ label: String, _ value: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(c)
                .minimumScaleFactor(0.6).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Кальяны смены

private struct HookahWidget: View {
    let snap: MiseSnapshot
    let accent: Color
    let family: WidgetFamily

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(title: wt("wg.hookahTitle"), symbol: "smoke.fill", accent: accent)
            if family == .systemSmall {
                Spacer(minLength: 4)
                Text("\(snap.hookahPaid)").font(.system(size: 30, weight: .bold)).foregroundStyle(.white)
                Text(wt("wg.paid")).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                Spacer(minLength: 6)
                Text("+\(snap.hookahFree) \(wt("wg.free"))").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            } else {
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    stat("\(snap.hookahPaid)", wt("wg.paid"), accent)
                    stat("\(snap.hookahFree)", wt("wg.free"), .white.opacity(0.6))
                }
                Spacer(minLength: 8)
                HStack(alignment: .firstTextBaseline) {
                    Text(wt("wg.revenue")).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    Spacer()
                    Text(SnapMoney.s(snap.hookahRevenue, symbol: snap.currencySymbol))
                        .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                        .minimumScaleFactor(0.6).lineLimit(1)
                }
            }
        }
    }

    private func stat(_ value: String, _ label: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 24, weight: .bold)).foregroundStyle(c)
            Text(label).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Ближайшие брони

private struct BookingWidget: View {
    let snap: MiseSnapshot
    let accent: Color
    let family: WidgetFamily

    private var rows: [SnapBooking] {
        Array(snap.bookings.prefix(family == .systemSmall ? 2 : 4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(title: wt("wg.bookingsTitle"), symbol: "calendar.badge.clock", accent: accent)
            if rows.isEmpty {
                EmptyState(text: wt("wg.noBookings"))
            } else {
                Spacer(minLength: 6)
                VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 8) {
                    ForEach(rows) { b in row(b) }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func row(_ b: SnapBooking) -> some View {
        HStack(spacing: 8) {
            // Тап — сразу «Пришёл» без открытия приложения (юзер-фидбог 2026-07-22:
            // была такая галка раньше, потерялась при пересборке виджета — вернул).
            Button(intent: MarkBookingArrivedIntent(bookingID: b.id)) {
                Image(systemName: "circle")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.35))
            }
            .buttonStyle(.plain)
            Text(b.time.isEmpty ? "—" : b.time)
                .font(.system(size: 13, weight: .bold)).foregroundStyle(accent)
                .frame(width: 42, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(b.guest.isEmpty ? wt("wg.guest") : b.guest)
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                if family != .systemSmall {
                    HStack(spacing: 6) {
                        if !b.table.isEmpty {
                            Label(b.table, systemImage: "tablecells").labelStyle(.titleAndIcon)
                        }
                        if b.party > 0 {
                            Label("\(b.party)", systemImage: "person.2.fill").labelStyle(.titleAndIcon)
                        }
                    }
                    .font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
                }
            }
            Spacer(minLength: 0)
            if family == .systemSmall && b.party > 0 {
                Text("\(b.party)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
            }
        }
    }
}

// MARK: - Preview

#Preview(as: .systemMedium) {
    MiseWidget()
} timeline: {
    MiseEntry(date: .now, snapshot: .placeholder, config: MiseWidgetConfig(metric: .cash))
    MiseEntry(date: .now, snapshot: .placeholder, config: MiseWidgetConfig(metric: .bookings, accent: .violet))
}
