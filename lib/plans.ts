// Единый источник правды по тарифам, аддонам и правам доступа (биллинг v2).
// Импортируется дашбордом, админкой, /api/db и stripe-роутами — цены и лимиты
// больше нигде не хардкодятся.

export type ModuleId = 'manager' | 'analytics' | 'stash' | 'people' | 'menu' | 'bookings' | 'news'
export type PlanId = 'starter' | 'business' | 'pro'

export const ALL_MODULES: ModuleId[] = ['manager', 'analytics', 'stash', 'people', 'menu', 'bookings', 'news']
export const BASE_MODULES: ModuleId[] = ['manager', 'analytics']

export const PLANS: Record<PlanId, {
  name: string
  price: number            // €/мес
  seats: number            // мест сотрудников включено
  modules: ModuleId[]
  ai: boolean
  color: string
  popular?: boolean
}> = {
  starter:  { name: 'Starter',  price: 14, seats: 3,  modules: BASE_MODULES, ai: false, color: '#007aff' },
  business: { name: 'Business', price: 24, seats: 7,  modules: ALL_MODULES,  ai: false, color: '#34c759', popular: true },
  pro:      { name: 'Pro',      price: 39, seats: 15, modules: ALL_MODULES,  ai: true,  color: '#af52de' },
}

// €/мес за единицу поверх тарифа
// seat поднят с €1 до €2 (2026-07-13): на €1 Business+доп.места+AI выходил дешевле Pro
// за тот же состав (24 + 8×1 + 5 = 37 < 39) — нелогично, никто бы не покупал Pro.
export const ADDON_PRICES = { module: 3, seat: 2, ai: 5 } as const

export const YEARLY_DISCOUNT = 0.2
export const TRIAL_DAYS = 14

// Годовая цена за единицу (в €/год, со скидкой), округляем до целого евро.
export const yearly = (monthly: number) => Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT))

// Stripe lookup keys (scripts/stripe-setup.mjs создаёт prices с этими ключами).
export const stripeLookupKey = (item: PlanId | 'addon_module' | 'addon_seat' | 'addon_ai', interval: 'month' | 'year') =>
  `mise_${item}_${interval}`

// Поля restaurants, участвующие в правах. Все опциональны — строка может прийти
// из старой БД без новых колонок.
export type BillingFields = {
  subscription_plan?: string | null
  subscription_status?: string | null
  comp_apps?: string[] | null        // выдано супер-админом поверх тарифа
  staff_limit?: number | null        // ручной override мест (супер-админ), NULL = тариф+аддоны
  ai_enabled?: boolean | null        // ручной override AI (супер-админ)
  addon_modules?: string[] | null    // купленные модули-аддоны
  extra_seats?: number | null        // купленные доп. места
  addon_ai?: boolean | null          // купленный AI-аддон
  billing_interval?: string | null   // 'month' | 'year'
  discount_pct?: number | null       // скидка супер-админа (в Stripe — купоном вручную)
}

export type Entitlements = { modules: ModuleId[]; seats: number; ai: boolean }

export function entitlements(r: BillingFields | null | undefined): Entitlements {
  const plan = PLANS[(r?.subscription_plan as PlanId) ?? 'starter'] ?? PLANS.starter
  const modules = [...new Set([
    ...plan.modules,
    ...((r?.addon_modules || []) as ModuleId[]),
    ...((r?.comp_apps || []) as ModuleId[]),
  ])].filter(m => ALL_MODULES.includes(m))
  const seats = r?.staff_limit ?? (plan.seats + (r?.extra_seats || 0))
  const ai = plan.ai || !!r?.addon_ai || !!r?.ai_enabled
  return { modules, seats, ai }
}

// 'canceling' = отмена в конце периода — доступ сохраняется до subscription_ends_at
export function isActiveStatus(s?: string | null): boolean {
  return s === 'active' || s === 'trialing' || s === 'canceling'
}

// Месячный эквивалент выручки с клиента (для MRR в админке).
export function monthlyRevenue(r: BillingFields | null | undefined): number {
  if (!r || !isActiveStatus(r.subscription_status) || r.subscription_status === 'trialing') return 0
  const plan = PLANS[(r.subscription_plan as PlanId) ?? 'starter'] ?? PLANS.starter
  let total = plan.price
    + (r.addon_modules?.length || 0) * ADDON_PRICES.module
    + (r.extra_seats || 0) * ADDON_PRICES.seat
    + (r.addon_ai ? ADDON_PRICES.ai : 0)
  if (r.billing_interval === 'year') total *= 1 - YEARLY_DISCOUNT
  if (r.discount_pct) total *= 1 - r.discount_pct / 100
  return Math.round(total * 100) / 100
}
