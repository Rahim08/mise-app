# Mise — нативная сборка iOS (Capacitor, гибридная модель)

Приложение упаковано как **гибрид**: нативная оболочка iOS открывает живой сайт на Vercel
(`server.url` в `capacitor.config.ts`). SSR, API-роуты и middleware остаются на сервере —
переписывать ничего не нужно. `webDir: capacitor-www` — это офлайн-заглушка.

## Предварительно (один раз, на Mac)

```bash
# Xcode уже установлен (26.5). Доустановить CocoaPods:
sudo gem install cocoapods
# или: brew install cocoapods
```

## Добавить платформу iOS

```bash
cd ~/mise-app
npx cap add ios        # создаст папку ios/ и поставит поды
npx cap sync ios       # синхронизировать конфиг/плагины
```

> `cap add ios` коммитить в git можно — папка `ios/` версионируется.

## Разрешения в Info.plist

`AuthGate` использует камеру (сканер QR). Добавить в `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Сканирование QR-кода заведения для входа</string>
```

(Face ID/биометрия — после перевода на нативный плагин, см. задачу безопасности.)

## Открыть в Xcode, подписать, запустить

```bash
npx cap open ios
```

В Xcode → target **App** → *Signing & Capabilities*:
- выбрать Team (Apple Developer account),
- Bundle Identifier: `app.getmise.mise`.

Запуск на устройстве/симуляторе — кнопкой ▶.

## Смена окружения

URL берётся из `capacitor.config.ts → server.url`. Для прод-домена поменять на
`https://getmise.app` и выполнить `npx cap sync ios`.

## App Store — важно (Guideline 4.2)

Apple может отклонить приложение, которое «просто открывает сайт». Чтобы пройти ревью,
до публикации добавить нативную функциональность через плагины Capacitor, например:
- `@capacitor/push-notifications` — пуши (низкий остаток табака, закрытие смены),
- `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/splash-screen`,
- нативный Face ID для входа (вместо текущей веб-заглушки).

Это отдельный этап после базовой сборки.

## Чеклист

- [ ] `sudo gem install cocoapods`
- [ ] `npx cap add ios && npx cap sync ios`
- [ ] NSCameraUsageDescription в Info.plist
- [ ] Signing Team + Bundle ID в Xcode
- [ ] Запуск на устройстве
- [ ] (перед релизом) нативные плагины для прохождения ревью
