@AGENTS.md

# Mise — контекст проекта

**Приложение опубликовано в App Store (2026-06-19). Это продакшн — деструктивные операции только после явного подтверждения пользователя.**

## Стек

- **Web:** Next.js 16.2.7, React 19, TypeScript strict, App Router, Supabase, Vercel
- **iOS:** SwiftUI (native-v2, `native/Mise/`), iOS 17+, Xcode PBXFileSystemSynchronizedRootGroup
- **Домен:** misesuite.com
- **Бэкенд:** Supabase (auth + PostgreSQL), Stripe (подписки), Resend (email)

## Модули

| Модуль | Web route | iOS |
|--------|-----------|-----|
| Manager | `/manager` | `ManagerView.swift` |
| Analytics | `/analytics` | `AnalyticsView.swift` |
| Stash (склад) | `/tobacco` | `StashView.swift` |
| People | `/people` | `PeopleView.swift` |
| Menu (QR) | `/menu/[slug]` + `/dashboard/menu` | веб |
| Dashboard | `/dashboard` | — |

## Критические правила БД

- `shifts` — сортировать по `opened_at`, НЕ `created_at` (колонки `created_at` нет → 400)
- `inkassations` — колонка называется `total`, НЕ `balance`
- `shift_expenses` — колонка `employee_id` добавлена миграцией `shift-expenses-employee-id.sql`
- `shifts.date` — тип `date` (не timestamp), уникальный по `(restaurant_id, date)`

## Критические правила iOS

- Внутренние вкладки модуля — только нативный `TabView` с `.tabItem` (liquid glass, iOS 26), НЕ кастомный bottom bar
- Manager — без вкладок (один экран)
- `Localization.swift` — `L10n` singleton, `t()` helper, 8 языков (en/ru/it/fr/az/tr/uk/kk)

## Без эмодзи

В продукте и на сайте — только SVG-иконки или текст. Никаких ✅💬📍.

## i18n

- Web: `lib/i18n.tsx`, хук `useI18n()`, словарь `STRINGS`, 8 языков
- В app-экранах использовать `const {t:tr}=useI18n()` (не конфликтует с `t` из useTheme)
- iOS: `Localization.swift`, `t()`, `L10n.shared`
- Все Web-экраны уже локализованы (manager/analytics/stash/people/dashboard/menu/auth/landing/legal)

## Data-слой

- Клиент через `/api/db` (не напрямую в Supabase) — `lib/db.ts`
- RLS включён
- iOS: `DB.swift` → `/api/db` (авторизация через staff-cookie)

## Текущий фокус (Sprint 1)

1. Баги iOS: OnboardingView (бегущие слова после logout), PeopleView (кнопка «Я здесь»), градиент «e» (не зациклен)
2. Dashboard redesign
3. AI-аналитика (восстановить)
4. Логотипы — унификация везде

## Деплой

- `git push` в `main` = автодеплой в прод (Vercel)
- iOS: ветка `native-v2`, Xcode → Run на устройстве
