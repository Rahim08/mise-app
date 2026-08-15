'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef, use } from 'react'
import { useI18n } from '@/lib/i18n'
import {
  MENU_LOCALES, LOCALE_LABEL, MENU_TAGS, TAG_BY_ID,
  pickText, fontStack, googleFontsHref, itemAvailableNow,
  type I18nContent, type Schedule,
} from '@/lib/menu'
import { AltMenuBody } from './altLayouts'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface MenuSettings {
  id: string
  restaurant_id: string
  slug: string
  is_published: boolean
  theme: 'light' | 'dark' | 'auto'
  layout?: 'list' | 'grid'
  design?: string
  card_style?: 'shadow' | 'outline' | 'glass'
  accent_color: string
  font_heading?: string | null
  font_body?: string | null
  radius?: number | null
  cover_url: string | null
  show_photos: boolean
  allow_orders: boolean
  allow_pay_at_table: boolean
  allow_tips?: boolean
  show_allergens: boolean
  show_calories: boolean
  upsell_category_id?: string | null
  language: string
  quick_actions?: boolean
}

export interface Category {
  id: string
  name: string
  description: string | null
  i18n?: I18nContent | null
  image_url: string | null
  position: number
  is_visible: boolean
}

export interface MenuItem {
  id: string
  category_id: string
  name: string
  description: string | null
  i18n?: I18nContent | null
  price: number | null
  image_url: string | null
  is_visible: boolean
  is_available: boolean
  calories: number | null
  allergens: string[] | null
  modifiers: { name: string; options: { name: string; price: number }[] }[] | null
  tags?: string[] | null
  schedule?: Schedule | null
  type?: string
  combo_items?: { item_id: string; qty: number }[] | null
  recommended_ids?: string[] | null
  position: number
  intensity?: number | null
  stock_left?: number | null
}

export interface Restaurant { id: string; name: string; logo_url: string | null; currency: string | null }

export interface AltLayoutCtx {
  settings: MenuSettings
  restaurant: Restaurant
  categories: Category[]
  filteredItems: (catId: string) => MenuItem[]
  nm: (x: { name: string; i18n?: I18nContent | null }) => string
  dsc: (x: { description: string | null; i18n?: I18nContent | null }) => string
  money: (v: number) => string
  accent: string
  radius: number
  cardStyle: 'shadow' | 'outline' | 'glass'
  headFont: string
  bodyFont: string
  T: { bg: string; surface: string; surface2: string; text: string; text2: string; text3: string; sep: string; fill: string; hbg: string; sh: string }
  t: (key: string, vars?: Record<string, string | number>) => string
  cartQty: (id: string) => number
  addToCart: (item: MenuItem, opts?: { name: string; price: number }[]) => void
  favs: string[]
  toggleFav: (id: string) => void
  openDetail: (item: MenuItem) => void
  trendingIds: string[]
  orderable: (item: MenuItem) => boolean
  soldOutToday: (item: MenuItem) => boolean
  tagPills: (item: MenuItem) => { id: string; labelKey: string; color: string }[]
}

interface CartItem { item: MenuItem; qty: number; opts?: { name: string; price: number }[] }

// Запись общей корзины стола. Сериализуемая (уходит в broadcast), поэтому хранит id
// позиции, а не саму позицию. `at` — отметка времени последнего изменения ЭТОЙ записи.
interface CartEntry { id: string; qty: number; opts?: { name: string; price: number }[]; at: number }

