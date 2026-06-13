'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef, use } from 'react'
import { useI18n } from '@/lib/i18n'

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface MenuSettings {
  id: string
  restaurant_id: string
  slug: string
  is_published: boolean
  theme: 'light' | 'dark' | 'auto'
  accent_color: string
  cover_url: string | null
  show_photos: boolean
  allow_orders: boolean
  allow_pay_at_table: boolean
  show_allergens: boolean
  show_calories: boolean
  language: string
}

interface Category {
  id: string
  name: string
  description: string | null
  image_url: string | null
  position: number
  is_visible: boolean
}

interface MenuItem {
  id: string
  category_id: string
  name: string
  description: string | null
  price: number | null
  image_url: string | null
  is_visible: boolean
  is_available: boolean
  calories: number | null
  allergens: string[] | null
  modifiers: { name: string; options: { name: string; price: number }[] }[] | null
  position: number
}

interface Restaurant {
  id: string
  name: string
  logo_url: string | null
  currency: string | null
}

interface CartItem {
  item: MenuItem
  qty: number
  opts?: { name: string; price: number }[] // выбранные модификаторы
}

// Один и тот же товар с разными модификаторами — разные строки корзины
function entryKey(c: { item: MenuItem; opts?: { name: string }[] }) {
  return c.item.id + '|' + (c.opts || []).map(o => o.name).join(',')
}
function unitPrice(c: CartItem) {
  return (c.item.price || 0) + (c.opts || []).reduce((s, o) => s + (o.price || 0), 0)
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fv(v: number, currency = '€') {
  return currency + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { t } = useI18n() // язык телефона гостя
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
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [tableN, setTableN] = useState<string | null>(null) // ?table=N — QR на столе
  // «Цифровой счёт»: заказы этой сессии (localStorage), живёт 6 часов
  const [bill, setBill] = useState<{ items: any[]; total: number; at: number }[]>([])
  const [showBill, setShowBill] = useState(false)
  const [waiterCalled, setWaiterCalled] = useState(false)
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const navRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadMenu()
    const t = new URLSearchParams(window.location.search).get('table')
    if (t) setTableN(t.replace(/[^0-9a-zA-Zа-яА-Я-]/g, '').slice(0, 10) || null)
    try {
      const saved = JSON.parse(localStorage.getItem(`mise_bill_${slug}`) || '[]')
      setBill(saved.filter((o: any) => Date.now() - o.at < 6 * 3600000))
    } catch {}
  }, [slug])

  const saveBill = (next: { items: any[]; total: number; at: number }[]) => {
    setBill(next)
    try { localStorage.setItem(`mise_bill_${slug}`, JSON.stringify(next)) } catch {}
  }

  const callWaiter = async () => {
    setWaiterCalled(true); setTimeout(() => setWaiterCalled(false), 60000)
    await fetch('/api/menu/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, type: 'waiter_call', table_number: tableN }),
    })
  }

  useEffect(() => {
    if (!settings) return
    if (settings.theme === 'dark') setIsDark(true)
    else if (settings.theme === 'light') setIsDark(false)
    else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      setIsDark(mq.matches)
    }
  }, [settings])

  const loadMenu = async () => {
    const res = await fetch(`/api/menu/${slug}`)
    if (!res.ok) { setNotFound(true); setLoading(false); return }
    const { settings: s, restaurant: rest, categories: cats, items: its } = await res.json()
    if (!s) { setNotFound(true); setLoading(false); return }

    setSettings(s)
    setRestaurant(rest)
    setCategories(cats || [])
    setItems(its || [])
    if (cats && cats.length > 0) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  // Позиция с модификаторами сначала проходит через шторку выбора
  const [modItem, setModItem] = useState<MenuItem | null>(null)
  const [modSel, setModSel] = useState<number[]>([])

  const addToCart = (item: MenuItem, opts?: { name: string; price: number }[]) => {
    if (!opts && item.modifiers && item.modifiers.length > 0) {
      setModSel(item.modifiers.map(() => 0)); setModItem(item)
      return
    }
    const key = entryKey({ item, opts })
    setCart(prev => {
      const existing = prev.find(c => entryKey(c) === key)
      if (existing) return prev.map(c => entryKey(c) === key ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { item, qty: 1, opts }]
    })
  }

  const removeFromCart = (itemId: string) => {
    setCart(prev => {
      const idx = prev.findIndex(c => c.item.id === itemId)
      if (idx < 0) return prev
      const c = prev[idx]
      if (c.qty === 1) return prev.filter((_, i) => i !== idx)
      return prev.map((x, i) => i === idx ? { ...x, qty: x.qty - 1 } : x)
    })
  }

  const incEntry = (idx: number, d: number) => {
    setCart(prev => prev
      .map((c, i) => i === idx ? { ...c, qty: c.qty + d } : c)
      .filter(c => c.qty > 0))
  }

  const cartQty = (itemId: string) => cart.filter(c => c.item.id === itemId).reduce((s, c) => s + c.qty, 0)
  const cartTotal = cart.reduce((s, c) => s + unitPrice(c) * c.qty, 0)
  const cartCount = cart.reduce((s, c) => s + c.qty, 0)

  const sendOrder = async () => {
    if (!restaurant || cart.length === 0) return
    // Snapshot before clearing
    const orderItems = cart.map(c => ({ id: c.item.id, name: c.item.name, price: unitPrice(c), qty: c.qty, opts: c.opts?.map(o => o.name) }))
    const total = cartTotal
    saveBill([...bill, { items: orderItems, total, at: Date.now() }])
    setOrderSent(true); setShowCart(false); setCart([])
    setTimeout(() => setOrderSent(false), 3000)
    await fetch('/api/menu/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, items: orderItems, total, table_number: tableN }),
    })
  }

  const scrollToCategory = (catId: string) => {
    setActiveCategory(catId)
    const el = categoryRefs.current[catId]
    if (el && scrollRef.current) {
      const top = el.offsetTop - 120
      scrollRef.current.scrollTo({ top, behavior: 'smooth' })
    }
    // Scroll nav to show active
    const navEl = navRef.current
    if (navEl) {
      const btn = navEl.querySelector(`[data-cat="${catId}"]`) as HTMLElement
      if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }

  const filteredItems = (catId: string) =>
    items.filter(i => i.category_id === catId && (
      !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.description || '').toLowerCase().includes(search.toLowerCase())
    ))

  const accent = settings?.accent_color || '#007aff'
  const currency = restaurant?.currency || '€'
  const money = (v: number) => fv(v, currency)

  // ── THEME ──
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

  // ── LOADING ──
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 30, height: 30, border: '2.5px solid rgba(255,255,255,0.14)', borderTopColor: 'rgba(255,255,255,0.85)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── NOT FOUND ──
  if (notFound || !settings || !restaurant) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, fontFamily: '-apple-system,sans-serif' }}>
      <div style={{ fontSize: 48, marginBottom: 8, opacity: 0.3 }}>
        <svg width="64" height="64" fill="none" stroke="white" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      </div>
      <div style={{ fontWeight: 700, fontSize: 20, color: '#fff' }}>{t('menu.notFound')}</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', maxWidth: 260 }}>{t('menu.notFoundHint')}</div>
    </div>
  )

  const visibleCats = categories.filter(c => filteredItems(c.id).length > 0 || !search)

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: T.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: T.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        @keyframes cartBounce{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
        * { box-sizing: border-box }
        ::-webkit-scrollbar { display: none }
        input { -webkit-appearance: none }
      `}</style>

      {/* ── COVER + HEADER ── */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200 }}>
        {/* Cover image */}
        {settings.cover_url && (
          <div style={{ height: 180, position: 'relative', overflow: 'hidden' }}>
            <img src={settings.cover_url} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 100%)' }} />
            <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              {restaurant.logo_url && <img src={restaurant.logo_url} alt="logo" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />}
              <div>
                <div style={{ fontWeight: 800, fontSize: 22, color: '#fff', letterSpacing: -0.5, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{restaurant.name}</div>
              </div>
            </div>
          </div>
        )}

        {/* Top bar (no cover) */}
        {!settings.cover_url && (
          <div style={{ height: 56, background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
            {restaurant.logo_url && <img src={restaurant.logo_url} alt="logo" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />}
            <span style={{ fontWeight: 700, fontSize: 17, color: T.text, letterSpacing: -0.3, flex: 1 }}>{restaurant.name}</span>
            <button onClick={() => setShowSearch(!showSearch)} style={{ width: 36, height: 36, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text2 }}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </button>
          </div>
        )}

        {/* Search bar */}
        {(showSearch || settings.cover_url) && (
          <div style={{ background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', padding: '8px 16px', borderBottom: `0.5px solid ${T.sep}` }}>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="16" height="16" fill="none" stroke={T.text3} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('menu.search')} style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 12, border: `1px solid ${T.sep}`, fontSize: 15, color: T.text, background: T.surface, fontFamily: 'inherit', outline: 'none' }} />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: T.fill, border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', color: T.text2, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>}
            </div>
          </div>
        )}

        {/* Category nav */}
        <div ref={navRef} style={{ background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}`, overflowX: 'auto', display: 'flex', gap: 4, padding: '10px 16px', scrollbarWidth: 'none' }}>
          {visibleCats.map(cat => (
            <button key={cat.id} data-cat={cat.id} onClick={() => scrollToCategory(cat.id)} style={{
              flexShrink: 0, padding: '7px 16px', borderRadius: 20, border: 'none',
              fontFamily: 'inherit', fontSize: 14, fontWeight: activeCategory === cat.id ? 700 : 500,
              cursor: 'pointer', transition: 'all .18s',
              background: activeCategory === cat.id ? accent : T.fill,
              color: activeCategory === cat.id ? '#fff' : T.text2,
              boxShadow: activeCategory === cat.id ? `0 2px 12px ${accent}44` : 'none',
            }}>{cat.name}</button>
          ))}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div
        ref={scrollRef}
        style={{ position: 'fixed', top: settings.cover_url ? 180 + 44 + 44 : 56 + 44, left: 0, right: 0, bottom: cartCount > 0 ? 80 : 0, overflowY: 'auto', background: T.bg }}
        onScroll={() => {
          if (!scrollRef.current) return
          const scrollTop = scrollRef.current.scrollTop
          let current = visibleCats[0]?.id || ''
          for (const cat of visibleCats) {
            const el = categoryRefs.current[cat.id]
            if (el && el.offsetTop - 140 <= scrollTop) current = cat.id
          }
          setActiveCategory(current)
        }}
      >
        <div style={{ padding: '20px 16px 40px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp .25s ease' }}>
          {visibleCats.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            return (
              <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el }}>
                {/* Category header */}
                <div style={{ marginBottom: 14, marginTop: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 22, color: T.text, letterSpacing: -0.5 }}>{cat.name}</div>
                  {cat.description && <div style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>{cat.description}</div>}
                </div>

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: T.surface, borderRadius: 20, overflow: 'hidden', marginBottom: 32, boxShadow: T.sh }}>
                  {catItems.map((item, i) => {
                    const qty = cartQty(item.id)
                    const isLast = i === catItems.length - 1
                    return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: isLast ? 'none' : `0.5px solid ${T.sep}`, opacity: item.is_available ? 1 : 0.45 }}>

                        {/* Photo */}
                        {settings.show_photos && (
                          <div style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', flexShrink: 0, background: T.fill }}>
                            {item.image_url
                              ? <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="24" height="24" fill="none" stroke={T.text3} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                                </div>
                            }
                          </div>
                        )}

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 16, color: T.text, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          {item.description && <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</div>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                            {item.price && <div style={{ fontWeight: 700, fontSize: 16, color: accent }}>{money(item.price)}</div>}
                            {settings.show_calories && item.calories && <div style={{ fontSize: 12, color: T.text3, background: T.fill, padding: '2px 8px', borderRadius: 8 }}>{item.calories} {t('menu.kcal')}</div>}
                            {!item.is_available && <div style={{ fontSize: 12, color: '#ff3b30', background: 'rgba(255,59,48,0.1)', padding: '2px 8px', borderRadius: 8 }}>{t('menu.unavailable')}</div>}
                          </div>
                          {settings.show_allergens && item.allergens && item.allergens.length > 0 && (
                            <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>{item.allergens.join(', ')}</div>
                          )}
                        </div>

                        {/* Add to cart / qty */}
                        {settings.allow_orders && item.is_available && (
                          <div style={{ flexShrink: 0 }}>
                            {qty === 0 ? (
                              <button onClick={() => addToCart(item)} style={{ width: 36, height: 36, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 10px ${accent}44` }}>
                                <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg>
                              </button>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => removeFromCart(item.id)} style={{ width: 30, height: 30, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text }}>
                                  <svg width="12" height="2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 2"><path d="M1 1h10" /></svg>
                                </button>
                                <span style={{ fontWeight: 700, fontSize: 16, color: accent, minWidth: 20, textAlign: 'center' }}>{qty}</span>
                                <button onClick={() => addToCart(item)} style={{ width: 30, height: 30, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Empty search */}
          {search && visibleCats.every(c => filteredItems(c.id).length === 0) && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: T.text2 }}>
              <svg width="48" height="48" fill="none" stroke={T.text3} strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: 16, opacity: 0.5 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <div style={{ fontWeight: 600, fontSize: 17, color: T.text, marginBottom: 6 }}>{t('menu.nothingFound')}</div>
              <div style={{ fontSize: 14 }}>{t('menu.tryAnother')}</div>
            </div>
          )}

          {/* Mise footer */}
          <div style={{ textAlign: 'center', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: 0.25 }}>
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="14" fill={T.text} /><rect x="14" y="20" width="36" height="5" rx="2.5" fill="white" /><rect x="14" y="30" width="26" height="5" rx="2.5" fill="white" opacity=".7" /><rect x="14" y="40" width="18" height="5" rx="2.5" fill="white" opacity=".4" /></svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Powered by Mise</span>
          </div>
        </div>
      </div>

      {/* ── MODIFIERS SHEET ── */}
      {modItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 520, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setModItem(null)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '80dvh', overflowY: 'auto', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 4', color: T.text }}>{modItem.name}</div>
            <div style={{ padding: '8px 16px 16px' }}>
              {(modItem.modifiers || []).map((g, gi) => (
                <div key={gi} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 2px 8px' }}>{g.name}</div>
                  <div style={{ background: T.surface2, borderRadius: 14, overflow: 'hidden' }}>
                    {g.options.map((o, oi) => (
                      <button key={oi} onClick={() => setModSel(s => s.map((x, i) => i === gi ? oi : x))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', borderBottom: oi < g.options.length - 1 ? `0.5px solid ${T.sep}` : 'none' }}>
                        <span style={{ fontSize: 15, color: T.text, fontWeight: modSel[gi] === oi ? 600 : 400 }}>{o.name}{o.price > 0 ? `  +${money(o.price)}` : ''}</span>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${modSel[gi] === oi ? accent : T.sep}`, background: modSel[gi] === oi ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {modSel[gi] === oi && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={() => {
                const opts = (modItem.modifiers || []).map((g, gi) => g.options[modSel[gi] || 0]).filter(Boolean)
                addToCart(modItem, opts)
                setModItem(null)
              }} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 20px ${accent}55` }}>
                {t('menu.add')} · {money((modItem.price || 0) + (modItem.modifiers || []).reduce((s, g, gi) => s + (g.options[modSel[gi] || 0]?.price || 0), 0))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BILL BUTTON (цифровой счёт) ── */}
      {settings.allow_orders && bill.length > 0 && (
        <button onClick={() => setShowBill(true)} style={{ position: 'fixed', right: 16, bottom: cartCount > 0 ? 96 : 24, zIndex: 290, width: 52, height: 52, borderRadius: '50%', border: 'none', background: T.surface, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 2h14v20l-2.5-1.5L14 22l-2-1.5L10 22l-2.5-1.5L5 22V2z" /><path d="M9 7h6M9 11h6" /></svg>
        </button>
      )}

      {/* ── BILL MODAL ── */}
      {showBill && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowBill(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: T.text }}>{t('menu.yourBill')}{tableN ? ` · ${t('menu.table')} ${tableN}` : ''}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {bill.map((o, oi) => (
                <div key={oi} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: T.text3, fontWeight: 600, marginBottom: 6 }}>
                    {t('menu.order')} {oi + 1} · {new Date(o.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {o.items.map((it: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, color: T.text }}>
                      <span>{it.name} × {it.qty}</span>
                      {it.price != null && <span style={{ color: T.text2 }}>{money(it.price * it.qty)}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 16px 20px', borderTop: `0.5px solid ${T.sep}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 16, color: T.text2 }}>{t('menu.totalTable')}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{money(bill.reduce((s, o) => s + (o.total || 0), 0))}</span>
              </div>
              <button onClick={callWaiter} disabled={waiterCalled} style={{ width: '100%', padding: '16px', borderRadius: 16, background: waiterCalled ? T.fill : accent, color: waiterCalled ? T.text2 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: waiterCalled ? 'default' : 'pointer', boxShadow: waiterCalled ? 'none' : `0 4px 20px ${accent}55` }}>
                {waiterCalled ? t('menu.waiterComing') : t('menu.callWaiter')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CART BAR ── */}
      {settings.allow_orders && cartCount > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${T.sep}` }}>
          <button onClick={() => setShowCart(true)} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: `0 4px 20px ${accent}55` }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>{cartCount}</div>
            <span>{t('menu.cart')}{tableN ? ` · ${t('menu.table')} ${tableN}` : ''}</span>
            <span style={{ fontWeight: 700 }}>{money(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* ── CART MODAL ── */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowCart(false)}>
          <div style={{ background: T.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: T.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: T.text }}>{t('menu.yourOrder')}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {cart.map((c, i) => (
                <div key={entryKey(c)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < cart.length - 1 ? `0.5px solid ${T.sep}` : 'none' }}>
                  {settings.show_photos && c.item.image_url && <img src={c.item.image_url} alt={c.item.name} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: T.text }}>{c.item.name}</div>
                    {c.opts && c.opts.length > 0 && <div style={{ fontSize: 12, color: T.text2, marginTop: 1 }}>{c.opts.map(o => o.name).join(' · ')}</div>}
                    {unitPrice(c) > 0 && <div style={{ fontSize: 14, color: accent, fontWeight: 600, marginTop: 2 }}>{money(unitPrice(c))}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => incEntry(i, -1)} style={{ width: 28, height: 28, borderRadius: '50%', background: T.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text }}>
                      <svg width="10" height="2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 2"><path d="M1 1h8" /></svg>
                    </button>
                    <span style={{ fontWeight: 700, fontSize: 16, color: T.text, minWidth: 18, textAlign: 'center' }}>{c.qty}</span>
                    <button onClick={() => incEntry(i, 1)} style={{ width: 28, height: 28, borderRadius: '50%', background: accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 10"><path d="M5 1v8M1 5h8" /></svg>
                    </button>
                  </div>
                  {unitPrice(c) > 0 && <div style={{ fontWeight: 700, fontSize: 15, color: T.text, minWidth: 60, textAlign: 'right' }}>{money(unitPrice(c) * c.qty)}</div>}
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 16px 20px', borderTop: `0.5px solid ${T.sep}` }}>
              {tableN && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: T.text2 }}>{t('menu.tableCap')}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{tableN}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: settings.allow_pay_at_table ? 8 : 16 }}>
                <span style={{ fontSize: 16, color: T.text2 }}>{t('menu.total')}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{money(cartTotal)}</span>
              </div>
              {settings.allow_pay_at_table && (
                <div style={{ fontSize: 13, color: T.text2, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="3" /><path d="M1 10h22" /></svg>
                  {t('menu.payAtTable')}
                </div>
              )}
              <button onClick={sendOrder} style={{ width: '100%', padding: '16px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 20px ${accent}55` }}>
                {t('menu.sendOrder')}
              </button>
            </div>
          </div>
        </div>
      )}

      {orderSent && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: '#1c1c1e', color: '#fff', padding: '14px 24px', borderRadius: 14, fontSize: 15, fontWeight: 600, zIndex: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
          {t('menu.orderSent')}
        </div>
      )}
    </div>
  )
}
