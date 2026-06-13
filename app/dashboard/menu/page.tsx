'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface MenuSettings {
  id?: string
  restaurant_id: string
  slug: string
  is_published: boolean
  theme: 'light' | 'dark' | 'auto'
  layout: 'list' | 'grid'
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
  position: number
  is_visible: boolean
  _editing?: boolean
}

interface ModGroup { name: string; options: { name: string; price: number }[] }

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
  modifiers: ModGroup[] | null
  position: number
}

const ACCENT_PRESETS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#00c7be', '#ff6b35', '#ff2d55']
const THEMES = [{ id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }, { id: 'auto', label: 'Авто' }]

// ── ICON ──────────────────────────────────────────────────────────────────────

function IconMenu({ color = 'currentColor', size = 28 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill={color} />
      <rect x="10" y="14" width="44" height="9" rx="4.5" fill="white" />
      <rect x="10" y="28" width="44" height="9" rx="4.5" fill="white" opacity="0.72" />
      <rect x="10" y="42" width="28" height="9" rx="4.5" fill="white" opacity="0.44" />
    </svg>
  )
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, color }: { value: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 51, height: 31, borderRadius: 16, background: value ? color : 'rgba(120,120,128,0.32)', cursor: 'pointer', transition: 'background .25s', position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', transition: 'left .25s' }} />
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function MenuEditor() {
  const router = useRouter()
  const t = useTheme()
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const appHost = typeof window !== 'undefined' ? window.location.host : ''
  const [restaurantId, setRestaurantId] = useState('')
  const [tab, setTab] = useState<'categories' | 'settings' | 'preview'>('categories')
  const [settings, setSettings] = useState<MenuSettings>({
    restaurant_id: '',
    slug: '',
    is_published: false,
    theme: 'light',
    layout: 'list',
    accent_color: '#007aff',
    cover_url: null,
    show_photos: true,
    allow_orders: false,
    allow_pay_at_table: false,
    show_allergens: false,
    show_calories: false,
    language: 'ru',
  })
  const [currency, setCurrency] = useState('€')
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [editItem, setEditItem] = useState<MenuItem | null>(null)
  const [newCatName, setNewCatName] = useState('')
  const [slugError, setSlugError] = useState('')

  // Item form state
  const [itemForm, setItemForm] = useState({ name: '', description: '', price: '', image_url: '', calories: '', allergens: '', is_available: true, is_visible: true })
  // Модификаторы (размер/добавки): цена опции в форме — строка, в БД — число
  const [mods, setMods] = useState<{ name: string; options: { name: string; price: string }[] }[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const itemFileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)

  const uploadPhoto = async (file: File, onDone: (url: string) => void) => {
    if (!file || !restaurantId) return
    setPhotoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `menu/${restaurantId}/${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('restaurant-assets').upload(path, file, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      onDone(publicUrl)
    } else { showToast('Ошибка загрузки фото') }
    setPhotoUploading(false)
  }

  useEffect(() => { init() }, [])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/auth/login'); return }
    const { data: rest } = await db.from('restaurants').select('id, currency, subscription_plan, subscription_status, comp_apps').eq('owner_id', user.id).single()
    if (!rest?.id) { setLoading(false); return }
    // QR-меню доступно с Business + активная подписка (или выдано админом)
    const subActive = ['active', 'trialing', 'canceling'].includes((rest as any).subscription_status || '')
    if (!subActive || (!['business', 'pro'].includes(rest.subscription_plan) && !(rest.comp_apps || []).includes('menu'))) {
      router.replace('/dashboard?tab=billing'); return
    }
    const rid = rest.id
    setRestaurantId(rid)
    if (rest.currency) setCurrency(rest.currency)

    const [sRes, cRes, iRes] = await Promise.all([
      db.from('menu_settings').select('*').eq('restaurant_id', rid).maybeSingle(),
      db.from('menu_categories').select('*').eq('restaurant_id', rid).order('position'),
      db.from('menu_items').select('*').eq('restaurant_id', rid).order('position'),
    ])

    if (sRes.data) setSettings(s => ({ ...s, ...sRes.data, layout: sRes.data.layout || 'list' }))
    else setSettings(s => ({ ...s, restaurant_id: rid }))
    setCategories(cRes.data || [])
    setItems(iRes.data || [])
    if (cRes.data && cRes.data.length > 0) setSelectedCat(cRes.data[0].id)
    setLoading(false)
  }

  const saveSettings = async () => {
    setSaving(true)
    setSlugError('')
    // Slug uniqueness is enforced by the DB unique index (cross-restaurant), so we just
    // catch the violation — the gateway is restaurant-scoped and can't pre-check globally.
    if (settings.id) {
      const payload: any = { ...settings, updated_at: new Date().toISOString() }
      let { error } = await db.from('menu_settings').update(payload).eq('id', settings.id)
      if (error?.code === '42703') { delete payload.layout; ({ error } = await db.from('menu_settings').update(payload).eq('id', settings.id)) } // колонка layout ещё не мигрирована — сохраняем без неё
      if (error) { setSlugError(error.code === '23505' ? 'Этот адрес уже занят' : error.message); setSaving(false); return }
    } else {
      const payload: any = { ...settings, restaurant_id: restaurantId }
      let res = await db.from('menu_settings').insert(payload).select().single()
      if (res.error?.code === '42703') { delete payload.layout; res = await db.from('menu_settings').insert(payload).select().single() }
      if (res.error) { setSlugError(res.error.code === '23505' ? 'Этот адрес уже занят' : res.error.message); setSaving(false); return }
      if (res.data) setSettings(res.data)
    }
    setSaving(false)
    showToast('Настройки сохранены')
  }

  const addCategory = async () => {
    if (!newCatName.trim()) return
    const pos = categories.length
    const { data } = await db.from('menu_categories').insert({ restaurant_id: restaurantId, name: newCatName.trim(), position: pos, is_visible: true }).select().single()
    if (data) {
      setCategories(c => [...c, data])
      setSelectedCat(data.id)
    }
    setNewCatName('')
    setShowAddCat(false)
  }

  const toggleCatVisibility = async (catId: string) => {
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    await db.from('menu_categories').update({ is_visible: !cat.is_visible }).eq('id', catId)
    setCategories(cs => cs.map(c => c.id === catId ? { ...c, is_visible: !c.is_visible } : c))
  }

  const deleteCategory = async (catId: string) => {
    if (!confirm('Удалить категорию и все позиции в ней?')) return
    await db.from('menu_items').delete().eq('category_id', catId)
    await db.from('menu_categories').delete().eq('id', catId)
    setCategories(cs => cs.filter(c => c.id !== catId))
    setItems(is => is.filter(i => i.category_id !== catId))
    setSelectedCat(categories.find(c => c.id !== catId)?.id || null)
  }

  const openAddItem = () => {
    setEditItem(null)
    setItemForm({ name: '', description: '', price: '', image_url: '', calories: '', allergens: '', is_available: true, is_visible: true })
    setMods([])
    setShowAddItem(true)
  }

  const openEditItem = (item: MenuItem) => {
    setEditItem(item)
    setItemForm({
      name: item.name, description: item.description || '', price: item.price ? String(item.price) : '',
      image_url: item.image_url || '', calories: item.calories ? String(item.calories) : '',
      allergens: item.allergens ? item.allergens.join(', ') : '',
      is_available: item.is_available, is_visible: item.is_visible,
    })
    setMods((item.modifiers || []).map(g => ({ name: g.name, options: g.options.map(o => ({ name: o.name, price: String(o.price || 0) })) })))
    setShowAddItem(true)
  }

  const saveItem = async () => {
    if (!itemForm.name.trim() || !selectedCat) return
    setSaving(true)
    const payload = {
      restaurant_id: restaurantId,
      category_id: selectedCat,
      name: itemForm.name.trim(),
      description: itemForm.description.trim() || null,
      price: parseFloat(itemForm.price) || null,
      image_url: itemForm.image_url.trim() || null,
      calories: parseInt(itemForm.calories) || null,
      allergens: itemForm.allergens ? itemForm.allergens.split(',').map(a => a.trim()).filter(Boolean) : null,
      is_available: itemForm.is_available,
      is_visible: itemForm.is_visible,
      modifiers: (() => {
        const clean = mods
          .map(g => ({ name: g.name.trim(), options: g.options.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), price: parseFloat(o.price) || 0 })) }))
          .filter(g => g.name && g.options.length > 0)
        return clean.length ? clean : null
      })(),
      position: editItem ? editItem.position : items.filter(i => i.category_id === selectedCat).length,
      updated_at: new Date().toISOString(),
    }
    if (editItem) {
      await db.from('menu_items').update(payload).eq('id', editItem.id)
      setItems(is => is.map(i => i.id === editItem.id ? { ...i, ...payload } : i))
    } else {
      const { data } = await db.from('menu_items').insert(payload).select().single()
      if (data) setItems(is => [...is, data])
    }
    setSaving(false)
    setShowAddItem(false)
    showToast(editItem ? 'Позиция обновлена' : 'Позиция добавлена')
  }

  const deleteItem = async (itemId: string) => {
    await db.from('menu_items').delete().eq('id', itemId)
    setItems(is => is.filter(i => i.id !== itemId))
    showToast('Удалено')
  }

  const toggleItemVisibility = async (item: MenuItem) => {
    await db.from('menu_items').update({ is_visible: !item.is_visible }).eq('id', item.id)
    setItems(is => is.map(i => i.id === item.id ? { ...i, is_visible: !i.is_visible } : i))
  }

  const toggleItemAvailability = async (item: MenuItem) => {
    await db.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    setItems(is => is.map(i => i.id === item.id ? { ...i, is_available: !i.is_available } : i))
  }

  const selectedCatItems = items.filter(i => i.category_id === selectedCat)

  if (loading) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <IconMenu color={t.purple} size={64} />
      <div style={{ width: 24, height: 24, border: `2.5px solid ${t.fill}`, borderTopColor: t.purple, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const TABS = [
    { id: 'categories', label: 'Меню', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg> },
    { id: 'settings', label: 'Настройки', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg> },
    { id: 'preview', label: 'Предпросмотр', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg> },
  ] as const

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        * { box-sizing: border-box }
        input,textarea{-webkit-appearance:none}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
      `}</style>

      {/* HEADER */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMenu color={t.purple} size={28} />
          <span style={{ fontWeight: 700, fontSize: 17, color: t.text, letterSpacing: -0.3 }}>Mise Menu</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: t.purple, background: `${t.purple}1a`, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: settings.is_published ? `${t.green}22` : t.fill, color: settings.is_published ? t.green : t.text3 }}>
            {settings.is_published ? 'Опубликовано' : 'Черновик'}
          </div>
          {settings.slug && (
            <a href={`/menu/${settings.slug}`} target="_blank" rel="noopener noreferrer" style={{ width: 34, height: 34, borderRadius: '50%', background: `${t.purple}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <svg width="16" height="16" fill="none" stroke={t.purple} strokeWidth="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            </a>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: '16px 16px 28px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {/* ══ CATEGORIES & ITEMS ══ */}
          {tab === 'categories' && (
            <div>
              {/* Category selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setSelectedCat(cat.id)} style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 20, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: selectedCat === cat.id ? 700 : 500, cursor: 'pointer', transition: 'all .18s', background: selectedCat === cat.id ? t.purple : t.fill, color: selectedCat === cat.id ? '#fff' : t.text2, boxShadow: selectedCat === cat.id ? `0 2px 10px ${t.purple}44` : 'none', opacity: cat.is_visible ? 1 : 0.5 }}>
                    {cat.name}
                  </button>
                ))}
                <button onClick={() => setShowAddCat(true)} style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 20, border: `1.5px dashed ${t.sep}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: t.text3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
                  Категория
                </button>
              </div>

              {/* Selected category actions */}
              {selectedCat && (() => {
                const cat = categories.find(c => c.id === selectedCat)
                if (!cat) return null
                return (
                  <div style={{ background: t.surface, borderRadius: 16, padding: '12px 16px', marginBottom: 16, boxShadow: t.sh, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: t.text }}>{cat.name}</div>
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{selectedCatItems.length} позиций</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => toggleCatVisibility(cat.id)} style={{ padding: '6px 12px', borderRadius: 10, background: cat.is_visible ? `${t.green}18` : t.fill, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: cat.is_visible ? t.green : t.text3, fontFamily: 'inherit' }}>
                        {cat.is_visible ? 'Видна' : 'Скрыта'}
                      </button>
                      <button onClick={() => deleteCategory(cat.id)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* Items list */}
              {selectedCat && (
                <>
                  {selectedCatItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: t.text3 }}>
                      <div style={{ width: 64, height: 64, borderRadius: 18, background: t.fill, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', opacity: 0.6 }}>
                        <svg width="30" height="30" fill="none" stroke={t.text3} strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2, marginBottom: 6 }}>Категория пуста</div>
                      <div style={{ fontSize: 13, marginBottom: 20 }}>Добавьте первую позицию</div>
                    </div>
                  ) : (
                    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                      {selectedCatItems.map((item, i) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < selectedCatItems.length - 1 ? `0.5px solid ${t.sep2}` : 'none', opacity: item.is_visible ? 1 : 0.5 }}>
                          {item.image_url && <img src={item.image_url} alt={item.name} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                          {!item.image_url && <div style={{ width: 48, height: 48, borderRadius: 10, background: t.fill, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="20" height="20" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                          </div>}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 15, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                              {item.price && <span style={{ fontSize: 13, fontWeight: 600, color: t.purple }}>{item.price}{currency}</span>}
                              {!item.is_available && <span style={{ fontSize: 11, color: t.orange, background: `${t.orange}18`, padding: '2px 7px', borderRadius: 6 }}>Нет в наличии</span>}
                              {!item.is_visible && <span style={{ fontSize: 11, color: t.text3, background: t.fill, padding: '2px 7px', borderRadius: 6 }}>Скрыто</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => toggleItemVisibility(item)} style={{ width: 32, height: 32, borderRadius: 10, background: item.is_visible ? `${t.green}18` : t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="14" fill="none" stroke={item.is_visible ? t.green : t.text3} strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                            </button>
                            <button onClick={() => openEditItem(item)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.blue}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="14" fill="none" stroke={t.blue} strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button onClick={() => deleteItem(item.id)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="14" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button onClick={openAddItem} style={{ width: '100%', padding: '16px', borderRadius: 16, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.purple}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 18 18"><path d="M9 1v16M1 9h16" /></svg>
                    Добавить позицию
                  </button>
                </>
              )}

              {categories.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 8 }}>Меню пустое</div>
                  <div style={{ fontSize: 14, color: t.text3, marginBottom: 24 }}>Начните с создания первой категории</div>
                  <button onClick={() => setShowAddCat(true)} style={{ padding: '14px 32px', borderRadius: 14, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Создать категорию</button>
                </div>
              )}
            </div>
          )}

          {/* ══ SETTINGS ══ */}
          {tab === 'settings' && (
            <div>
              {/* Publish */}
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16, color: t.text }}>Опубликовать меню</div>
                    <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>Гости смогут открыть меню по ссылке</div>
                  </div>
                  <Toggle value={settings.is_published} onChange={v => setSettings(s => ({ ...s, is_published: v }))} color={t.green} />
                </div>
              </div>

              {/* Cover */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Обложка</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ height: 120, borderRadius: 12, background: t.fill, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {settings.cover_url
                    ? <img src={settings.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <svg width="32" height="32" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => coverFileRef.current?.click()} disabled={photoUploading} style={{ background: t.fill, border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: t.purple, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {photoUploading ? 'Загрузка…' : settings.cover_url ? 'Заменить обложку' : 'Загрузить обложку'}
                  </button>
                  {settings.cover_url && <button onClick={() => setSettings(s => ({ ...s, cover_url: null }))} style={{ background: 'none', border: 'none', color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Убрать</button>}
                  <input ref={coverFileRef} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadPhoto(file, url => setSettings(s => ({ ...s, cover_url: url }))) }} style={{ display: 'none' }} />
                </div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 8 }}>Не забудьте «Сохранить настройки» ниже</div>
              </div>

              {/* Slug */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Адрес меню</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ fontSize: 13, color: t.text3, marginBottom: 8 }}>{appHost}/menu/</div>
                <input value={settings.slug} onChange={e => { setSettings(s => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })); setSlugError('') }} placeholder="название-заведения" style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${slugError ? t.red : t.sep2}`, fontSize: 16, color: t.text, background: t.fill2, fontFamily: 'inherit', outline: 'none' }} />
                {slugError && <div style={{ fontSize: 12, color: t.red, marginTop: 6 }}>{slugError}</div>}
                {settings.slug && !slugError && <div style={{ fontSize: 12, color: t.green, marginTop: 6 }}>{appHost}/menu/{settings.slug}</div>}
              </div>

              {/* Theme */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Тема</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {THEMES.map((th, i) => (
                  <div key={th.id} onClick={() => setSettings(s => ({ ...s, theme: th.id as any }))} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < THEMES.length - 1 ? `0.5px solid ${t.sep2}` : 'none', cursor: 'pointer' }}>
                    <span style={{ fontSize: 16, color: t.text }}>{th.label}</span>
                    {settings.theme === th.id && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill={t.purple} /><path d="m6 10 2.5 2.5L14 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>}
                  </div>
                ))}
              </div>

              {/* Layout */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Раскладка</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {([
                  { id: 'list', label: 'Список', icon: <><rect x="3" y="5" width="18" height="4" rx="1.5" /><rect x="3" y="13" width="18" height="4" rx="1.5" /></> },
                  { id: 'grid', label: 'Сетка', icon: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></> },
                ] as const).map(opt => {
                  const on = settings.layout === opt.id
                  return (
                    <button key={opt.id} onClick={() => setSettings(s => ({ ...s, layout: opt.id }))} style={{ flex: 1, background: t.surface, borderRadius: 16, padding: '18px 12px', boxShadow: t.sh, border: `2px solid ${on ? t.purple : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'border .18s' }}>
                      <svg width="26" height="26" fill={on ? t.purple : t.text3} viewBox="0 0 24 24">{opt.icon}</svg>
                      <span style={{ fontSize: 14, fontWeight: 600, color: on ? t.purple : t.text }}>{opt.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Accent color */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Акцентный цвет</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {ACCENT_PRESETS.map(color => (
                    <button key={color} onClick={() => setSettings(s => ({ ...s, accent_color: color }))} style={{ width: 36, height: 36, borderRadius: '50%', background: color, border: settings.accent_color === color ? `3px solid ${t.text}` : '3px solid transparent', cursor: 'pointer', transition: 'border .18s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {settings.accent_color === color && <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 14 14"><path d="m2 7 3.5 3.5L12 3" /></svg>}
                    </button>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={settings.accent_color} onChange={e => setSettings(s => ({ ...s, accent_color: e.target.value }))} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 }} />
                    <span style={{ fontSize: 13, color: t.text3 }}>Свой цвет</span>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Отображение</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {[
                  { key: 'show_photos', label: 'Фотографии блюд', desc: 'Показывать изображения позиций' },
                  { key: 'show_calories', label: 'Калорийность', desc: 'Показывать КБЖУ если указано' },
                  { key: 'show_allergens', label: 'Аллергены', desc: 'Показывать состав и аллергены' },
                  { key: 'allow_orders', label: 'Заказ за столом', desc: 'Гость может собрать корзину и отправить заказ' },
                  { key: 'allow_pay_at_table', label: 'Оплата за столом', desc: 'Доступно при включённом заказе за столом', needsOrders: true },
                ].map((opt: any, i, arr) => {
                  const disabled = opt.needsOrders && !settings.allow_orders
                  return (
                    <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none', opacity: disabled ? 0.45 : 1 }}>
                      <div>
                        <div style={{ fontSize: 16, color: t.text, fontWeight: 500 }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{opt.desc}</div>
                      </div>
                      <Toggle value={(settings as any)[opt.key]} onChange={v => {
                        if (disabled) return
                        // Выключили заказы — оплата за столом теряет смысл, гасим вместе.
                        setSettings(s => ({ ...s, [opt.key]: v, ...(opt.key === 'allow_orders' && !v ? { allow_pay_at_table: false } : {}) }))
                      }} color={t.purple} />
                    </div>
                  )
                })}
              </div>

              <button onClick={saveSettings} disabled={saving} style={{ width: '100%', padding: '16px', borderRadius: 16, background: saving ? t.fill : t.purple, color: saving ? t.text3 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: saving ? 'none' : `0 4px 16px ${t.purple}44` }}>
                {saving ? 'Сохранение...' : 'Сохранить настройки'}
              </button>
            </div>
          )}

          {/* ══ PREVIEW ══ */}
          {tab === 'preview' && (
            <div>
              <div style={{ background: t.surface, borderRadius: 20, overflow: 'hidden', boxShadow: t.sh }}>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  {settings.slug ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 8 }}>Ваше меню готово</div>
                      <div style={{ fontSize: 14, color: t.text3, marginBottom: 20 }}>Поделитесь ссылкой или распечатайте QR-код</div>
                      <div style={{ background: t.fill, borderRadius: 14, padding: '14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, fontSize: 14, color: t.text2, wordBreak: 'break-all' }}>{appHost}/menu/{settings.slug}</div>
                        <button onClick={() => { navigator.clipboard.writeText(`${appOrigin}/menu/${settings.slug}`); showToast('Скопировано') }} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 10, background: `${t.purple}18`, border: 'none', color: t.purple, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Копировать</button>
                      </div>
                      {!settings.is_published && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, fontWeight: 500 }}>Меню не опубликовано — перейдите в Настройки и включите публикацию</div>}
                      {settings.is_published && (
                        <a href={`/menu/${settings.slug}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '14px', borderRadius: 14, background: t.purple, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 15, boxShadow: `0 4px 16px ${t.purple}44` }}>
                          Открыть меню
                        </a>
                      )}
                    </>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 8 }}>Задайте адрес меню</div>
                      <div style={{ fontSize: 13, color: t.text3 }}>Перейдите в Настройки и укажите адрес</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id as any)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? t.purple : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500, transition: 'color .18s' }}>
            <span style={{ transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s ease', display: 'flex' }}>{tb.icon(tab === tb.id)}</span>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ADD CATEGORY MODAL */}
      {showAddCat && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowAddCat(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, padding: '0 16px 32px', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 16px' }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 16 }}>Новая категория</div>
            <input value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} placeholder="Название категории" autoFocus style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }} />
            <button onClick={addCategory} disabled={!newCatName.trim()} style={{ width: '100%', padding: '16px', borderRadius: 14, background: newCatName.trim() ? t.purple : t.fill, color: newCatName.trim() ? '#fff' : t.text3, border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
              Создать
            </button>
          </div>
        </div>
      )}

      {/* ADD/EDIT ITEM MODAL */}
      {showAddItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowAddItem(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: t.text }}>{editItem ? 'Редактировать' : 'Новая позиция'}</div>
            <div style={{ padding: '16px 16px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Photo upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 2 }}>
                <div style={{ width: 72, height: 72, borderRadius: 14, background: t.fill, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {itemForm.image_url
                    ? <img src={itemForm.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <svg width="26" height="26" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => itemFileRef.current?.click()} disabled={photoUploading} style={{ background: t.fill, border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: t.purple, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {photoUploading ? 'Загрузка…' : itemForm.image_url ? 'Заменить' : 'Загрузить фото'}
                  </button>
                  {itemForm.image_url && <button onClick={() => setItemForm(f => ({ ...f, image_url: '' }))} style={{ background: 'none', border: 'none', color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Убрать</button>}
                  <input ref={itemFileRef} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadPhoto(file, url => setItemForm(f => ({ ...f, image_url: url }))) }} style={{ display: 'none' }} />
                </div>
              </div>
              {[
                { key: 'name', placeholder: 'Название *', required: true },
                { key: 'description', placeholder: 'Описание' },
                { key: 'price', placeholder: `Цена (${currency})`, type: 'number' },
                { key: 'calories', placeholder: 'Калорийность (ккал)', type: 'number' },
                { key: 'allergens', placeholder: 'Аллергены (через запятую)' },
              ].map(field => (
                <input key={field.key} value={(itemForm as any)[field.key]} onChange={e => setItemForm(f => ({ ...f, [field.key]: e.target.value }))} placeholder={field.placeholder} type={field.type || 'text'} style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
              ))}

              {/* Модификаторы: размер / добавки */}
              <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: mods.length ? 10 : 0 }}>Модификаторы</div>
                {mods.map((g, gi) => (
                  <div key={gi} style={{ background: t.fill2, borderRadius: 12, padding: 10, marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input value={g.name} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, name: e.target.value } : x))} placeholder="Группа (Размер, Добавки...)"
                        style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', fontWeight: 600 }} />
                      <button onClick={() => setMods(ms => ms.filter((_, i) => i !== gi))} style={{ width: 36, borderRadius: 10, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' }}>−</button>
                    </div>
                    {g.options.map((o, oi) => (
                      <div key={oi} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <input value={o.name} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, name: e.target.value } : y) } : x))} placeholder="Опция (S, M, сыр...)"
                          style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                        <input type="number" value={o.price} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, price: e.target.value } : y) } : x))} placeholder="+0"
                          style={{ width: 76, textAlign: 'right', padding: '8px 10px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                        <button onClick={() => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x))} style={{ width: 32, borderRadius: 10, border: 'none', background: t.fill, color: t.text3, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>−</button>
                      </div>
                    ))}
                    <button onClick={() => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: [...x.options, { name: '', price: '' }] } : x))} style={{ background: 'none', border: 'none', color: t.purple, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>+ Опция</button>
                  </div>
                ))}
                <button onClick={() => setMods(ms => [...ms, { name: '', options: [{ name: '', price: '' }] }])} style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginTop: mods.length ? 0 : 8 }}>
                  + Группа модификаторов
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, background: t.surface, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, color: t.text }}>Показывать</span>
                  <Toggle value={itemForm.is_visible} onChange={v => setItemForm(f => ({ ...f, is_visible: v }))} color={t.purple} />
                </div>
                <div style={{ flex: 1, background: t.surface, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, color: t.text }}>В наличии</span>
                  <Toggle value={itemForm.is_available} onChange={v => setItemForm(f => ({ ...f, is_available: v }))} color={t.green} />
                </div>
              </div>

              <button onClick={saveItem} disabled={saving || !itemForm.name.trim()} style={{ width: '100%', padding: '16px', borderRadius: 16, background: saving || !itemForm.name.trim() ? t.fill : t.purple, color: saving || !itemForm.name.trim() ? t.text3 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 4, boxShadow: !saving && itemForm.name.trim() ? `0 4px 16px ${t.purple}44` : 'none' }}>
                {saving ? 'Сохранение...' : editItem ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap', animation: 'toastIn .25s ease', border: `1px solid ${t.dark ? 'rgba(255,255,255,0.1)' : 'transparent'}` }}>
          {toast}
        </div>
      )}
    </div>
  )
}