function keyOf(itemId: string, opts?: { name: string }[]) {
  return itemId + '|' + (opts || []).map(o => o.name).join(',')
}
function entryKey(c: { item: MenuItem; opts?: { name: string }[] }) {
  return keyOf(c.item.id, c.opts)
}
function unitPrice(c: CartItem) {
  return (c.item.price || 0) + (c.opts || []).reduce((s, o) => s + (o.price || 0), 0)
}
// Формат числа и позиция валюты — по локали интерфейса гостя. Было жёстко 'de-DE' с
// валютой ПЕРЕД числом, тогда как в дашборде и у персонала валюта идёт после числа.
function fv(v: number, currency = '€', locale = 'en') {
  return `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

// Слияние состояния общей корзины: по КАЖДОЙ записи побеждает более свежая отметка
// времени. Раньше прилетевшая корзина заменяла локальную целиком, поэтому первый же
// «чих» одного гостя схлопывал позиции второго. Возвращает исходную карту, если ничего
// не изменилось — чтобы не гонять эхо по кругу.
function mergeCart(local: Record<string, CartEntry>, remote: Record<string, CartEntry>) {
  let changed = false
  const out = { ...local }
  for (const [k, e] of Object.entries(remote || {})) {
    if (!e || typeof e.id !== 'string' || typeof e.qty !== 'number' || typeof e.at !== 'number') continue
    if (!Number.isFinite(e.qty) || e.qty < 0 || e.qty > 99) continue
    const cur = out[k]
    if (!cur || e.at > cur.at) {
      const opts = Array.isArray(e.opts)
        ? e.opts.filter(o => o && typeof o.name === 'string').map(o => ({ name: String(o.name), price: Number(o.price) || 0 }))
        : undefined
      out[k] = { id: e.id, qty: Math.floor(e.qty), opts: opts && opts.length ? opts : undefined, at: e.at }
      changed = true
    }
  }
  return changed ? out : local
}

// Тумбстоны (записи с qty 0) нужны, чтобы удаление не «воскресало» эхом соседа, но
// вечно их держать незачем.
function pruneCart(map: Record<string, CartEntry>) {
  const cutoff = Date.now() - 30 * 60_000
  const out: Record<string, CartEntry> = {}
  for (const [k, e] of Object.entries(map)) if (e.qty > 0 || e.at > cutoff) out[k] = e
  return out
}

const TIP_PRESETS = [0, 5, 10, 15]

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { t, locale } = useI18n()
  const [settings, setSettings] = useState<MenuSettings | null>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [orderSent, setOrderSent] = useState(false)
  const [orderError, setOrderError] = useState(false)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [tableN, setTableN] = useState<string | null>(null)
  const [bill, setBill] = useState<{ items: any[]; total: number; at: number }[]>([])
  const [showBill, setShowBill] = useState(false)
  const [waiterCalled, setWaiterCalled] = useState<string | null>(null)
  const [trendingIds, setTrendingIds] = useState<string[]>([])
  const [showQuiz, setShowQuiz] = useState(false)
  // Content language (dish names/descriptions). Defaults to the guest phone locale.
  const [contentLang, setContentLang] = useState<string>('en')
  const [showLang, setShowLang] = useState(false)
  // Filters
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [onlyFav, setOnlyFav] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [favs, setFavs] = useState<string[]>([])
  // Item detail sheet
  const [detail, setDetail] = useState<MenuItem | null>(null)
  const [detailSel, setDetailSel] = useState<number[]>([])
  // Tips
  const [tipPct, setTipPct] = useState(0)

  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const navRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sid = useRef<string>('')
  const viewSent = useRef(false)
  // Общая корзина стола (Realtime broadcast, last-write-wins). Активна автоматически,
  // когда в ссылке есть ?table= — отдельный тумблер не нужен, это ортогонально allow_orders.
  const tableChannel = useRef<RealtimeChannel | null>(null)
  const applyingRemoteCart = useRef(false)
  const sendingOrder = useRef(false)
  const [tableGuests, setTableGuests] = useState(1)

  // localized resolvers
  const nm = (x: { name: string; i18n?: I18nContent | null }) => pickText(x.name, x.i18n, 'name', contentLang)
  const dsc = (x: { description: string | null; i18n?: I18nContent | null }) => pickText(x.description, x.i18n, 'description', contentLang)

  useEffect(() => {
    loadMenu()
    const tn = new URLSearchParams(window.location.search).get('table')
    if (tn) setTableN(tn.replace(/[^0-9a-zA-Zа-яА-Я-]/g, '').slice(0, 10) || null)
    try {
      const saved = JSON.parse(localStorage.getItem(`mise_bill_${slug}`) || '[]')
      setBill(saved.filter((o: any) => Date.now() - o.at < 6 * 3600000))
      setFavs(JSON.parse(localStorage.getItem(`mise_fav_${slug}`) || '[]'))
      let s = localStorage.getItem('mise_sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('mise_sid', s) }
      sid.current = s
    } catch {}
  }, [slug])

  // Default content language to the guest's phone locale when supported.
  useEffect(() => {
    if (!settings) return
    const guess = (MENU_LOCALES as readonly string[]).includes(locale) ? locale : (settings.language || 'en')
    setContentLang(guess)
  }, [settings, locale])

  // Inject the menu's Google Fonts.
  useEffect(() => {
    if (!settings) return
    const href = googleFontsHref(settings.font_heading, settings.font_body)
    if (!href) return
    const id = 'menu-guest-fonts'
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link) }
    link.href = href
  }, [settings])

  const track = (type: string, item_id?: string) => {
    try {
      fetch('/api/menu/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, type, item_id: item_id || null, session_id: sid.current, table_number: tableN }) })
    } catch {}
  }

  const saveBill = (next: { items: any[]; total: number; at: number }[]) => {
    setBill(next)
    try { localStorage.setItem(`mise_bill_${slug}`, JSON.stringify(next)) } catch {}
  }
  const toggleFav = (id: string) => {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      try { localStorage.setItem(`mise_fav_${slug}`, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const sendQuickAction = async (kind: 'waiter' | 'coal' | 'water') => {
    setWaiterCalled(kind); setTimeout(() => setWaiterCalled(null), 60000)
    await fetch('/api/menu/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, type: `${kind}_call`, table_number: tableN }) })
  }

  // Повторить последний заказ стола — берём позиции из сохранённого счёта, докидываем
  // в корзину те, что всё ещё есть в меню и доступны (акции/сток могли измениться).
  const reorderLast = () => {
    const last = bill[bill.length - 1]
    if (!last) return
    for (const it of last.items) {
      const menuItem = items.find(x => x.id === it.id)
      if (!menuItem || !menuItem.is_available) continue
      for (let n = 0; n < (it.qty || 1); n++) addToCart(menuItem)
    }
    setShowBill(false); setShowCart(true)
  }

  useEffect(() => {
    if (!settings) return
    if (settings.theme === 'dark') setIsDark(true)
    else if (settings.theme === 'light') setIsDark(false)
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [settings])

  // Общая корзина стола — Realtime broadcast, слияние по записи с отметкой времени
  // (mergeCart/pruneCart выше). cartMapRef — источник истины, включая тумбстоны
  // (qty:0) для уже удалённых позиций; `cart` — только для рендера, тумбстоны в него
  // не попадают. Раньше приходящая корзина заменяла локальную целиком (last-write-wins
  // на уровне всей корзины) — первый же чих одного гостя схлопывал позиции второго.
  const itemsRef = useRef<MenuItem[]>([])
  useEffect(() => { itemsRef.current = items }, [items])
  const clientId = useRef(Math.random().toString(36).slice(2))
  const cartMapRef = useRef<Record<string, CartEntry>>({})

  const renderCart = (map: Record<string, CartEntry>): CartItem[] =>
    Object.values(map)
      .filter(e => e.qty > 0)
      .map(e => { const it = itemsRef.current.find(x => x.id === e.id); return it ? { item: it, qty: e.qty, opts: e.opts } : null })
      .filter(Boolean) as CartItem[]

  const applyMap = (map: Record<string, CartEntry>, fromRemote: boolean) => {
    cartMapRef.current = map
    if (fromRemote) applyingRemoteCart.current = true
    setCart(renderCart(map))
  }

  useEffect(() => {
    if (!tableN || !settings?.allow_orders) return
    const ch = supabase.channel(`mise-table:${slug}:${tableN}`)
    ch.on('broadcast', { event: 'cart' }, ({ payload }) => {
      if (payload?.sender === clientId.current) return
      const remote: Record<string, CartEntry> = {}
      for (const c of (payload?.cart || [])) {
        if (!c || typeof c.id !== 'string') continue
        remote[keyOf(c.id, c.opts)] = { id: c.id, qty: c.qty, opts: c.opts, at: c.at }
      }
      const merged = pruneCart(mergeCart(cartMapRef.current, remote))
      if (merged !== cartMapRef.current) applyMap(merged, true)
    })
    ch.on('presence', { event: 'sync' }, () => {
      setTableGuests(Math.max(1, Object.keys(ch.presenceState()).length))
    })
    ch.subscribe(status => { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }) })
    tableChannel.current = ch
    return () => { supabase.removeChannel(ch); tableChannel.current = null; setTableGuests(1) }
  }, [slug, tableN, settings?.allow_orders])

  useEffect(() => {
    if (applyingRemoteCart.current) { applyingRemoteCart.current = false; return }
    if (!tableChannel.current) return
    const payload = Object.values(cartMapRef.current)
    tableChannel.current.send({ type: 'broadcast', event: 'cart', payload: { sender: clientId.current, cart: payload } })
  }, [cart])

  const loadMenu = async () => {
    const res = await fetch(`/api/menu/${slug}`)
    if (!res.ok) { setNotFound(true); setLoading(false); return }
    const { settings: s, restaurant: rest, categories: cats, items: its, trending_ids } = await res.json()
    if (!s) { setNotFound(true); setLoading(false); return }
    setSettings(s); setRestaurant(rest); setCategories(cats || []); setItems(its || [])
    setTrendingIds(trending_ids || [])
    if (cats && cats.length > 0) setActiveCategory(cats[0].id)
    setLoading(false)
    if (!viewSent.current) { viewSent.current = true; track('view') }
  }

  const addToCart = (item: MenuItem, opts?: { name: string; price: number }[]) => {
    if (!opts && item.modifiers && item.modifiers.length > 0) { openDetail(item); return }
    track('add_to_cart', item.id)
    const key = keyOf(item.id, opts)
    const existing = cartMapRef.current[key]
    const next = { ...cartMapRef.current, [key]: { id: item.id, qty: (existing?.qty || 0) + 1, opts, at: Date.now() } }
    applyMap(next, false)
  }
  const removeFromCart = (itemId: string) => {
    const key = Object.keys(cartMapRef.current).find(k => cartMapRef.current[k].id === itemId && cartMapRef.current[k].qty > 0)
    if (!key) return
    const e = cartMapRef.current[key]
    // qty:0 остаётся в карте тумбстоном — иначе просроченный remote-broadcast с прежним
    // qty «воскресит» только что удалённую позицию (см. mergeCart выше).
    const next = { ...cartMapRef.current, [key]: { ...e, qty: e.qty - 1, at: Date.now() } }
    applyMap(next, false)
  }
  const incEntry = (idx: number, d: number) => {
    const c = cart[idx]
    if (!c) return
    const key = entryKey(c)
    const e = cartMapRef.current[key]
    if (!e) return
    const next = { ...cartMapRef.current, [key]: { ...e, qty: Math.max(0, e.qty + d), at: Date.now() } }
    applyMap(next, false)
  }

  const openDetail = (item: MenuItem) => {
    setDetailSel((item.modifiers || []).map(() => 0))
    setDetail(item); track('item_view', item.id)
  }

  const cartQty = (itemId: string) => cart.filter(c => c.item.id === itemId).reduce((s, c) => s + c.qty, 0)
  const cartTotal = cart.reduce((s, c) => s + unitPrice(c) * c.qty, 0)
  const cartCount = cart.reduce((s, c) => s + c.qty, 0)
  const tipAmount = settings?.allow_tips ? Math.round(cartTotal * tipPct) / 100 : 0
  const grandTotal = cartTotal + tipAmount

  const sendOrder = async () => {
    if (!restaurant || cart.length === 0 || sendingOrder.current) return
    sendingOrder.current = true
    const orderItems = cart.map(c => ({ id: c.item.id, name: c.item.name, price: unitPrice(c), qty: c.qty, opts: c.opts?.map(o => o.name) }))
    // Раньше счёт сохранялся и корзина чистилась ДО и НЕЗАВИСИМО от ответа сервера:
    // подписка истекла / allow_orders выключили → 403, гость видел «отправлено», а на кухню
    // ничего не пришло; при обрыве сети корзина уже пустая — восстановить нечем (аудит
    // 2026-08-05, раздел 4). Теперь ждём ответ и только на успехе чистим корзину/пишем счёт.
    try {
      const res = await fetch('/api/menu/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, items: orderItems, total: cartTotal, tip: tipAmount, order_type: 'dine_in', table_number: tableN }) })
      if (!res.ok) throw new Error(String(res.status))
      track('checkout_click')
      saveBill([...bill, { items: orderItems, total: grandTotal, at: Date.now() }])
      // Тумбстоним отправленные позиции (не стираем карту) — просроченный remote-broadcast
      // от соседа по столу не должен воскресить уже оформленный заказ.
      const cleared = { ...cartMapRef.current }
      for (const k of Object.keys(cleared)) if (cleared[k].qty > 0) cleared[k] = { ...cleared[k], qty: 0, at: Date.now() }
      applyMap(cleared, false)
      setTipPct(0); setShowCart(false)
      setOrderSent(true); setTimeout(() => setOrderSent(false), 3000)
    } catch {
      setOrderError(true); setTimeout(() => setOrderError(false), 4000)
    } finally {
      sendingOrder.current = false
    }
  }

  const scrollToCategory = (catId: string) => {
    setActiveCategory(catId)
    const el = categoryRefs.current[catId]
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 120, behavior: 'smooth' })
    const btn = navRef.current?.querySelector(`[data-cat="${catId}"]`) as HTMLElement
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  // ── filtering (search + tags + favorites + dayparting) ──
  const now = new Date()
  const passesItem = (i: MenuItem) => {
    if (!itemAvailableNow(i.schedule, now)) return false
    if (onlyFav && !favs.includes(i.id)) return false
    if (activeTags.length && !activeTags.every(tg => (i.tags || []).includes(tg))) return false
    if (search) {
      const q = search.toLowerCase()
      if (!nm(i).toLowerCase().includes(q) && !dsc(i).toLowerCase().includes(q)) return false
    }
    return true
  }
  const filteredItems = (catId: string) => items.filter(i => i.category_id === catId && passesItem(i))

  const accent = settings?.accent_color || '#007aff'
  const layout = settings?.layout || 'list'
  const currency = restaurant?.currency || '€'
  const money = (v: number) => fv(v, currency)
  const radius = settings?.radius ?? 18
  const headFont = fontStack(settings?.font_heading)
  const bodyFont = fontStack(settings?.font_body)

  const availTags = MENU_TAGS.filter(tg => items.some(i => (i.tags || []).includes(tg.id)))
  const filterCount = activeTags.length + (onlyFav ? 1 : 0)

  const T = {
    bg: isDark ? '#000' : '#f2f2f7',
    surface: isDark ? '#1c1c1e' : '#fff',
    surface2: isDark ? '#2c2c2e' : '#f2f2f7',
    text: isDark ? '#fff' : '#000',
    text2: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
    text3: isDark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)',
    sep: isDark ? 'rgba(84,84,88,0.36)' : 'rgba(60,60,67,0.12)',
    fill: isDark ? 'rgba(120,120,128,0.36)' : 'rgba(120,120,128,0.12)',
    hbg: isDark ? 'rgba(28,28,30,0.94)' : 'rgba(242,242,247,0.94)',
    sh: isDark ? '0 2px 16px rgba(0,0,0,0.6)' : '0 1px 3px rgba(0,0,0,0.08),0 4px 20px rgba(0,0,0,0.06)',
  }

  // Стиль карточки — тень (дефолт) / контур / стекло. Применяется к карточкам товаров
  // в сетке и к контейнеру списка ниже (только «Классика», у остальных дизайнов — свой).
  const cardStyle = settings?.card_style || 'shadow'
  const cardShadow: React.CSSProperties = cardStyle === 'outline'
    ? { border: `1px solid ${T.sep}`, boxShadow: 'none' }
    : cardStyle === 'glass'
    ? { border: `1px solid ${T.sep}`, boxShadow: T.sh, backdropFilter: 'blur(20px) saturate(170%)', WebkitBackdropFilter: 'blur(20px) saturate(170%)' }
    : { border: 'none', boxShadow: T.sh }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 30, height: 30, border: '2.5px solid rgba(255,255,255,0.14)', borderTopColor: 'rgba(255,255,255,0.85)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (notFound || !settings || !restaurant) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, fontFamily: '-apple-system,sans-serif' }}>
      <svg width="64" height="64" fill="none" stroke="white" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.3 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      <div style={{ fontWeight: 700, fontSize: 20, color: '#fff' }}>{t('menu.notFound')}</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', maxWidth: 260 }}>{t('menu.notFoundHint')}</div>
    </div>
  )

  const visibleCats = categories.filter(c => filteredItems(c.id).length > 0 || (!search && !filterCount))
  const tagPills = (i: MenuItem) => (i.tags || []).map(tg => TAG_BY_ID[tg]).filter(Boolean)

  // Featured rail — из существующих tags (chef/popular), без отдельного поля.
  // Только когда нет активного поиска/фильтра, иначе дублирует выдачу.
  const featuredItems = (!search && !filterCount)
    ? items.filter(i => i.is_available && itemAvailableNow(i.schedule, now) && ((i.tags || []).includes('chef') || (i.tags || []).includes('popular'))).slice(0, 8)
    : []

  const soldOutToday = (i: MenuItem) => i.stock_left != null && i.stock_left <= 0
  const orderable = (i: MenuItem) => i.is_available && !soldOutToday(i)

  const IntensityBars = ({ n }: { n: number }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map(i => <span key={i} style={{ width: 3, height: 10, borderRadius: 1, background: i <= n ? accent : T.fill }} />)}
    </span>
  )

  // Rule-based подбор — без вызова /api/ai (текстовая LLM там не стоит того ради 2 вопросов).
  // Правила простые и объяснимые: chill → мягче/популярнее, bold → выше крепость.
  const pickForMood = (mood: 'chill' | 'social' | 'bold'): MenuItem | null => {
    const pool = items.filter(i => orderable(i) && itemAvailableNow(i.schedule, now))
    if (pool.length === 0) return null
    const score = (i: MenuItem) => {
      const tags = i.tags || []
      let s = 0
      if (mood === 'chill') s = (i.intensity != null ? (5 - i.intensity) : 3) + (tags.includes('popular') ? 2 : 0)
      else if (mood === 'social') s = (tags.includes('popular') ? 4 : 0) + (tags.includes('chef') ? 2 : 0)
      else s = (i.intensity ?? 0) * 2 + (tags.includes('new') ? 1 : 0)
      return s
    }
    return pool.reduce((best, i) => (score(i) > score(best) ? i : best), pool[0])
  }

  // upsell suggestions for the cart
  const cartIds = new Set(cart.map(c => c.item.id))
  const recIds = new Set<string>()
  cart.forEach(c => (c.item.recommended_ids || []).forEach(id => recIds.add(id)))
  let upsell = items.filter(i => recIds.has(i.id) && !cartIds.has(i.id) && i.is_available)
  if (upsell.length === 0 && settings.upsell_category_id) upsell = items.filter(i => i.category_id === settings.upsell_category_id && !cartIds.has(i.id) && i.is_available).slice(0, 6)
  upsell = upsell.slice(0, 6)

  const CircleBtn = ({ onClick, children, badge }: { onClick: () => void; children: React.ReactNode; badge?: number }) => (
    <button onClick={onClick} style={{ position: 'relative', width: 38, height: 38, borderRadius: '50%', background: isDark ? 'rgba(40,40,42,0.7)' : 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text, boxShadow: '0 1px 6px rgba(0,0,0,0.18)' }}>
      {children}
      {badge ? <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: accent, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span> : null}
    </button>
  )

  // Пять альтернативных структур (Design Lab) — включаются per-menu через settings.design.
  // 'classic'/пусто — текущая вёрстка ниже (табы категорий, list/grid2/grid3/cards).
  const altDesign = settings.design && settings.design !== 'classic' ? settings.design : null
  const altCtx: AltLayoutCtx = {
    settings, restaurant, categories, filteredItems, nm, dsc, money, accent, radius,
    cardStyle: settings.card_style || 'shadow', headFont, bodyFont, T, t,
    cartQty, addToCart, favs, toggleFav, openDetail, trendingIds, orderable, soldOutToday, tagPills,
  }

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: T.bg, fontFamily: bodyFont, WebkitFontSmoothing: 'antialiased', color: T.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        * { box-sizing: border-box }
        ::-webkit-scrollbar { display: none }
        input { -webkit-appearance: none }
      `}</style>

      {/* FLOATING CONTROLS (search / filter / language) */}
      <div style={{ position: 'fixed', top: 'calc(8px + env(safe-area-inset-top,0px))', right: 12, zIndex: 260, display: 'flex', gap: 8 }}>
        <CircleBtn onClick={() => setShowSearch(s => !s)}><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg></CircleBtn>
        {availTags.length > 0 && <CircleBtn onClick={() => setShowFilters(true)} badge={filterCount}><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4" /></svg></CircleBtn>}
        {settings.allow_orders && items.length >= 2 && <CircleBtn onClick={() => setShowQuiz(true)}><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></svg></CircleBtn>}
        <CircleBtn onClick={() => setShowLang(true)}><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg></CircleBtn>
      </div>

      {altDesign ? (
        <AltMenuBody design={altDesign} ctx={altCtx} tableN={tableN} />
      ) : (
      <>
      {/* COVER + HEADER */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200 }}>
        {settings.cover_url ? (
          <div style={{ height: 180, position: 'relative', overflow: 'hidden' }}>
            <img src={settings.cover_url} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 100%)' }} />
            <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              {restaurant.logo_url && <img src={restaurant.logo_url} alt="logo" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />}
              <div style={{ fontWeight: 800, fontSize: 22, color: '#fff', letterSpacing: -0.5, textShadow: '0 1px 4px rgba(0,0,0,0.5)', fontFamily: headFont }}>{restaurant.name}</div>
            </div>
          </div>
        ) : (
          <div style={{ height: 56, background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
            {restaurant.logo_url && <img src={restaurant.logo_url} alt="logo" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />}
            <span style={{ fontWeight: 700, fontSize: 17, color: T.text, letterSpacing: -0.3, flex: 1, fontFamily: headFont }}>{restaurant.name}</span>
          </div>
        )}

        {showSearch && (
          <div style={{ background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', padding: '8px 16px', borderBottom: `0.5px solid ${T.sep}` }}>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="16" height="16" fill="none" stroke={T.text3} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('menu.search')} autoFocus style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 12, border: `1px solid ${T.sep}`, fontSize: 15, color: T.text, background: T.surface, fontFamily: 'inherit', outline: 'none' }} />
            </div>
          </div>
        )}

        <div ref={navRef} style={{ background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}`, overflowX: 'auto', display: 'flex', gap: 4, padding: '10px 16px', scrollbarWidth: 'none' }}>
          {visibleCats.map(cat => (
            <button key={cat.id} data-cat={cat.id} onClick={() => scrollToCategory(cat.id)} style={{ flexShrink: 0, padding: '7px 16px', borderRadius: 20, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: activeCategory === cat.id ? 700 : 500, cursor: 'pointer', transition: 'all .18s', background: activeCategory === cat.id ? accent : T.fill, color: activeCategory === cat.id ? '#fff' : T.text2, boxShadow: activeCategory === cat.id ? `0 2px 12px ${accent}44` : 'none' }}>{nm(cat)}</button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div ref={scrollRef} style={{ position: 'fixed', top: settings.cover_url ? 180 + 44 + (showSearch ? 56 : 0) : 56 + 44 + (showSearch ? 56 : 0), left: 0, right: 0, bottom: cartCount > 0 ? 80 : 0, overflowY: 'auto', background: T.bg }}
        onScroll={() => {
          if (!scrollRef.current) return
          const scrollTop = scrollRef.current.scrollTop
          let current = visibleCats[0]?.id || ''
          for (const cat of visibleCats) { const el = categoryRefs.current[cat.id]; if (el && el.offsetTop - 140 <= scrollTop) current = cat.id }
          setActiveCategory(current)
        }}>
        <div style={{ padding: '20px 16px 40px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp .25s ease' }}>
          {featuredItems.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{t('menu.featured')}</div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -16px', padding: '0 16px 4px' }}>
                {featuredItems.map(item => (
                  <button key={item.id} onClick={() => openDetail(item)} style={{ flexShrink: 0, width: 168, height: 200, borderRadius: radius, position: 'relative', overflow: 'hidden', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit', background: item.image_url ? `center/cover url(${item.image_url})` : `linear-gradient(155deg, ${accent}33, ${T.surface2})` }}>
                    {trendingIds.includes(item.id) && (
                      <span style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)', padding: '3px 8px', borderRadius: 8, textTransform: 'uppercase' }}>{t('menu.trending')}</span>
                    )}
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '30px 12px 12px', background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', lineHeight: 1.2, fontFamily: headFont }}>{nm(item)}</div>
                      {item.price != null && <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', opacity: 0.9, marginTop: 4 }}>{money(item.price)}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {visibleCats.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            return (
              <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el }}>
                <div style={{ marginBottom: 14, marginTop: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 22, color: T.text, letterSpacing: -0.5, fontFamily: headFont }}>{nm(cat)}</div>
                  {dsc(cat) && <div style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>{dsc(cat)}</div>}
                </div>

                {layout === 'grid' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32 }}>
                    {catItems.map(item => {
                      const qty = cartQty(item.id)
                      return (
                        <div key={item.id} onClick={() => openDetail(item)} style={{ background: T.surface, borderRadius: radius, overflow: 'hidden', ...cardShadow, opacity: orderable(item) ? 1 : 0.45, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
                          {settings.show_photos && (
                            <div style={{ width: '100%', aspectRatio: '1 / 1', background: T.fill, flexShrink: 0, position: 'relative' }}>
                              {item.image_url ? <img src={item.image_url} alt={nm(item)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="28" height="28" fill="none" stroke={T.text3} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg></div>}
                              <button onClick={e => { e.stopPropagation(); toggleFav(item.id) }} style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill={favs.includes(item.id) ? '#ff3b30' : 'none'} stroke={favs.includes(item.id) ? '#ff3b30' : '#fff'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                              </button>
                            </div>
                          )}
                          <div style={{ padding: '12px 12px 13px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontWeight: 600, fontSize: 15, color: T.text, marginBottom: 3, lineHeight: 1.25 }}>{nm(item)}</div>
                            {dsc(item) && <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{dsc(item)}</div>}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                              {item.intensity != null && <IntensityBars n={item.intensity} />}
                              {trendingIds.includes(item.id) && <span style={{ fontSize: 10, fontWeight: 700, color: accent, border: `1px solid ${accent}`, padding: '1px 6px', borderRadius: 6 }}>{t('menu.trending')}</span>}
                              {tagPills(item).map(d => <span key={d.id} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: d.color, padding: '2px 7px', borderRadius: 6 }}>{t(d.labelKey)}</span>)}
                            </div>
                            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                {item.price != null && <div style={{ fontWeight: 700, fontSize: 16, color: accent }}>{money(item.price)}</div>}
                                {settings.show_calories && item.calories && <div style={{ fontSize: 11, color: T.text3, background: T.fill, padding: '2px 6px', borderRadius: 7 }}>{item.calories} {t('menu.kcal')}</div>}
                                {orderable(item) && item.stock_left != null && item.stock_left > 0 && <div style={{ fontSize: 11, color: '#ff9500', background: 'rgba(255,149,0,0.12)', padding: '2px 6px', borderRadius: 7 }}>{t('menu.stockLeft', { n: item.stock_left })}</div>}
                              </div>
                              {!item.is_available
                                ? <div style={{ fontSize: 11, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.unavailable')}</div>
                                : soldOutToday(item)
                                ? <div style={{ fontSize: 11, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.soldOutToday')}</div>
                                : settings.allow_orders && (qty === 0
                                  ? <button onClick={e => { e.stopPropagation(); addToCart(item) }} style={{ width: 34, height: 34, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 10px ${accent}44`, flexShrink: 0 }}><svg width="15" height="15" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg></button>
                                  : <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                      <button onClick={() => removeFromCart(item.id)} style={{ width: 28, height: 28, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text }}><svg width="11" height="2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 2"><path d="M1 1h10" /></svg></button>
                                      <span style={{ fontWeight: 700, fontSize: 15, color: accent, minWidth: 16, textAlign: 'center' }}>{qty}</span>
                                      <button onClick={() => addToCart(item)} style={{ width: 28, height: 28, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="11" height="11" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg></button>
                                    </div>)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: T.surface, borderRadius: radius, overflow: 'hidden', marginBottom: 32, ...cardShadow }}>
                    {catItems.map((item, i) => {
                      const qty = cartQty(item.id)
                      const isLast = i === catItems.length - 1
                      return (
                        <div key={item.id} onClick={() => openDetail(item)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: isLast ? 'none' : `0.5px solid ${T.sep}`, opacity: orderable(item) ? 1 : 0.45, cursor: 'pointer' }}>
                          {settings.show_photos && (
                            <div style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', flexShrink: 0, background: T.fill }}>
                              {item.image_url ? <img src={item.image_url} alt={nm(item)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="24" height="24" fill="none" stroke={T.text3} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg></div>}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 16, color: T.text, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm(item)}</div>
                            {dsc(item) && <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{dsc(item)}</div>}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                              {item.price != null && <div style={{ fontWeight: 700, fontSize: 16, color: accent }}>{money(item.price)}</div>}
                              {item.intensity != null && <IntensityBars n={item.intensity} />}
                              {settings.show_calories && item.calories && <div style={{ fontSize: 12, color: T.text3, background: T.fill, padding: '2px 8px', borderRadius: 8 }}>{item.calories} {t('menu.kcal')}</div>}
                              {trendingIds.includes(item.id) && <span style={{ fontSize: 10, fontWeight: 700, color: accent, border: `1px solid ${accent}`, padding: '1px 6px', borderRadius: 6 }}>{t('menu.trending')}</span>}
                              {orderable(item) && item.stock_left != null && item.stock_left > 0 && <div style={{ fontSize: 12, color: '#ff9500', background: 'rgba(255,149,0,0.12)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.stockLeft', { n: item.stock_left })}</div>}
                              {tagPills(item).map(d => <span key={d.id} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: d.color, padding: '2px 7px', borderRadius: 6 }}>{t(d.labelKey)}</span>)}
                              {!item.is_available && <div style={{ fontSize: 12, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.unavailable')}</div>}
                              {item.is_available && soldOutToday(item) && <div style={{ fontSize: 12, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.soldOutToday')}</div>}
                            </div>
                          </div>
                          {settings.allow_orders && orderable(item) && (
                            <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
                              {qty === 0
                                ? <button onClick={() => addToCart(item)} style={{ width: 36, height: 36, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 10px ${accent}44` }}><svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg></button>
                                : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <button onClick={() => removeFromCart(item.id)} style={{ width: 30, height: 30, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text }}><svg width="12" height="2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 2"><path d="M1 1h10" /></svg></button>
                                    <span style={{ fontWeight: 700, fontSize: 16, color: accent, minWidth: 20, textAlign: 'center' }}>{qty}</span>
                                    <button onClick={() => addToCart(item)} style={{ width: 30, height: 30, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg></button>
                                  </div>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {(search || filterCount > 0) && visibleCats.every(c => filteredItems(c.id).length === 0) && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: T.text2 }}>
              <svg width="48" height="48" fill="none" stroke={T.text3} strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: 16, opacity: 0.5 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <div style={{ fontWeight: 600, fontSize: 17, color: T.text, marginBottom: 6 }}>{t('menu.nothingFound')}</div>
              <div style={{ fontSize: 14 }}>{t('menu.tryAnother')}</div>
            </div>
          )}

          <div style={{ textAlign: 'center', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: 0.25 }}>
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="14" fill={T.text} /><rect x="14" y="20" width="36" height="5" rx="2.5" fill="white" /><rect x="14" y="30" width="26" height="5" rx="2.5" fill="white" opacity=".7" /><rect x="14" y="40" width="18" height="5" rx="2.5" fill="white" opacity=".4" /></svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Powered by Mise</span>
          </div>
        </div>
      </div>
      </>
      )}

      {/* ITEM DETAIL SHEET */}
      {detail && (() => {
        const item = detail
        const optsPrice = (item.modifiers || []).reduce((s, g, gi) => s + (g.options[detailSel[gi] || 0]?.price || 0), 0)
        const comboList = (item.combo_items || []).map(ci => ({ ...ci, it: items.find(x => x.id === ci.item_id) })).filter(c => c.it)
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 520, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setDetail(null)}>
            <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '88dvh', overflowY: 'auto', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
              {settings.show_photos && item.image_url && <div style={{ width: '100%', aspectRatio: '16/10', background: T.fill, overflow: 'hidden' }}><img src={item.image_url} alt={nm(item)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
              <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: settings.show_photos && item.image_url ? '10px auto 0' : '14px auto 0' }} />
              <div style={{ padding: '14px 20px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 22, color: T.text, letterSpacing: -0.4, fontFamily: headFont }}>{nm(item)}</div>
                  <button onClick={() => toggleFav(item.id)} style={{ width: 36, height: 36, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={favs.includes(item.id) ? '#ff3b30' : 'none'} stroke={favs.includes(item.id) ? '#ff3b30' : T.text2} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                  </button>
                </div>
                {dsc(item) && <div style={{ fontSize: 15, color: T.text2, lineHeight: 1.5, marginTop: 8 }}>{dsc(item)}</div>}
                {item.intensity != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('menu.intensity')}</span>
                    <IntensityBars n={item.intensity} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                  {trendingIds.includes(item.id) && <span style={{ fontSize: 12, fontWeight: 700, color: accent, border: `1.5px solid ${accent}`, padding: '3px 9px', borderRadius: 8 }}>{t('menu.trending')}</span>}
                  {tagPills(item).map(d => <span key={d.id} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: d.color, padding: '4px 10px', borderRadius: 8 }}>{t(d.labelKey)}</span>)}
                  {settings.show_calories && item.calories && <span style={{ fontSize: 12, color: T.text2, background: T.fill, padding: '4px 10px', borderRadius: 8 }}>{item.calories} {t('menu.kcal')}</span>}
                  {orderable(item) && item.stock_left != null && item.stock_left > 0 && <span style={{ fontSize: 12, color: '#ff9500', background: 'rgba(255,149,0,0.12)', padding: '4px 10px', borderRadius: 8 }}>{t('menu.stockLeft', { n: item.stock_left })}</span>}
                  {item.is_available && soldOutToday(item) && <span style={{ fontSize: 12, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '4px 10px', borderRadius: 8 }}>{t('menu.soldOutToday')}</span>}
                </div>
                {settings.show_allergens && item.allergens && item.allergens.length > 0 && <div style={{ fontSize: 13, color: T.text3, marginTop: 10 }}>{item.allergens.join(', ')}</div>}
                {comboList.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{t('menu.comboIncludes')}</div>
                    {comboList.map((c, i) => <div key={i} style={{ fontSize: 14, color: T.text, padding: '3px 0' }}>{c.qty} × {nm(c.it!)}</div>)}
                  </div>
                )}
              </div>

              {(item.modifiers || []).length > 0 && (
                <div style={{ padding: '4px 16px 8px' }}>
                  {(item.modifiers || []).map((g, gi) => (
                    <div key={gi} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 2px 8px' }}>{g.name}</div>
                      <div style={{ background: T.surface2, borderRadius: 14, overflow: 'hidden' }}>
                        {g.options.map((o, oi) => (
                          <button key={oi} onClick={() => setDetailSel(s => s.map((x, i) => i === gi ? oi : x))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', borderBottom: oi < g.options.length - 1 ? `0.5px solid ${T.sep}` : 'none' }}>
                            <span style={{ fontSize: 15, color: T.text, fontWeight: detailSel[gi] === oi ? 600 : 400 }}>{o.name}{o.price > 0 ? `  +${money(o.price)}` : ''}</span>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${detailSel[gi] === oi ? accent : T.sep}`, background: detailSel[gi] === oi ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{detailSel[gi] === oi && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ padding: '8px 16px 4px' }}>
                {settings.allow_orders && orderable(item) ? (
                  <button onClick={() => { const opts = (item.modifiers || []).map((g, gi) => g.options[detailSel[gi] || 0]).filter(Boolean); addToCart(item, opts.length ? opts : undefined); setDetail(null) }} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 20px ${accent}55` }}>{t('menu.addToOrder')}{item.price != null ? ` · ${money((item.price || 0) + optsPrice)}` : ''}</button>
                ) : item.price != null ? (
                  <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: T.text, padding: '8px' }}>{money(item.price)}</div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })()}

      {/* FILTERS SHEET */}
      {showFilters && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowFilters(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, paddingBottom: 'calc(20px + env(safe-area-inset-bottom,0px))', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 4', color: T.text }}>{t('menu.filters')}</div>
            <div style={{ padding: '8px 20px' }}>
              <button onClick={() => setOnlyFav(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', borderBottom: `0.5px solid ${T.sep}` }}>
                <span style={{ fontSize: 16, color: T.text }}>{t('menu.favorites')}</span>
                <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${onlyFav ? accent : T.sep}`, background: onlyFav ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{onlyFav && <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}</span>
              </button>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '14px 0' }}>
                {availTags.map(tg => {
                  const on = activeTags.includes(tg.id)
                  return <button key={tg.id} onClick={() => setActiveTags(s => on ? s.filter(x => x !== tg.id) : [...s, tg.id])} style={{ padding: '8px 14px', borderRadius: 999, border: `1.5px solid ${on ? tg.color : T.sep}`, background: on ? tg.color : 'transparent', color: on ? '#fff' : T.text2, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t(tg.labelKey)}</button>
                })}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setActiveTags([]); setOnlyFav(false) }} style={{ flex: 1, padding: '14px', borderRadius: 14, background: T.fill, color: T.text, border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{t('menu.clearFilters')}</button>
                <button onClick={() => setShowFilters(false)} style={{ flex: 1, padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{t('menu.all')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LANGUAGE SHEET */}
      {showLang && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowLang(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '70dvh', overflowY: 'auto', paddingBottom: 'calc(20px + env(safe-area-inset-bottom,0px))', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 8', color: T.text }}>{t('menu.language')}</div>
            {MENU_LOCALES.map(l => (
              <button key={l} onClick={() => { setContentLang(l); setShowLang(false) }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontSize: 16, color: T.text }}>{LOCALE_LABEL[l]}</span>
                {contentLang === l && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill={accent} /><path d="m6 10 2.5 2.5L14 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI QUIZ SHEET — rule-based, 2 tap → recommendation */}
      {showQuiz && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowQuiz(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, paddingBottom: 'calc(20px + env(safe-area-inset-bottom,0px))', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 4px', fontFamily: headFont, color: T.text }}>{t('menu.quizTitle')}</div>
            <div style={{ padding: '10px 20px 4px' }}>
              {([['chill', t('menu.quizChill'), t('menu.quizChillD')], ['social', t('menu.quizSocial'), t('menu.quizSocialD')], ['bold', t('menu.quizBold'), t('menu.quizBoldD')]] as const).map(([mood, label, desc]) => (
                <button key={mood} onClick={() => {
                  const pick = pickForMood(mood)
                  setShowQuiz(false)
                  if (pick) setTimeout(() => openDetail(pick), 250)
                }} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', borderRadius: 14, border: `1px solid ${T.sep}`, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{label}</div>
                  <div style={{ fontSize: 12.5, color: T.text2, marginTop: 2 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* BILL BUTTON */}
      {settings.allow_orders && bill.length > 0 && (
        <button onClick={() => setShowBill(true)} style={{ position: 'fixed', right: 16, bottom: cartCount > 0 ? 96 : 24, zIndex: 290, width: 52, height: 52, borderRadius: '50%', border: 'none', background: T.surface, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 2h14v20l-2.5-1.5L14 22l-2-1.5L10 22l-2.5-1.5L5 22V2z" /><path d="M9 7h6M9 11h6" /></svg>
        </button>
      )}

      {/* BILL MODAL */}
      {showBill && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowBill(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: T.text }}>{t('menu.yourBill')}{tableN ? ` · ${t('menu.table')} ${tableN}` : ''}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {bill.map((o, oi) => (
                <div key={oi} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: T.text3, fontWeight: 600, marginBottom: 6 }}>{t('menu.order')} {oi + 1} · {new Date(o.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                  {o.items.map((it: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, color: T.text }}><span>{it.name} × {it.qty}</span>{it.price != null && <span style={{ color: T.text2 }}>{money(it.price * it.qty)}</span>}</div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 16px 20px', borderTop: `0.5px solid ${T.sep}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span style={{ fontSize: 16, color: T.text2 }}>{t('menu.totalTable')}</span><span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{money(bill.reduce((s, o) => s + (o.total || 0), 0))}</span></div>
              {settings.allow_orders && bill.length > 0 && (
                <button onClick={reorderLast} style={{ width: '100%', padding: '13px', borderRadius: 14, background: 'transparent', border: `1.5px solid ${T.sep}`, color: T.text, fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>{t('menu.reorderLast')}</button>
              )}
              {settings.quick_actions === false ? (
                <button onClick={() => sendQuickAction('waiter')} disabled={!!waiterCalled} style={{ width: '100%', padding: '16px', borderRadius: 16, background: waiterCalled ? T.fill : accent, color: waiterCalled ? T.text2 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: waiterCalled ? 'default' : 'pointer', boxShadow: waiterCalled ? 'none' : `0 4px 20px ${accent}55` }}>{waiterCalled ? t('menu.waiterComing') : t('menu.callWaiter')}</button>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {([['waiter', t('menu.qaWaiter'), <svg key="w" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="7" r="3" /><path d="M5 21v-3a7 7 0 0114 0v3" /></svg>],
                    ['coal', t('menu.qaCoal'), <svg key="c" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><circle cx="12" cy="16" r="3" /></svg>],
                    ['water', t('menu.qaWater'), <svg key="a" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" /></svg>]] as const).map(([kind, label, icon]) => (
                    <button key={kind} onClick={() => sendQuickAction(kind)} disabled={waiterCalled === kind} style={{ padding: '12px 4px', borderRadius: 14, background: waiterCalled === kind ? T.fill : T.surface2, border: 'none', color: waiterCalled === kind ? T.text3 : accent, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: waiterCalled === kind ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      {icon}<span>{waiterCalled === kind ? t('menu.waiterComing') : label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CART BAR */}
      {settings.allow_orders && cartCount > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${T.sep}` }}>
          <button onClick={() => setShowCart(true)} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: `0 4px 20px ${accent}55` }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>{cartCount}</div>
            <span>{t('menu.cart')}{tableN ? ` · ${t('menu.table')} ${tableN}` : ''}</span>
            <span style={{ fontWeight: 700 }}>{money(cartTotal)}</span>
          </button>
          {tableGuests > 1 && <div style={{ textAlign: 'center', fontSize: 11.5, color: T.text3, marginTop: 6 }}>{t('menu.sharedCart', { n: tableGuests })}</div>}
        </div>
      )}

      {/* CART MODAL */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowCart(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: T.text }}>{t('menu.yourOrder')}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {cart.map((c, i) => (
                <div key={entryKey(c)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < cart.length - 1 ? `0.5px solid ${T.sep}` : 'none' }}>
                  {settings.show_photos && c.item.image_url && <img src={c.item.image_url} alt={nm(c.item)} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: T.text }}>{nm(c.item)}</div>
                    {c.opts && c.opts.length > 0 && <div style={{ fontSize: 12, color: T.text2, marginTop: 1 }}>{c.opts.map(o => o.name).join(' · ')}</div>}
                    {unitPrice(c) > 0 && <div style={{ fontSize: 14, color: accent, fontWeight: 600, marginTop: 2 }}>{money(unitPrice(c))}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => incEntry(i, -1)} style={{ width: 28, height: 28, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text }}><svg width="10" height="2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 2"><path d="M1 1h8" /></svg></button>
                    <span style={{ fontWeight: 700, fontSize: 16, color: T.text, minWidth: 18, textAlign: 'center' }}>{c.qty}</span>
                    <button onClick={() => incEntry(i, 1)} style={{ width: 28, height: 28, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 10"><path d="M5 1v8M1 5h8" /></svg></button>
                  </div>
                </div>
              ))}

              {/* Upsell */}
              {upsell.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text2, marginBottom: 10 }}>{t('menu.recommend')}</div>
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                    {upsell.map(u => (
                      <button key={u.id} onClick={() => addToCart(u)} style={{ flexShrink: 0, width: 120, background: T.surface2, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', overflow: 'hidden', padding: 0 }}>
                        {settings.show_photos && u.image_url && <img src={u.image_url} alt={nm(u)} style={{ width: '100%', height: 70, objectFit: 'cover' }} />}
                        <div style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm(u)}</div>
                          {u.price != null && <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginTop: 2 }}>+{money(u.price)}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tips */}
              {settings.allow_tips && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text2, marginBottom: 10 }}>{t('menu.tip')}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {TIP_PRESETS.map(p => (
                      <button key={p} onClick={() => setTipPct(p)} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: `1.5px solid ${tipPct === p ? accent : T.sep}`, background: tipPct === p ? `${accent}14` : 'transparent', color: tipPct === p ? accent : T.text2, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{p === 0 ? t('menu.tipNone') : `${p}%`}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 16px 20px', borderTop: `0.5px solid ${T.sep}` }}>
              {tableN && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span style={{ fontSize: 14, color: T.text2 }}>{t('menu.tableCap')}</span><span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{tableN}</span></div>}
              {tipAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span style={{ fontSize: 14, color: T.text2 }}>{t('menu.tip')} {tipPct}%</span><span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{money(tipAmount)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: settings.allow_pay_at_table ? 8 : 16 }}><span style={{ fontSize: 16, color: T.text2 }}>{t('menu.total')}</span><span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{money(grandTotal)}</span></div>
              {settings.allow_pay_at_table && <div style={{ fontSize: 13, color: T.text2, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="3" /><path d="M1 10h22" /></svg>{t('menu.payAtTable')}</div>}
              <button onClick={sendOrder} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 20px ${accent}55` }}>{t('menu.sendOrder')}</button>
            </div>
          </div>
        </div>
      )}

      {orderSent && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: '#1c1c1e', color: '#fff', padding: '14px 24px', borderRadius: 14, fontSize: 15, fontWeight: 600, zIndex: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>{t('menu.orderSent')}</div>
      )}
      {orderError && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', maxWidth: '86vw', background: '#1c1c1e', color: '#fff', padding: '14px 24px', borderRadius: 14, fontSize: 15, fontWeight: 600, zIndex: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', textAlign: 'center' }}>{t('menu.orderFailed')}</div>
      )}
    </div>
  )
}
