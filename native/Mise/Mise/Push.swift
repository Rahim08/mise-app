import UIKit
import UserNotifications

/// Регистрация APNs-токена и его выгрузка в push_subscriptions, плюс показ баннеров
/// в активном приложении. Серверная доставка — lib/apns.ts (после подключения APNs-ключа).
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()
    private let d = UserDefaults.standard

    /// Запросить токен у системы (разрешение на уведомления запрашивается отдельно в онбординге).
    func registerForPush() {
        UNUserNotificationCenter.current().delegate = self
        DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// Колбэк AppDelegate: получили device-токен.
    func didRegister(token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        d.set(hex, forKey: "mise_apns_token")
        Task { await upload(token: hex) }
    }

    /// Привязать токен к текущему ресторану и пользователю (владелец → to_owner).
    func upload(token: String) async {
        guard d.data(forKey: "mise_restaurant") != nil,
              let sData = d.data(forKey: "mise_staff"),
              let s = try? JSONDecoder().decode(AppModel.ResolvedStaff.self, from: sData) else { return }
        var values: [String: Any] = [
            "platform": "ios",
            "device_token": token,
            "last_seen": ISO8601DateFormatter().string(from: Date()),
        ]
        if s.isOwner {
            values["to_owner"] = true
            values["staff_id"] = NSNull()
        } else {
            values["to_owner"] = false
            values["staff_id"] = s.id
        }
        // restaurant_id форсируется на сервере по сессии.
        try? await DB.from("push_subscriptions").upsert(values, onConflict: "restaurant_id,device_token").run()
    }

    /// Повторная выгрузка сохранённого токена (например, после смены пользователя на устройстве).
    func reuploadIfPossible() {
        if let token = d.string(forKey: "mise_apns_token") {
            Task { await upload(token: token) }
        }
    }

    // Показывать баннер, даже когда приложение открыто.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
}

/// AppDelegate только ради колбэков APNs — остальное приложение остаётся на SwiftUI App.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushManager.shared
        return true
    }
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(token: deviceToken)
    }
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Без APNs-окружения (симулятор / нет capability) — просто молчим.
    }
}

/// Клиент к /api/notify — триггерит уведомление (журнал + push) для аудитории.
enum Notify {
    /// audience: ключи "managers": true, "owner": true, "staff_ids": [..].
    static func send(type: String, title: String, body: String, audience: [String: Any], secureBody: String? = nil, data: [String: Any]? = nil) async {
        guard let url = URL(string: API.base + "/api/notify") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["type": type, "title": title, "body": body, "audience": audience]
        if let secureBody { payload["secureBody"] = secureBody }
        if let data { payload["data"] = data }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await URLSession.shared.data(for: req)
    }
}
