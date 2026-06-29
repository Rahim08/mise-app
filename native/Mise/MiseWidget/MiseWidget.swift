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
                .containerBackground(for: .widget) { Color.black }
        }
        .configurationDisplayName("Mise")
        .description("Касса, кальяны или ближайшие брони. / Cash, hookahs or upcoming bookings.")
        .supportedFamilies([.systemSmall, .systemMedium])
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

    var body: some View {
        switch entry.config.metric {
        case .cash:     CashWidget(snap: entry.snapshot, accent: accent, family: family)
        case .hookahs:  HookahWidget(snap: entry.snapshot, accent: accent, family: family)
        case .bookings: BookingWidget(snap: entry.snapshot, accent: accent, family: family)
        }
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

private struct CashWidget: View {
    let snap: MiseSnapshot
    let accent: Color
    let family: WidgetFamily

    private func money(_ v: Double) -> String { SnapMoney.s(v, symbol: snap.currencySymbol) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(title: "Касса дня", symbol: "creditcard.fill", accent: accent)
            if !snap.cashAvailable {
                EmptyState(text: "Нет смены")
            } else if family == .systemSmall {
                Spacer(minLength: 4)
                Text("Остаток").font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                Text(money(snap.cashClosing)).font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                    .minimumScaleFactor(0.6).lineLimit(1)
                Spacer(minLength: 6)
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up").font(.system(size: 9, weight: .bold)).foregroundStyle(accent)
                    Text(money(snap.cashIncome)).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                        .minimumScaleFactor(0.6).lineLimit(1)
                }
            } else {
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    cell("Приход", money(snap.cashIncome), accent)
                    cell("Расход", money(snap.cashExpense), .white.opacity(0.55))
                }
                Spacer(minLength: 8)
                HStack(alignment: .firstTextBaseline) {
                    Text("Остаток").font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    Spacer()
                    Text(money(snap.cashClosing)).font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                        .minimumScaleFactor(0.6).lineLimit(1)
                }
            }
        }
    }

    private func cell(_ label: String, _ value: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
            Text(value).font(.system(size: 16, weight: .semibold)).foregroundStyle(c)
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
            WidgetHeader(title: "Кальяны смены", symbol: "smoke.fill", accent: accent)
            if family == .systemSmall {
                Spacer(minLength: 4)
                Text("\(snap.hookahPaid)").font(.system(size: 30, weight: .bold)).foregroundStyle(.white)
                Text("платных").font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                Spacer(minLength: 6)
                Text("+\(snap.hookahFree) бесплатных").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            } else {
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    stat("\(snap.hookahPaid)", "платных", accent)
                    stat("\(snap.hookahFree)", "бесплатных", .white.opacity(0.6))
                }
                Spacer(minLength: 8)
                HStack(alignment: .firstTextBaseline) {
                    Text("Выручка").font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
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
            WidgetHeader(title: "Ближайшие брони", symbol: "calendar.badge.clock", accent: accent)
            if rows.isEmpty {
                EmptyState(text: "Броней нет")
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
            Text(b.time.isEmpty ? "—" : b.time)
                .font(.system(size: 13, weight: .bold)).foregroundStyle(accent)
                .frame(width: 42, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(b.guest.isEmpty ? "Гость" : b.guest)
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
    MiseEntry(date: .now, snapshot: .placeholder, config: MiseWidgetConfig(metric: .hookahs, accent: .amber))
    MiseEntry(date: .now, snapshot: .placeholder, config: MiseWidgetConfig(metric: .bookings, accent: .violet))
}
