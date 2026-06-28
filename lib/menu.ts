// Shared menu domain: locales, diet tags, fonts, theme presets, and helpers used by
// both the guest menu (app/menu/[slug]) and the owner editor (app/dashboard/menu).
// No emojis in product UI — tags use colored pills + localized text, not emoji.

export const MENU_LOCALES = ['en', 'ru', 'it', 'fr', 'az', 'tr', 'uk', 'kk'] as const
export type MenuLocale = (typeof MENU_LOCALES)[number]

export const LOCALE_LABEL: Record<string, string> = {
  en: 'English', ru: 'Русский', it: 'Italiano', fr: 'Français',
  az: 'Azərbaycan', tr: 'Türkçe', uk: 'Українська', kk: 'Қазақша',
}

// ── Localized content (JSONB i18n column) ───────────────────────────────────
// Stored as { name: { ru, en, ... }, description: { ... } }. Base name/description
// columns are the default/fallback. Guest resolves i18n[locale] ?? base.
export interface I18nContent {
  name?: Record<string, string>
  description?: Record<string, string>
}

export function pickText(
  base: string | null | undefined,
  i18n: I18nContent | null | undefined,
  field: 'name' | 'description',
  locale: string,
): string {
  const loc = (i18n && i18n[field] && i18n[field]![locale])?.trim()
  if (loc) return loc
  const en = (i18n && i18n[field] && i18n[field]!['en'])?.trim()
  return (base || en || '').trim()
}

// ── Diet / highlight tags ───────────────────────────────────────────────────
// id is stored in menu_items.tags (jsonb array). labelKey resolves via i18n STRINGS.
export interface TagDef { id: string; labelKey: string; color: string }

export const MENU_TAGS: TagDef[] = [
  { id: 'vegan',       labelKey: 'menu.tagVegan',     color: '#34c759' },
  { id: 'vegetarian',  labelKey: 'menu.tagVeg',       color: '#30b86a' },
  { id: 'gluten_free', labelKey: 'menu.tagGlutenFree',color: '#c79a3a' },
  { id: 'lactose_free',labelKey: 'menu.tagLactoseFree',color: '#5ac8d8' },
  { id: 'spicy',       labelKey: 'menu.tagSpicy',     color: '#ff3b30' },
  { id: 'halal',       labelKey: 'menu.tagHalal',     color: '#00a86b' },
  { id: 'new',         labelKey: 'menu.tagNew',       color: '#0a84ff' },
  { id: 'popular',     labelKey: 'menu.tagPopular',   color: '#ff9500' },
  { id: 'chef',        labelKey: 'menu.tagChef',      color: '#af52de' },
]

export const TAG_BY_ID: Record<string, TagDef> = Object.fromEntries(MENU_TAGS.map(t => [t.id, t]))

// ── Fonts (curated Google Fonts) ────────────────────────────────────────────
// `google` feeds the Google Fonts <link>; `stack` is the CSS font-family.
export interface FontDef { id: string; name: string; google: string; stack: string; serif?: boolean }

export const MENU_FONTS: FontDef[] = [
  { id: 'system',   name: 'System',          google: '',                              stack: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" },
  { id: 'inter',    name: 'Inter',           google: 'Inter:wght@400;500;600;700;800', stack: "'Inter',sans-serif" },
  { id: 'poppins',  name: 'Poppins',         google: 'Poppins:wght@400;500;600;700;800',stack: "'Poppins',sans-serif" },
  { id: 'montserrat',name: 'Montserrat',     google: 'Montserrat:wght@400;500;600;700;800',stack: "'Montserrat',sans-serif" },
  { id: 'playfair', name: 'Playfair Display',google: 'Playfair+Display:wght@500;600;700;800',stack: "'Playfair Display',serif", serif: true },
  { id: 'cormorant',name: 'Cormorant',       google: 'Cormorant+Garamond:wght@500;600;700',stack: "'Cormorant Garamond',serif", serif: true },
  { id: 'lora',     name: 'Lora',            google: 'Lora:wght@400;500;600;700',     stack: "'Lora',serif", serif: true },
  { id: 'dmserif',  name: 'DM Serif',        google: 'DM+Serif+Display',              stack: "'DM Serif Display',serif", serif: true },
]

export const FONT_BY_ID: Record<string, FontDef> = Object.fromEntries(MENU_FONTS.map(f => [f.id, f]))

export function fontStack(id: string | null | undefined): string {
  return (id && FONT_BY_ID[id]?.stack) || MENU_FONTS[0].stack
}

// Build a Google Fonts href for the heading/body pair (skips system font).
export function googleFontsHref(...ids: (string | null | undefined)[]): string | null {
  const families = ids
    .map(id => id && FONT_BY_ID[id]?.google)
    .filter((g): g is string => !!g)
  if (families.length === 0) return null
  const uniq = Array.from(new Set(families))
  return 'https://fonts.googleapis.com/css2?' + uniq.map(f => `family=${f}`).join('&') + '&display=swap'
}

// ── Theme presets ───────────────────────────────────────────────────────────
export interface ThemePreset {
  id: string; labelKey: string
  accent_color: string; theme: 'light' | 'dark' | 'auto'
  layout: 'list' | 'grid'; font_heading: string; font_body: string; radius: number
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'minimal', labelKey: 'me.presetMinimal', accent_color: '#007aff', theme: 'light', layout: 'list', font_heading: 'inter',    font_body: 'inter',      radius: 18 },
  { id: 'bistro',  labelKey: 'me.presetBistro',  accent_color: '#b5732a', theme: 'light', layout: 'grid', font_heading: 'playfair', font_body: 'lora',       radius: 14 },
  { id: 'darklux', labelKey: 'me.presetDarkLux', accent_color: '#c8a24a', theme: 'dark',  layout: 'grid', font_heading: 'cormorant',font_body: 'montserrat', radius: 10 },
  { id: 'street',  labelKey: 'me.presetStreet',  accent_color: '#ff3b30', theme: 'dark',  layout: 'grid', font_heading: 'montserrat',font_body: 'inter',     radius: 22 },
  { id: 'cafe',    labelKey: 'me.presetCafe',    accent_color: '#34a06a', theme: 'light', layout: 'list', font_heading: 'poppins',  font_body: 'poppins',    radius: 20 },
]

// ── Dayparting ──────────────────────────────────────────────────────────────
// schedule = { days: number[] (1=Mon..7=Sun), from: "HH:MM", to: "HH:MM" }.
// Empty / null schedule = always available. Window may wrap past midnight.
export interface Schedule { days?: number[]; from?: string; to?: string }

function hhmmToMin(s?: string): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

export function itemAvailableNow(schedule: Schedule | null | undefined, now: Date = new Date()): boolean {
  if (!schedule) return true
  const days = schedule.days
  // JS getDay: 0=Sun..6=Sat → convert to 1=Mon..7=Sun
  const dow = ((now.getDay() + 6) % 7) + 1
  if (Array.isArray(days) && days.length > 0 && !days.includes(dow)) return false
  const from = hhmmToMin(schedule.from)
  const to = hhmmToMin(schedule.to)
  if (from == null || to == null) return true
  const cur = now.getHours() * 60 + now.getMinutes()
  if (from === to) return true
  if (from < to) return cur >= from && cur < to          // обычное окно (08:00–12:00)
  return cur >= from || cur < to                          // окно через полночь (22:00–02:00)
}

export const WEEKDAY_KEYS = ['me.mon', 'me.tue', 'me.wed', 'me.thu', 'me.fri', 'me.sat', 'me.sun']
