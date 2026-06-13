# App Store — App Review (заметки для ревьюера)

Готовый материал для подачи в App Store Connect. Демо-данные заливаются скриптом
`docs/migrations/demo-seed.sql` (Supabase → SQL Editor → Run).

---

## App Store Connect → App Review Information

**Sign-In required:** Yes

| Поле | Значение |
|------|----------|
| User name | `demo@getmise.app` |
| Password  | `MiseDemo2026!` |

### Notes (вставить в поле «Notes»)

```
Mise is a restaurant management suite. The owner signs in with the email and
password above; everything below is reachable from that single account — no QR
or PIN is required for this demo account.

How to review:
1. On the landing screen tap “Sign in”, enter the credentials above.
2. You land on the owner Dashboard. Open each app from the home grid:
   • Manager — open/close a shift, cash & card revenue, expenses, cash collection.
     (Today’s shift is left OPEN so you can see a live shift.)
   • Analytics — revenue by day/week/month, payroll, the “Hookah” tab, and the
     AI assistant (Pro plan).
   • Stash — tobacco stock (two items show a low-stock alert) and the hookah shift.
   • People — staff, weekly schedule, attendance, and the live orders inbox.
   • Menu — the menu editor. The public guest menu is at:
     https://mise-app-omega.vercel.app/menu/demo

Permissions you may be prompted for (all optional, only when the feature is used):
   • Camera — only inside a staff QR sign-in screen (not needed for this demo).
   • Location — only when a staff member taps “I’m here” to check in for a shift.
   • Face ID — optional fast sign-in offered after a PIN entry.

The demo account is on the Pro plan with an active subscription, so every feature
is unlocked. No real payment is processed for the demo account.
```

---

## Что увидит ревьюер (флоу)

```
iOS app (WKWebView → live Vercel) → Landing → «Sign in»
   → /auth/login (demo@getmise.app / MiseDemo2026!)
   → Dashboard (план Pro, подписка active, owner_pin = NULL)
       → Manager / Analytics / Stash / People / Menu — открываются без QR/PIN
```

Почему без QR/PIN: при наличии Supabase-сессии владельца и `owner_pin = NULL`
`AuthGate` пускает во все приложения напрямую (`components/AuthGate.tsx` → `onAuth`).

## Privacy / разрешения (App Privacy + Info.plist)

Usage-строки прописаны в `ios/App/App/Info.plist`:

| Ключ | Зачем |
|------|-------|
| `NSCameraUsageDescription` | сканирование QR для привязки устройства сотрудника |
| `NSLocationWhenInUseUsageDescription` | гео-подтверждение прихода на смену («Я пришёл») |
| `NSFaceIDUsageDescription` | быстрый вход по Face ID после PIN |

Локация запрашивается **только** по явному действию сотрудника (foreground, без
фонового трекинга) — это важно отразить в App Privacy («Location → App Functionality»,
не linked to identity, not used for tracking).

## После одобрения

Надёжный способ удалить демо-аккаунт целиком — запустить секцию «0. ОЧИСТКА» из
`demo-seed.sql` (она удаляет все дочерние данные по демо-ресторану, затем сам
ресторан, identity и пользователя). Достаточно выполнить только этот блок DO.

Быстрое удаление пользователя `delete from auth.users where email = 'demo@getmise.app';`
сработает, только если FK `restaurants.owner_id` настроен на `ON DELETE CASCADE` —
не во всех проектах это так, поэтому надёжнее секция «ОЧИСТКА».
