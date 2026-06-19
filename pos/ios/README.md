# MisePOS — iOS App

## Создание Xcode проекта

1. Открой Xcode → File → New → Project
2. Выбери **iOS → App**
3. Настройки:
   - Product Name: `MisePOS`
   - Bundle Identifier: `com.misesuite.pos`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Minimum Deployments: **iOS 17.0**
4. Сохрани в папку `pos/ios/`

## Добавить Swift файлы

После создания проекта скопируй все `.swift` файлы из этой папки в проект:

```
pos/ios/MisePOS/
├── App/
│   ├── MisePOSApp.swift
│   └── AppModel.swift
├── Network/
│   ├── NetworkManager.swift
│   └── Protocol.swift
├── Models/
│   └── Models.swift
└── Views/
    ├── RootView.swift
    └── Floor/
        └── FloorView.swift
```

## Info.plist — необходимые ключи

Добавь в Info.plist:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Mise POS использует локальную сеть для связи с кассовым сервером</string>
<key>NSBonjourServices</key>
<array>
    <string>_mise-pos._tcp</string>
</array>
```

## Запуск сервера

```bash
cd pos/server
bun install
bun dev
```

Сервер будет виден в локальной сети как `mise-pos.local:8080`.
