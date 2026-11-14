import Foundation
import Observation

nonisolated func bookingDateKey(_ date: Date) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: date)
}

/// Stable identity is supplied by the server. Legacy read fixtures never merge by name or suffix.
nonisolated func bookingGuestKey(_ booking: Booking) -> String {
    if let key = booking.guest_key?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty { return key }
    let digits = (booking.phone ?? "").unicodeScalars.compactMap { (48...57).contains($0.value) ? String($0) : nil }.joined()
    return digits.isEmpty ? "booking:" + booking.id : "phone:" + digits
}

nonisolated func bookingHasCanonicalGuestKey(_ key: String) -> Bool {
    key.hasPrefix("g:") && UUID(uuidString: String(key.dropFirst(2))) != nil
}

nonisolated func bookingIsVisit(_ booking: Booking, today: String) -> Bool {
    guard let day = booking.booking_date, day <= today,
          booking.status != "cancelled", booking.status != "no_show" else { return false }
    return day < today || booking.status == "arrived"
}

@MainActor func bookingError(_ key: String) -> NSError {
    NSError(domain: "Booking", code: 1, userInfo: [NSLocalizedDescriptionKey: t(key)])
}

/// Shared by both editors: keep their input and stable create ID after failed requests.
@MainActor @Observable final class BookingSaveState {
    let id = UUID().uuidString.lowercased()
    var saving = false
    var error: String?

    func perform(_ operation: () async throws -> Void) async -> Bool {
        guard !saving else { return false }
        saving = true; error = nil
        defer { saving = false }
        do { try await operation(); return true }
        catch { self.error = error.localizedDescription; return false }
    }
}

nonisolated struct BookingGuestDetails: Codable, Sendable, Equatable {
    var note: String? = nil
    var last_name: String? = nil
    var email: String? = nil
    var birthday: String? = nil
}

@MainActor enum BookingGuestService {
    static func update(key: String, name: String? = nil, phone: String? = nil, profile: [String: Any] = [:]) async throws {
        guard bookingHasCanonicalGuestKey(key) else { throw bookingError("gs.refreshProfile") }
        var args: [String: Any] = ["p_guest_key": key]
        if let name { args["p_name"] = name }
        if let phone { args["p_phone"] = phone }
        if !profile.isEmpty { args["p_profile"] = profile }
        _ = try await API.dbRequest(["op": "rpc", "fn": "booking_guest_update", "args": args])
    }

    static func delete(key: String) async throws {
        guard bookingHasCanonicalGuestKey(key) else { throw bookingError("gs.refreshProfile") }
        _ = try await API.dbRequest(["op": "rpc", "fn": "booking_guest_delete", "args": ["p_guest_key": key]])
    }
}

/// Each editor/detail owns its loader, so a late response cannot populate another guest.
@MainActor @Observable final class BookingGuestDetailsModel {
    let key: String
    var details = BookingGuestDetails()
    var loading = false
    var loaded = false
    var error: String?
    private var generation = 0

    init(key: String) { self.key = key }

    func load() async {
        generation += 1
        let request = generation
        loading = true; loaded = false; error = nil
        defer { if request == generation { loading = false } }
        do {
            let row = try await DB.from("guest_notes").fresh().select().eq("guest_key", key).single(BookingGuestDetails.self)
            guard request == generation, !Task.isCancelled else { return }
            details = row ?? BookingGuestDetails()
            loaded = true
        } catch {
            guard request == generation, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}
