import AuthenticationServices
import UIKit

// Открывает consent-ссылку банка (Enable Banking /auth) в системном web-authentication
// флоу и ждёт редиректа на com.rahim.mise://bank-callback — конечную точку, на которую
// сервер шлёт после успешного/неуспешного обмена кода (см. ветка `platform=ios` в
// app/api/bank/callback/route.ts). Обычный WKWebView/SFSafariViewController не подошёл
// бы: у него нет staff-cookie нашего URLSession (отдельный контекст), поэтому колбэк на
// сервере авторизуется не сессией, а одноразовым `state`.
//
// Схема reverse-DNS, не голое "mise" (аудит 2026-08-15, block-B: RFC 8252 §7.1 — bare-word
// custom-схему потенциально может зарегистрировать другое приложение). Для
// ASWebAuthenticationSession регистрация в Info.plist не обязательна (система сама роутит
// колбэк САМО́Й запустившей сессию), но диплинк из виджета (RootView.swift) — обязательна,
// поэтому схема теперь и в InfoPlistSupport/URLSchemes.plist.
@MainActor
final class BankAuthCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    func present(url: URL) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "com.rahim.mise") { [weak self] callbackURL, error in
                self?.session = nil
                if let error {
                    // Пользователь закрыл шторку/отменил согласие — не показываем это как
                    // ошибку сервера, просто тихо выходим.
                    let ns = error as NSError
                    if ns.domain == ASWebAuthenticationSessionErrorDomain,
                       ns.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        cont.resume(returning: ()); return
                    }
                    cont.resume(throwing: error); return
                }
                guard let callbackURL, let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    cont.resume(throwing: APIError.decode); return
                }
                if let errMsg = comps.queryItems?.first(where: { $0.name == "error" })?.value {
                    cont.resume(throwing: APIError.http(400, errMsg)); return
                }
                cont.resume(returning: ())
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = true
            self.session = s
            s.start()
        }
    }
}
