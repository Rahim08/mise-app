import SwiftUI

// MARK: - Swipe Action Row
// Горизонтальный свайп по строке: ведущий (right-swipe) и ведомые (left-swipe) действия.
// API:
//   SwipeActionRow(leading: SwipeAction?, trailing: [SwipeAction]) { content }
//   SwipeAction(label:systemImage:tint:handler:)

struct SwipeAction {
    let label: String
    let systemImage: String
    let tint: Color
    let handler: () -> Void
}

struct SwipeActionRow<Content: View>: View {
    var leading: SwipeAction? = nil
    var trailing: [SwipeAction] = []
    @ViewBuilder var content: () -> Content

    @GestureState private var dragX: CGFloat = 0
    @State private var offsetX: CGFloat = 0

    private let revealWidth: CGFloat = 80

    var body: some View {
        ZStack(alignment: .leading) {
            // Leading action background (right-swipe reveals left edge)
            if let la = leading {
                HStack {
                    actionCell(la, side: .leading)
                        .frame(width: max(0, offsetX))
                    Spacer(minLength: 0)
                }
            }
            // Trailing action backgrounds (left-swipe reveals right edge)
            if !trailing.isEmpty {
                HStack {
                    Spacer(minLength: 0)
                    HStack(spacing: 0) {
                        ForEach(Array(trailing.enumerated()), id: \.offset) { _, action in
                            actionCell(action, side: .trailing)
                                .frame(width: max(0, -offsetX) / CGFloat(trailing.count))
                        }
                    }
                    .frame(width: max(0, -offsetX))
                }
            }

            // Main content row
            content()
                .offset(x: offsetX)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { v in
                            let raw = v.translation.width
                            if raw > 0 && leading != nil {
                                offsetX = min(raw, revealWidth * 1.3)
                            } else if raw < 0 && !trailing.isEmpty {
                                offsetX = max(raw, -revealWidth * CGFloat(trailing.count) * 1.3)
                            }
                        }
                        .onEnded { v in
                            let raw = v.translation.width
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                if raw > revealWidth * 0.5 && leading != nil {
                                    offsetX = revealWidth
                                } else if raw < -(revealWidth * 0.5) && !trailing.isEmpty {
                                    offsetX = -revealWidth * CGFloat(trailing.count)
                                } else {
                                    offsetX = 0
                                }
                            }
                        }
                )
                .simultaneousGesture(TapGesture().onEnded {
                    if offsetX != 0 { withAnimation(.spring(response: 0.3)) { offsetX = 0 } }
                })
        }
        .clipped()
    }

    private enum Side { case leading, trailing }

    private func actionCell(_ action: SwipeAction, side: Side) -> some View {
        Button {
            withAnimation(.spring(response: 0.25)) { offsetX = 0 }
            action.handler()
        } label: {
            VStack(spacing: 5) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 17, weight: .semibold))
                Text(action.label)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(action.tint)
        }
        .buttonStyle(.plain)
    }
}
