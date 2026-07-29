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
        // lang — читаем на MainActor (L10n изолирован); нужен серверу, чтобы рендерить пуш
        // для ЭТОГО устройства на его языке, а не языке отправителя (см. lib/notifyStrings.ts).
        let lang = await MainActor.run { L10n.shared.lang.rawValue }
        var values: [String: Any] = [
            "platform": "ios",
            "device_token": token,
            "lang": lang,
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
        do {
            try await DB.from("push_subscriptions").upsert(values, onConflict: "restaurant_id,device_token").run()
            d.set(false, forKey: "mise_push_upload_pending")
        } catch {
            // Не теряем ошибку молча — отметим и повторим при следующем возврате в foreground.
            d.set(true, forKey: "mise_push_upload_pending")
        }
    }

    /// Повторная выгрузка сохранённого токена (например, после смены пользователя на устройстве,
    /// или после неудачной попытки — см. mise_push_upload_pending в upload(token:)).
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

    // Тап по системному пуш-баннеру — тот же payload.type, что и в журнале уведомлений
    // (см. lib/apns.ts: payload = { aps, ...data }, data.type приходит из lib/notify.ts).
    // Постим через NotificationCenter (как quickAction) — RootView решает куда роутить,
    // у PushManager нет прямого доступа к живому AppModel.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let type = info["type"] as? String {
            // userInfo целиком (booking_date и т.п. — плоские ключи, см. lib/apns.ts) —
            // для точного перехода не только в модуль, но и на конкретную запись.
            NotificationCenter.default.post(name: .pushTapped, object: type, userInfo: info)
        }
        completionHandler()
    }
}

/// Пересобирает Quick Actions с текущими переводами — вызывается при старте и при смене
/// языка (иначе титулы остаются на языке запуска до перезапуска приложения).
@MainActor func refreshQuickActionShortcuts() {
    UIApplication.shared.shortcutItems = [
        UIApplicationShortcutItem(type: "com.rahim.mise.openBookings",
                                  localizedTitle: t("qa.todayBookings"),
                                  localizedSubtitle: nil,
                                  icon: UIApplicationShortcutIcon(systemImageName: "calendar.badge.clock"),
                                  userInfo: nil),
        UIApplicationShortcutItem(type: "com.rahim.mise.openManager",
                                  localizedTitle: t("qa.openShift"),
                                  localizedSubtitle: nil,
                                  icon: UIApplicationShortcutIcon(systemImageName: "creditcard.fill"),
                                  userInfo: nil),
        UIApplicationShortcutItem(type: "com.rahim.mise.addExpense",
                                  localizedTitle: t("qa.addExpense"),
                                  localizedSubtitle: nil,
                                  icon: UIApplicationShortcutIcon(systemImageName: "plus.circle"),
                                  userInfo: nil),
    ]
}

/// AppDelegate только ради колбэков APNs + Quick Actions — остальное приложение остаётся на SwiftUI App.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushManager.shared
        refreshQuickActionShortcuts()
        return true
    }

    func application(_ application: UIApplication,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        NotificationCenter.default.post(name: .quickAction, object: shortcutItem.type)
        completionHandler(true)
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(token: deviceToken)
    }
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("[Push] registerForRemoteNotifications failed: \(error)")
        #endif
    }
}

extension Notification.Name {
    nonisolated static let quickAction = Notification.Name("mise.quickAction")
    nonisolated static let pushTapped = Notification.Name("mise.pushTapped")
}

/// Планировщик локальных уведомлений (напоминание о смене).
enum ShiftReminder {
    private static let identifier = "com.rahim.mise.shiftReminder"

    /// Запланировать напоминание через hours часов.
    static func schedule(hours: Int = 8) {
        let content = UNMutableNotificationContent()
        content.title = t("shift.reminderTitle")
        content.body = t("shift.reminderBody")
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(hours * 3600), repeats: false)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    /// Отменить запланированное напоминание.
    static func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }

    /// Проверить, включены ли напоминания в настройках.
    static func isEnabled() -> Bool {
        let prefs = UserDefaults.standard.dictionary(forKey: "mise_notif_prefs") as? [String: Bool]
        return prefs?["shift_reminder"] ?? true // по умолчанию включено
    }
}

/// Клиент к /api/notify — триггерит уведомление (журнал + push) для аудитории.
enum Notify {
    /// audience: ключи "managers": true, "owner": true, "staff_ids": [..].
    /// title/body — литерал на языке отправителя, используется только как фолбэк для старых
    /// клиентов/cron. Когда заданы titleKey/bodyKey — сервер рендерит РЕАЛЬНЫЙ текст на языке
    /// КАЖДОГО получателя (push_subscriptions.lang) из lib/notifyStrings.ts, игнорируя title/body.
    /// secureBodySegments: [{"key": "notify.dRevenue", "value": "€120.00"}, ...] — лейбл каждого
    /// сегмента переводится сервером на язык получателя, value (готовая сумма) — как есть.
    static func send(type: String, title: String, body: String, audience: [String: Any],
                      titleKey: String? = nil, titleParams: [String: String]? = nil,
                      bodyKey: String? = nil, bodyParams: [String: String]? = nil,
                      bodySegments: [[String: String]]? = nil,
                      secureBody: String? = nil, secureBodySegments: [[String: String]]? = nil,
                      data: [String: Any]? = nil) async {
        guard let url = URL(string: API.base + "/api/notify") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["type": type, "title": title, "body": body, "audience": audience]
        if let titleKey { payload["titleKey"] = titleKey }
        if let titleParams { payload["titleParams"] = titleParams }
        if let bodyKey { payload["bodyKey"] = bodyKey }
        if let bodyParams { payload["bodyParams"] = bodyParams }
        if let bodySegments { payload["bodySegments"] = bodySegments }
        if let secureBody { payload["secureBody"] = secureBody }
        if let secureBodySegments { payload["secureBodySegments"] = secureBodySegments }
        if let data { payload["data"] = data }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await URLSession.shared.data(for: req)
    }
}
