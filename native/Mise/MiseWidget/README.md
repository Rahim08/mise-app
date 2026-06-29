# Mise Widget — настраиваемые виджеты (готов код, нужен шаг в Xcode)

Виджеты спроектированы и написаны, но **Widget Extension target должен быть добавлен вручную в Xcode**
(создание таргета через правку `project.pbxproj` вслепую ненадёжно — в проде это риск для подписи/сборки).
Эти файлы пока НЕ компилируются (лежат в папке-сиблинге, вне таргета приложения), поэтому приложение собирается как обычно.

## Что здесь
- `MiseWidget.swift`, `MiseWidgetBundle.swift`, `MiseWidgetIntent.swift` — код виджета (WidgetKit + App Intents конфигурация).
- `Info.plist`, `MiseWidget.entitlements` — для таргета расширения.
- `../Shared/WidgetShared.swift` — общие Codable-типы снапшота (`MiseSnapshot`, `SnapBooking`, `MiseSnapshotStore`). Должны входить в ОБА таргета (app + widget).
- `WidgetSnapshot.swift.appside` — писатель снапшота на стороне приложения (переименовать в `.swift` и добавить в таргет Mise при wiring).

## Идея архитектуры
Виджет не делает сетевых запросов: приложение пишет маленький снапшот (касса дня / кальяны / ближайшие брони)
в общий App Group, виджет его читает. Конфигурация (что показывать) — через `AppIntentConfiguration`.

## Шаги в Xcode (≈10 мин)
1. **File → New → Target → Widget Extension**, имя `MiseWidget`, снять «Include Live Activity», встроить в app.
2. Удалить авто-сгенерированные файлы нового таргета, перетащить сюда лежащие `MiseWidget*.swift` + `Info.plist` + `MiseWidget.entitlements` (membership = только MiseWidget).
3. `Shared/WidgetShared.swift` → Target Membership: **Mise И MiseWidget** (галочки оба).
4. Переименовать `WidgetSnapshot.swift.appside` → `WidgetSnapshot.swift`, переместить в `Mise/`, membership = **Mise**.
5. **Signing & Capabilities** → у обоих таргетов добавить **App Group** `group.com.rahim.mise` (или свой; согласовать с suite в коде).
6. В `MainView.swift` вызвать запись снапшота (например, `.task { await SnapshotWriter.refresh() }` + `WidgetCenter.shared.reloadAllTimelines()`), как в `WidgetSnapshot.swift.appside`.
7. Собрать схему MiseWidget, добавить виджет на экран, проверить конфигурацию метрики.

⚠️ App Group требует регистрации в provisioning — при автоподписи Xcode сделает сам, но аккаунт должен поддерживать App Groups.

После добавления таргета — скажи, помогу довести wiring/дизайн.
