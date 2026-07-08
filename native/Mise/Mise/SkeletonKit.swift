import SwiftUI

// MARK: - Base block
// Each block independently pulses; since all appear in the same render pass
// their animations stay visually in sync.

struct Sk: View {
    var w: CGFloat? = nil
    var h: CGFloat = 14
    var r: CGFloat = 7

    @State private var on = false

    var body: some View {
        RoundedRectangle(cornerRadius: r)
            .fill(Color.primary.opacity(on ? 0.13 : 0.06))
            .frame(width: w, height: h)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    on = true
                }
            }
    }
}

// MARK: - Manager skeleton

struct ManagerSkeleton: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    HStack {
                        Sk(w: 32, h: 32, r: 9)
                        Spacer()
                        VStack(spacing: 5) { Sk(w: 130, h: 16); Sk(w: 80, h: 11, r: 4) }
                        Spacer()
                        Sk(w: 32, h: 32, r: 9)
                    }

                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2),
                        spacing: 10
                    ) {
                        ForEach(0..<4, id: \.self) { _ in
                            VStack(spacing: 8) { Sk(w: 80, h: 22, r: 6); Sk(w: 55, h: 11, r: 4) }
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                        }
                    }

                    VStack(spacing: 0) {
                        ForEach(0..<5, id: \.self) { i in
                            HStack {
                                Sk(w: 110, h: 13)
                                Spacer()
                                Sk(w: 64, h: 36, r: 10)
                            }
                            .padding(.vertical, 11).padding(.horizontal, 14)
                            if i < 4 {
                                Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14)
                            }
                        }
                    }
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

                    Sk(h: 52, r: 16)
                }
                .padding(16)
            }
        }
    }
}

// MARK: - Stash shift tab (used inside AppTabPage — no extra scroll/bg needed)

struct ShiftTabSkeleton: View {
    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(spacing: 6) { Sk(w: 50, h: 20, r: 5); Sk(w: 45, h: 10, r: 4) }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                }
            }

            VStack(spacing: 0) {
                ForEach(0..<6, id: \.self) { i in
                    HStack {
                        VStack(alignment: .leading, spacing: 6) { Sk(w: 120, h: 14); Sk(w: 80, h: 10, r: 4) }
                        Spacer()
                        Sk(w: 64, h: 36, r: 10)
                    }
                    .padding(.vertical, 11).padding(.horizontal, 14)
                    if i < 5 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

// MARK: - Analytics skeleton

struct AnalyticsSkeleton: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Sk(w: 28, h: 28, r: 7)
                    Spacer()
                    Sk(w: 130, h: 16)
                    Spacer()
                    Sk(w: 28, h: 28, r: 7)
                }
                .padding(.horizontal, 20).padding(.vertical, 14)

                Divider().overlay(Color.primary.opacity(0.08))

                ScrollView {
                    VStack(spacing: 12) {
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2),
                            spacing: 10
                        ) {
                            ForEach(0..<4, id: \.self) { _ in
                                VStack(spacing: 8) { Sk(w: 90, h: 24, r: 6); Sk(w: 60, h: 12, r: 4) }
                                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                            }
                        }

                        VStack(spacing: 0) {
                            ForEach(0..<6, id: \.self) { i in
                                HStack {
                                    Sk(w: 36, h: 12)
                                    Spacer()
                                    Sk(w: 54, h: 12)
                                    Spacer()
                                    Sk(w: 54, h: 12)
                                    Spacer()
                                    Sk(w: 54, h: 12)
                                }
                                .padding(.vertical, 10).padding(.horizontal, 14)
                                if i < 5 { Divider().overlay(Color.primary.opacity(0.07)) }
                            }
                        }
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                    }
                    .padding(16)
                }
            }
        }
    }
}

// MARK: - Generic row list (inline loading — People sub-tabs, Bookings/News reloads)
//
// One reusable shape for "list of cards" loading states instead of a bare ProgressView() —
// avatar circle is optional since some lists (reports, checklists) don't have one.

struct RowListSkeleton: View {
    var rows: Int = 4
    var avatar: Bool = false

    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: 12) {
                    if avatar { Sk(w: 38, h: 38, r: 19) }
                    VStack(alignment: .leading, spacing: 6) { Sk(w: 150, h: 14); Sk(w: 100, h: 10, r: 4) }
                    Spacer()
                }
                .padding(12)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}

// MARK: - Bookings skeleton

struct BookingsSkeleton: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            VStack(spacing: 12) {
                Sk(h: 40, r: 12)          // поиск
                Sk(h: 32, r: 8)           // сегмент-контрол диапазона
                ScrollView {
                    RowListSkeleton(rows: 5)
                }
            }
            .padding(16)
        }
    }
}

// MARK: - News skeleton

struct NewsSkeleton: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(0..<4, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Sk(w: 24, h: 24, r: 6); Sk(w: 90, h: 12, r: 4); Spacer() }
                            Sk(w: 200, h: 15)
                            Sk(h: 12, r: 4)
                            Sk(w: 240, h: 12, r: 4)
                        }
                        .padding(14)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                    }
                }
                .padding(16)
            }
        }
    }
}

// MARK: - People skeleton

struct PeopleSkeleton: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    VStack(spacing: 10) {
                        HStack {
                            Sk(w: 24, h: 24, r: 6)
                            Spacer()
                            Sk(w: 110, h: 15)
                            Spacer()
                            Sk(w: 24, h: 24, r: 6)
                        }
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.flexible()), count: 7),
                            spacing: 6
                        ) {
                            ForEach(0..<35, id: \.self) { _ in Sk(h: 32, r: 8) }
                        }
                    }
                    .padding(14)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

                    ForEach(0..<5, id: \.self) { _ in
                        HStack(spacing: 12) {
                            Sk(w: 42, h: 42, r: 21)
                            VStack(alignment: .leading, spacing: 6) { Sk(w: 130, h: 14); Sk(w: 90, h: 10, r: 4) }
                            Spacer()
                            Sk(w: 80, h: 30, r: 8)
                        }
                        .padding(12)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(16)
            }
        }
    }
}
