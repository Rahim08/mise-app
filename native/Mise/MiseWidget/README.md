# Mise Widget — настраиваемые виджеты (готово, собирается)

Widget Extension target **создан в Xcode** (`MiseWidgetExtension`, схема `MiseWidgetExtension`), встроен в приложение,
App Group подключён к обоим таргетам. `xcodebuild -scheme Mise` и `-scheme MiseWidgetExtension` → **BUILD SUCCEEDED**.

## Состав
- `MiseWidget.swift` — виджет: домашний экран (small/medium) **+ локскрин** (`.accessoryCircular/.accessoryRectangular/.accessoryInline`), deep-link по тапу (`mise://analytics|stash|bookings`).
- `MiseWidgetBundle.swift` — `@main WidgetBundle`.
- `MiseWidgetIntent.swift` — `AppIntentConfiguration` (метрика: Касса/Кальяны/Брони + акцент).
- `WidgetShared.swift` — Codable-снапшот (`MiseSnapshot`, `SnapBooking`, `MiseSnapshotStore`, `SnapMoney`). Копия лежит и в `Mise/` (app target), и здесь (widget target) — folder-synchronized группы не дают шарить один файл в два таргета.
- `Info.plist`, `MiseWidget.entitlements` — конфиг таргета (App Group `group.com.rahim.mise`).
- `Assets.xcassets` — ассеты расширения.

Сторона приложения (target Mise):
- `Mise/WidgetSnapshot.swift` — `SnapshotWriter`: считает снапшот (касса дня / кальяны / ближайшие брони) из лёгких DB-запросов и пишет в App Group; `WidgetCenter.reloadAllTimelines()`.
- `Mise/MiseShortcuts.swift` — Siri / App Shortcuts («Выручка сегодня», «Брони сегодня»). Лежит в app target, чтобы фразы обнаруживались из основного бандла.
- Вызовы: `MainView` — `.task`/`scenePhase==.active` → `SnapshotWriter.refresh`; `AppModel.logout()` → `SnapshotWriter.clear()`.
- `RootView.onOpenURL` — тап по виджету (`mise://…`) открывает нужный модуль (отложенно, если ещё не авторизован).

## Архитектура
Виджет **не ходит в сеть**: приложение пишет маленький снапшот в App Group, виджет читает. Конфигурация (что показывать) — `AppIntentConfiguration`, на каждый экземпляр виджета.

## pbxproj-нюанс (если ломается сборка)
`MiseWidget` — `PBXFileSystemSynchronizedRootGroup`, поэтому `Info.plist` авто-попадал и в Copy-Resources, и в `INFOPLIST_FILE` → ошибка «Multiple commands produce Info.plist». Лечится `PBXFileSystemSynchronizedBuildFileExceptionSet` с `membershipExceptions = (Info.plist, README.md)` для таргета `MiseWidgetExtension` (уже прописано).

## Не сделано (обсудить)
- **Интерактивные кнопки в виджете** (отметить «пришёл» из виджета): нужен доступ к DB/auth из расширения через App Group — отдельный этап.
- **Live Activity** (живая смена) — отдельный этап.
