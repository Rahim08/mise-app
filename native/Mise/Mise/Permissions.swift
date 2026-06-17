import UserNotifications
import CoreLocation

enum Notifications {
    /// Запрос разрешения на уведомления. Работает и без платного аккаунта (локальные);
    /// удалённые push заработают после настройки APNs (Apple Developer account).
    static func request() async -> Bool {
        (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    }
}

/// Запрос «когда используется» для отметки «Я пришёл» на смене.
final class LocationRequester: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var cont: CheckedContinuation<Void, Never>?

    func request() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            cont = c
            manager.delegate = self
            if manager.authorizationStatus == .notDetermined {
                manager.requestWhenInUseAuthorization()
            } else {
                resume()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { resume() }
    }

    private func resume() {
        cont?.resume()
        cont = nil
    }
}

/// Одноразовое получение текущих координат (для чек-ина «Я пришёл»).
final class LocationOneShot: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var cont: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    func current() async -> CLLocationCoordinate2D? {
        await withCheckedContinuation { (c: CheckedContinuation<CLLocationCoordinate2D?, Never>) in
            cont = c
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            let status = manager.authorizationStatus
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                manager.requestLocation()
            } else if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
            } else {
                finish(nil)
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let s = m.authorizationStatus
        if s == .authorizedWhenInUse || s == .authorizedAlways { m.requestLocation() }
        else if s == .denied || s == .restricted { finish(nil) }
    }
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        finish(locs.first?.coordinate)
    }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) { finish(nil) }

    private func finish(_ coord: CLLocationCoordinate2D?) {
        cont?.resume(returning: coord); cont = nil
    }
}

/// Расстояние между двумя координатами в метрах.
func distanceMeters(_ a: CLLocationCoordinate2D, _ lat: Double, _ lng: Double) -> Double {
    CLLocation(latitude: a.latitude, longitude: a.longitude)
        .distance(from: CLLocation(latitude: lat, longitude: lng))
}
