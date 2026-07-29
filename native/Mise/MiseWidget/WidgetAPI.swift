import Foundation

// MARK: - Minimal network call for widget-side actions
//
// The widget extension is otherwise read-only (see WidgetShared.swift) — this is the one
// exception: marking a booking "arrived" straight from the widget without opening the app.
// Auth rides on the PIN-session cookie the main app wrote into the shared App Group
// container via MiseSharedSession (see API.swift), so no separate login is needed here.

enum WidgetAPI {
    private static let base = "https://www.misesuite.com"

    static func setBookingArrived(id: String) async throws {
        guard let url = URL(string: base + "/api/db") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "table": "bookings",
            "op": "update",
            "values": ["status": "arrived"],
            "filters": [["col": "id", "op": "eq", "val": id]],
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, resp) = try await MiseSharedSession.session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
