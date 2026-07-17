import SwiftUI
import Charts

// MARK: - GoogleReviewsView — Google-отзывы (Places API sync)
//
// Read-only: владелец подключает Place ID + свой API-ключ в веб-панели (Settings),
// сервер (cron + sync-now) пишет снэпшоты рейтинга и отзывы. Здесь только читаем и рисуем.

private let RV_ACCENT = BrandKit.bookings

private nonisolated struct PlaceIdRow: Codable, Sendable { let google_place_id: String? }

@MainActor
@Observable
final class GoogleReviewsModel {
    var configured: Bool?
    var reviews: [GoogleReview] = []
    var snapshots: [GoogleRatingSnapshot] = []

    func load() async {
        guard let row = try? await DB.from("restaurant_settings").select("google_place_id").limit(1).list(PlaceIdRow.self).first,
              row.google_place_id?.isEmpty == false else {
            configured = false
            return
        }
        configured = true
        async let r = DB.from("google_reviews").select().order("review_time", ascending: false).list(GoogleReview.self)
        async let s = DB.from("google_rating_snapshots").select("captured_at, rating, ratings_total").order("captured_at").limit(90).list(GoogleRatingSnapshot.self)
        reviews = (try? await r) ?? []
        snapshots = (try? await s) ?? []
    }
}

struct GoogleReviewsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var m = GoogleReviewsModel()

    private var latest: GoogleRatingSnapshot? { m.snapshots.last }

    // SF Symbols вместо текстовых глифов ★☆ (правило «без эмодзи/глифов в продукте»).
    private func stars(_ n: Int?) -> some View {
        let f = max(0, min(5, n ?? 0))
        return HStack(spacing: 1) {
            ForEach(0..<5, id: \.self) { i in
                Image(systemName: i < f ? "star.fill" : "star").font(.system(size: 11))
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Group {
                    if m.configured == nil {
                        ProgressView()
                    } else if m.configured == false {
                        emptyState
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                statsRow
                                if m.snapshots.count >= 2 { trendCard }
                                reviewsList
                            }
                            .padding(16)
                        }
                    }
                }
            }
            .navigationTitle(t("bk.rvTitle")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { dismiss() } } }
        }
        .task { await m.load() }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "star.fill").font(.system(size: 34, weight: .light)).foregroundStyle(RV_ACCENT)
            Text(t("bk.rvNotConfigured")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
            Text(t("bk.rvNotConfiguredSub")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                .multilineTextAlignment(.center).padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 60)
    }

    private var statsRow: some View {
        HStack(spacing: 10) {
            statCard(t("bk.rvRating"), latest?.rating.map { String(format: "%.1f", $0) } ?? "—")
            statCard(t("bk.rvTotal"), latest?.ratings_total.map(String.init) ?? "—")
        }
    }

    private func statCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
            Text(value).font(.system(size: 22, weight: .bold)).foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var trendCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("bk.rvTrend")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            Chart(Array(m.snapshots.enumerated()), id: \.offset) { i, s in
                LineMark(x: .value("i", i), y: .value(t("bk.rvRating"), s.rating ?? 0))
                    .foregroundStyle(RV_ACCENT)
                    .interpolationMethod(.monotone)
            }
            .chartYScale(domain: 1...5)
            .chartXAxis(.hidden)
            .frame(height: 120)
        }
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var reviewsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("bk.rvList")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            if m.reviews.isEmpty {
                Text(t("bk.rvNone")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5)).padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(m.reviews) { r in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(r.author_name?.isEmpty == false ? r.author_name! : t("bk.rvAnon"))
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                                Spacer()
                                if let rt = r.relative_time { Text(rt).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4)) }
                            }
                            stars(r.rating).foregroundStyle(RV_ACCENT)
                            if let txt = r.review_text, !txt.isEmpty {
                                Text(txt).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.7))
                            }
                        }
                        .padding(.vertical, 10)
                        Divider().opacity(0.15)
                    }
                }
            }
        }
    }
}
