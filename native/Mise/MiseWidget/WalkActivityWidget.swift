import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Live Activity «Восьмёрка» — таймер + шаги живьём в Dynamic Island/Lock Screen

private let WALK_ACCENT = Color(red: 0.20, green: 0.85, blue: 0.62)

private func fmtElapsed(_ seconds: Int) -> String {
    let m = seconds / 60, s = seconds % 60
    return String(format: "%d:%02d", m, s)
}

// Живой (не пушится приложением каждую секунду — считает сама ОС) когда идёт;
// статичный снимок когда на паузе.
@ViewBuilder private func timerText(_ state: WalkActivityAttributes.ContentState, font: Font) -> some View {
    if state.isPaused {
        Text(fmtElapsed(state.pausedSeconds)).font(font)
    } else {
        Text(state.startDate, style: .timer).font(font)
    }
}

struct WalkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WalkActivityAttributes.self) { context in
            // Lock Screen / banner
            HStack(spacing: 14) {
                Image(systemName: "figure.walk")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(WALK_ACCENT)
                    .frame(width: 40, height: 40)
                    .background(WALK_ACCENT.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.templateTitle)
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    Text(context.state.blockLabel)
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    timerText(context.state, font: .system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary).monospacedDigit()
                    HStack(spacing: 3) {
                        Image(systemName: "shoeprints.fill").font(.system(size: 9))
                        Text("\(context.state.steps)").font(.system(size: 11, weight: .semibold))
                    }.foregroundStyle(.secondary)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color.black)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Image(systemName: "figure.walk").font(.system(size: 16)).foregroundStyle(WALK_ACCENT)
                        Text(context.state.blockLabel).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        timerText(context.state, font: .system(size: 20, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        HStack(spacing: 3) {
                            Image(systemName: "shoeprints.fill").font(.system(size: 9))
                            Text("\(context.state.steps)").font(.system(size: 11, weight: .semibold))
                        }.foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.isPaused {
                        Text("Пауза").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    Image(systemName: "shoeprints.fill").font(.system(size: 11)).foregroundStyle(WALK_ACCENT)
                    Text("\(context.state.steps)").font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                }
            } compactTrailing: {
                timerText(context.state, font: .system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            } minimal: {
                Image(systemName: "figure.walk").foregroundStyle(WALK_ACCENT)
            }
        }
    }
}
