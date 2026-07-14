'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'
import { useI18n } from '@/lib/i18n'
import { entitlements, isActiveStatus } from '@/lib/plans'
import {
  MENU_LOCALES, LOCALE_LABEL, MENU_TAGS, MENU_FONTS, THEME_PRESETS,
  WEEKDAY_KEYS, fontStack, googleFontsHref, type I18nContent, type Schedule,
} from '@/lib/menu'

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface MenuRow {
  id?: string
  restaurant_id: string
  name: string
  slug: string
  is_published: boolean
  is_default: boolean
  position: number
  theme: 'light' | 'dark' | 'auto'
  layout: 'list' | 'grid'
  accent_color: string
  font_heading: string | null
  font_body: string | null
  theme_preset: string | null
  radius: number | null
  cover_url: string | null
  show_photos: boolean
  show_calories: boolean
  show_allergens: boolean
  allow_orders: boolean
  allow_pay_at_table: boolean
  allow_tips: boolean
  upsell_category_id: string | null
  language: string
}

interface Category {
  id: string
  menu_id: string | null
  name: string
  description: string | null
  i18n: I18nContent | null
  position: number
  is_visible: boolean
}

interface ModGroup { name: string; options: { name: string; price: number }[] }

interface MenuItem {
  id: string
  menu_id: string | null
  category_id: string
  name: string
  description: string | null
  i18n: I18nContent | null
  price: number | null
  image_url: string | null
  is_visible: boolean
  is_available: boolean
  calories: number | null
  allergens: string[] | null
  modifiers: ModGroup[] | null
  tags: string[] | null
  schedule: Schedule | null
  type: string
  combo_items: { item_id: string; qty: number }[] | null
  recommended_ids: string[] | null
  position: number
}

const ACCENT_PRESETS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#00c7be', '#ff6b35', '#ff2d55']
const THEMES = [{ id: 'light', label: 'me.themeLight' }, { id: 'dark', label: 'me.themeDark' }, { id: 'auto', label: 'me.themeAuto' }]

function blankMenu(rid: string): MenuRow {
  return {
    restaurant_id: rid, name: 'Menu', slug: '', is_published: false, is_default: true, position: 0,
    theme: 'light', layout: 'list', accent_color: '#007aff', font_heading: 'system', font_body: 'system',
    theme_preset: 'minimal', radius: 18, cover_url: null,
    show_photos: true, show_calories: false, show_allergens: false,
    allow_orders: false, allow_pay_at_table: false, allow_tips: false, upsell_category_id: null, language: 'ru',
  }
}

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

function Toggle({ value, onChange, color }: { value: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 51, height: 31, borderRadius: 16, background: value ? color : 'rgba(120,120,128,0.32)', cursor: 'pointer', transition: 'background .25s', position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', transition: 'left .25s' }} />
    </div>
  )
}

const SECTION_LABEL = (t: any): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' })

// Drag-and-drop wrapper. `children` receives the drag-handle listeners so the caller can
// attach them to the whole element (chips) or a dedicated handle (rows).
function Sortable({ id, style: extra, children }: { id: string; style?: React.CSSProperties; children: (listeners: any, dragging: boolean) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, ...(isDragging ? { zIndex: 10, position: 'relative' } : {}), ...extra }
  return <div ref={setNodeRef} style={style} {...attributes}>{children(listeners, isDragging)}</div>
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function MenuEditor() {
  const router = useRouter()
  // Страница живёт внутри дашборд-shell (route group (shell)) — тема дашборда, хром в потоке.
  const t = useTheme('mise_dash_dark')
  const { t: tr } = useI18n()
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const appHost = typeof window !== 'undefined' ? window.location.host : ''
  const [restaurantId, setRestaurantId] = useState('')
  const [tab, setTab] = useState<'categories' | 'settings' | 'preview' | 'analytics'>('categories')

  const [menus, setMenus] = useState<MenuRow[]>([])
  const [activeMenuId, setActiveMenuId] = useState<string>('')   // '' = unsaved draft (new restaurant)
  const [settings, setSettings] = useState<MenuRow>(blankMenu(''))
  const [showMenuActions, setShowMenuActions] = useState(false)

  const [currency, setCurrency] = useState('€')
  const [restLogo, setRestLogo] = useState<string | null>(null)
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
  const [mods, setMods] = useState<{ name: string; options: { name: string; price: string }[] }[]>([])
  const [itemTags, setItemTags] = useState<string[]>([])
  const [itemType, setItemType] = useState<'dish' | 'combo'>('dish')
  const [comboItems, setComboItems] = useState<{ item_id: string; qty: number }[]>([])
  const [recommended, setRecommended] = useState<string[]>([])
  const [schedOn, setSchedOn] = useState(false)
  const [sched, setSched] = useState<Schedule>({ days: [], from: '', to: '' })
  const [i18nName, setI18nName] = useState<Record<string, string>>({})
  const [i18nDesc, setI18nDesc] = useState<Record<string, string>>({})
  const [showTrans, setShowTrans] = useState(false)
  const [translating, setTranslating] = useState(false)

  const [photoUploading, setPhotoUploading] = useState(false)
  const itemFileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const qrCanvasRef = useRef<HTMLDivElement>(null)
  const qrSvgRef = useRef<HTMLDivElement>(null)
  const [qrTable, setQrTable] = useState('')

  // Analytics
  const [anPeriod, setAnPeriod] = useState<7 | 30>(7)
  const [anLoading, setAnLoading] = useState(false)
  const [anEvents, setAnEvents] = useState<{ type: string; item_id: string | null }[]>([])
  const [anOrders, setAnOrders] = useState<{ total: number; items: any }[]>([])

  // Load Google Fonts so the editor previews render the chosen typography.
  useEffect(() => {
    const href = googleFontsHref(settings.font_heading, settings.font_body)
    if (!href) return
    const id = 'menu-editor-fonts'
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link) }
    link.href = href
  }, [settings.font_heading, settings.font_body])

  const uploadPhoto = async (file: File, onDone: (url: string) => void) => {
    if (!file || !restaurantId) return
    setPhotoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `menu/${restaurantId}/${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('restaurant-assets').upload(path, file, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      onDone(publicUrl)
    } else { showToast(tr('me.photoErr')) }
    setPhotoUploading(false)
  }

  useEffect(() => { init() }, [])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/auth/login'); return }
    const { data: rest } = await db.from('restaurants').select('*').eq('owner_id', user.id).single()
    if (!rest?.id) { setLoading(false); return }
    // Гейт через entitlements(): учитывает addon_modules/comp_apps (биллинг v2), не только план.
    if (!isActiveStatus(rest.subscription_status) || !entitlements(rest).modules.includes('menu')) {
      router.replace('/dashboard/billing'); return
    }
    const rid = rest.id
    setRestaurantId(rid)
    if (rest.currency) setCurrency(rest.currency)
    setRestLogo((rest as any).logo_url || null)

    const { data: menusData } = await db.from('menus').select('*').eq('restaurant_id', rid).order('position')
    if (menusData && menusData.length > 0) {
      const sorted = [...menusData].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || a.position - b.position)
      setMenus(sorted)
      const active = sorted[0]
      setActiveMenuId(active.id)
      setSettings({ ...blankMenu(rid), ...active })
      await loadMenuContent(rid, active.id)
    } else {
      // Fresh restaurant — start with an unsaved default menu.
      setMenus([])
      setActiveMenuId('')
      setSettings(blankMenu(rid))
    }
    setLoading(false)
  }

  const loadMenuContent = async (rid: string, menuId: string) => {
    const [cRes, iRes] = await Promise.all([
      db.from('menu_categories').select('*').eq('restaurant_id', rid).eq('menu_id', menuId).order('position'),
      db.from('menu_items').select('*').eq('restaurant_id', rid).eq('menu_id', menuId).order('position'),
    ])
    setCategories(cRes.data || [])
    setItems(iRes.data || [])
    setSelectedCat(cRes.data && cRes.data.length > 0 ? cRes.data[0].id : null)
  }

  const switchMenu = async (menuId: string) => {
    const m = menus.find(x => x.id === menuId)
    if (!m) return
    setActiveMenuId(menuId)
    setSettings({ ...blankMenu(restaurantId), ...m })
    setTab('categories')
    await loadMenuContent(restaurantId, menuId)
  }

  // ── Menu CRUD ──
  const saveSettings = async () => {
    setSaving(true); setSlugError('')
    const payload: any = { ...settings, restaurant_id: restaurantId, updated_at: new Date().toISOString() }
    if (settings.id) {
      const { error } = await db.from('menus').update(payload).eq('id', settings.id)
      if (error) { setSlugError(error.code === '23505' ? tr('me.slugTaken') : error.message); setSaving(false); return }
      setMenus(ms => ms.map(m => m.id === settings.id ? { ...m, ...settings } : m))
    } else {
      delete payload.id
      const res = await db.from('menus').insert(payload).select().single()
      if (res.error) { setSlugError(res.error.code === '23505' ? tr('me.slugTaken') : res.error.message); setSaving(false); return }
      if (res.data) { setSettings(res.data); setActiveMenuId(res.data.id); setMenus(ms => [...ms, res.data]) }
    }
    setSaving(false); showToast(tr('me.settingsSaved'))
  }

  const addMenu = async () => {
    const pos = menus.length
    const payload = { ...blankMenu(restaurantId), name: `${tr('me.menus')} ${pos + 1}`, is_default: menus.length === 0, position: pos, slug: '' as any }
    const { data, error } = await db.from('menus').insert({ ...payload, slug: null }).select().single()
    if (error || !data) { showToast(error?.message || 'Error'); return }
    setMenus(ms => [...ms, data])
    setActiveMenuId(data.id)
    setSettings({ ...blankMenu(restaurantId), ...data })
    setCategories([]); setItems([]); setSelectedCat(null)
    setTab('settings')
  }

  const renameMenu = async () => {
    const name = prompt(tr('me.menuName'), settings.name)
    if (name == null || !name.trim()) return
    setSettings(s => ({ ...s, name: name.trim() }))
    if (settings.id) { await db.from('menus').update({ name: name.trim() }).eq('id', settings.id); setMenus(ms => ms.map(m => m.id === settings.id ? { ...m, name: name.trim() } : m)) }
  }

  const setDefaultMenu = async () => {
    if (!settings.id) return
    // Clear other defaults locally; the partial unique index enforces one default in DB.
    for (const m of menus) if (m.is_default && m.id !== settings.id) await db.from('menus').update({ is_default: false }).eq('id', m.id)
    await db.from('menus').update({ is_default: true }).eq('id', settings.id)
    setMenus(ms => ms.map(m => ({ ...m, is_default: m.id === settings.id })))
    setSettings(s => ({ ...s, is_default: true }))
    setShowMenuActions(false); showToast(tr('me.settingsSaved'))
  }

  const duplicateMenu = async () => {
    if (!settings.id) return
    setSaving(true)
    const { id, slug, is_default, ...rest } = settings
    const dup = { ...rest, restaurant_id: restaurantId, name: settings.name + ' copy', slug: null, is_default: false, position: menus.length }
    const { data: newMenu, error } = await db.from('menus').insert(dup).select().single()
    if (error || !newMenu) { setSaving(false); showToast(error?.message || 'Error'); return }
    // Clone categories + items, remapping ids.
    const catMap: Record<string, string> = {}
    for (const c of categories) {
      const { id: _cid, ...crest } = c
      const { data: nc } = await db.from('menu_categories').insert({ ...crest, restaurant_id: restaurantId, menu_id: newMenu.id }).select().single()
      if (nc) catMap[c.id] = nc.id
    }
    for (const it of items) {
      const { id: _iid, ...irest } = it
      await db.from('menu_items').insert({ ...irest, restaurant_id: restaurantId, menu_id: newMenu.id, category_id: catMap[it.category_id] || null })
    }
    setMenus(ms => [...ms, newMenu]); setSaving(false); setShowMenuActions(false); showToast(tr('me.settingsSaved'))
  }

  const deleteMenu = async () => {
    if (!settings.id) return
    if (!confirm(tr('me.delMenuConfirm'))) return
    await db.from('menu_items').delete().eq('menu_id', settings.id)
    await db.from('menu_categories').delete().eq('menu_id', settings.id)
    await db.from('menus').delete().eq('id', settings.id)
    const rest = menus.filter(m => m.id !== settings.id)
    setMenus(rest); setShowMenuActions(false)
    if (rest.length > 0) await switchMenu(rest[0].id!)
    else { setActiveMenuId(''); setSettings(blankMenu(restaurantId)); setCategories([]); setItems([]) }
  }

  // ── Category CRUD ──
  const addCategory = async () => {
    if (!newCatName.trim() || !activeMenuId) { setShowAddCat(false); return }
    const pos = categories.length
    const { data } = await db.from('menu_categories').insert({ restaurant_id: restaurantId, menu_id: activeMenuId, name: newCatName.trim(), position: pos, is_visible: true }).select().single()
    if (data) { setCategories(c => [...c, data]); setSelectedCat(data.id) }
    setNewCatName(''); setShowAddCat(false)
  }

  const toggleCatVisibility = async (catId: string) => {
    const cat = categories.find(c => c.id === catId); if (!cat) return
    await db.from('menu_categories').update({ is_visible: !cat.is_visible }).eq('id', catId)
    setCategories(cs => cs.map(c => c.id === catId ? { ...c, is_visible: !c.is_visible } : c))
  }

  const deleteCategory = async (catId: string) => {
    if (!confirm(tr('me.delCatConfirm'))) return
    await db.from('menu_items').delete().eq('category_id', catId)
    await db.from('menu_categories').delete().eq('id', catId)
    setCategories(cs => cs.filter(c => c.id !== catId))
    setItems(is => is.filter(i => i.category_id !== catId))
    setSelectedCat(categories.find(c => c.id !== catId)?.id || null)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onCatDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ord = [...categories].sort((a, b) => a.position - b.position).map(c => c.id)
    const ni = arrayMove(ord, ord.indexOf(active.id as string), ord.indexOf(over.id as string))
    setCategories(cs => cs.map(c => ({ ...c, position: ni.indexOf(c.id) })))
    await Promise.all(ni.map((id, idx) => db.from('menu_categories').update({ position: idx }).eq('id', id)))
  }

  const onItemDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ord = items.filter(i => i.category_id === selectedCat).sort((a, b) => a.position - b.position).map(i => i.id)
    const ni = arrayMove(ord, ord.indexOf(active.id as string), ord.indexOf(over.id as string))
    setItems(is => is.map(i => i.category_id === selectedCat ? { ...i, position: ni.indexOf(i.id) } : i))
    await Promise.all(ni.map((id, idx) => db.from('menu_items').update({ position: idx }).eq('id', id)))
  }

  // ── Item CRUD ──
  const openAddItem = () => {
    setEditItem(null)
    setItemForm({ name: '', description: '', price: '', image_url: '', calories: '', allergens: '', is_available: true, is_visible: true })
    setMods([]); setItemTags([]); setItemType('dish'); setComboItems([]); setRecommended([])
    setSchedOn(false); setSched({ days: [], from: '', to: '' }); setI18nName({}); setI18nDesc({}); setShowTrans(false)
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
    setItemTags(item.tags || [])
    setItemType(item.type === 'combo' ? 'combo' : 'dish')
    setComboItems(item.combo_items || [])
    setRecommended(item.recommended_ids || [])
    setSchedOn(!!item.schedule)
    setSched(item.schedule || { days: [], from: '', to: '' })
    setI18nName(item.i18n?.name || {}); setI18nDesc(item.i18n?.description || {})
    setShowTrans(false)
    setShowAddItem(true)
  }

  const autoTranslate = async () => {
    if (!itemForm.name.trim()) return
    setTranslating(true)
    try {
      const [n, d] = await Promise.all([
        fetch('/api/menu/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: itemForm.name.trim() }) }).then(r => r.json()),
        itemForm.description.trim()
          ? fetch('/api/menu/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: itemForm.description.trim() }) }).then(r => r.json())
          : Promise.resolve({ result: {} }),
      ])
      if (n.result) setI18nName(v => ({ ...v, ...n.result }))
      if (d.result) setI18nDesc(v => ({ ...v, ...d.result }))
      setShowTrans(true)
      showToast(tr('me.translated'))
    } catch { showToast(tr('me.translateErr')) }
    setTranslating(false)
  }

  const buildI18n = (): I18nContent | null => {
    const name: Record<string, string> = {}; const description: Record<string, string> = {}
    for (const l of MENU_LOCALES) { if (i18nName[l]?.trim()) name[l] = i18nName[l].trim(); if (i18nDesc[l]?.trim()) description[l] = i18nDesc[l].trim() }
    const out: I18nContent = {}
    if (Object.keys(name).length) out.name = name
    if (Object.keys(description).length) out.description = description
    return Object.keys(out).length ? out : null
  }

  const saveItem = async () => {
    if (!itemForm.name.trim() || !selectedCat) return
    setSaving(true)
    const payload: any = {
      restaurant_id: restaurantId, menu_id: activeMenuId, category_id: selectedCat,
      name: itemForm.name.trim(),
      description: itemForm.description.trim() || null,
      i18n: buildI18n(),
      price: parseFloat(itemForm.price) || null,
      image_url: itemForm.image_url.trim() || null,
      calories: parseInt(itemForm.calories) || null,
      allergens: itemForm.allergens ? itemForm.allergens.split(',').map(a => a.trim()).filter(Boolean) : null,
      tags: itemTags.length ? itemTags : null,
      type: itemType,
      combo_items: itemType === 'combo' && comboItems.length ? comboItems : null,
      recommended_ids: recommended.length ? recommended : null,
      schedule: schedOn && (sched.from || sched.to || (sched.days && sched.days.length)) ? sched : null,
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
    setSaving(false); setShowAddItem(false)
    showToast(editItem ? tr('me.itemUpdated') : tr('me.itemAdded'))
  }

  const deleteItem = async (itemId: string) => {
    await db.from('menu_items').delete().eq('id', itemId)
    setItems(is => is.filter(i => i.id !== itemId)); showToast(tr('me.deleted'))
  }
  const toggleItemVisibility = async (item: MenuItem) => {
    await db.from('menu_items').update({ is_visible: !item.is_visible }).eq('id', item.id)
    setItems(is => is.map(i => i.id === item.id ? { ...i, is_visible: !i.is_visible } : i))
  }

  // ── Presets ──
  const applyPreset = (id: string) => {
    const p = THEME_PRESETS.find(x => x.id === id); if (!p) return
    setSettings(s => ({ ...s, theme_preset: id, accent_color: p.accent_color, theme: p.theme, layout: p.layout, font_heading: p.font_heading, font_body: p.font_body, radius: p.radius }))
  }

  // ── Analytics ──
  const loadAnalytics = async () => {
    if (!restaurantId) return
    setAnLoading(true)
    const since = new Date(Date.now() - anPeriod * 86400000).toISOString()
    const [evRes, ordRes] = await Promise.all([
      db.from('menu_events').select('type, item_id').eq('restaurant_id', restaurantId).gte('created_at', since).limit(5000),
      db.from('menu_orders').select('total, items').eq('restaurant_id', restaurantId).gte('created_at', since).limit(2000),
    ])
    setAnEvents(evRes.data || [])
    setAnOrders((ordRes.data || []).filter((o: any) => !(Array.isArray(o.items) && o.items[0]?.call))) // exclude waiter calls
    setAnLoading(false)
  }
  useEffect(() => { if (tab === 'analytics') loadAnalytics() }, [tab, anPeriod, restaurantId])

  const selectedCatItems = items.filter(i => i.category_id === selectedCat).sort((a, b) => a.position - b.position)
  const sortedCats = [...categories].sort((a, b) => a.position - b.position)
  const radius = settings.radius ?? 18
  const menuUrl = settings.slug ? `${appOrigin}/menu/${settings.slug}` : ''
  const qrValue = menuUrl ? (qrTable ? `${menuUrl}?table=${encodeURIComponent(qrTable)}` : menuUrl) : ''

  const downloadQrPng = () => {
    const canvas = qrCanvasRef.current?.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `qr-${settings.slug || 'menu'}${qrTable ? '-' + qrTable : ''}.png`; a.click()
  }
  const downloadQrSvg = () => {
    const svg = qrSvgRef.current?.querySelector('svg'); if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `qr-${settings.slug || 'menu'}.svg`; a.click()
  }

  if (loading) return (
    <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <IconMenu color={t.purple} size={64} />
      <div style={{ width: 24, height: 24, border: `2.5px solid ${t.fill}`, borderTopColor: t.purple, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const TABS = [
    { id: 'categories', label: tr('me.tabMenu'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg> },
    { id: 'settings', label: tr('me.tabSettings'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg> },
    { id: 'preview', label: tr('me.tabPreview'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg> },
    { id: 'analytics', label: tr('me.tabAnalytics'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></svg> },
  ] as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        * { box-sizing: border-box }
        input,textarea{-webkit-appearance:none}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
      `}</style>

      {/* HEADER: строка статуса в потоке (shell даёт сайдбар/шапку) */}
      <div style={{ order: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, maxWidth: 1100, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMenu color={t.purple} size={28} />
          <span style={{ fontWeight: 700, fontSize: 17, color: t.text, letterSpacing: -0.3 }}>Mise Menu</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: settings.is_published ? `${t.green}22` : t.fill, color: settings.is_published ? t.green : t.text3 }}>
            {settings.is_published ? tr('me.published') : tr('me.draft')}
          </div>
          {settings.slug && (
            <a href={`/menu/${settings.slug}`} target="_blank" rel="noopener noreferrer" style={{ width: 34, height: 34, borderRadius: '50%', background: `${t.purple}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <svg width="16" height="16" fill="none" stroke={t.purple} strokeWidth="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            </a>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ order: 2 }}>
        <div style={{ padding: '0 0 28px', maxWidth: 1100, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {/* MENU SWITCHER */}
          {tab !== 'analytics' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', alignItems: 'center', paddingBottom: 2, scrollbarWidth: 'none' }}>
              {menus.map(m => (
                <button key={m.id} onClick={() => switchMenu(m.id!)} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 12, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: activeMenuId === m.id ? 700 : 500, cursor: 'pointer', background: activeMenuId === m.id ? t.purple : t.fill, color: activeMenuId === m.id ? '#fff' : t.text2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.name}{m.is_default && <span style={{ fontSize: 9, opacity: 0.8 }}>★</span>}
                </button>
              ))}
              {(activeMenuId || menus.length === 0) && (
                <button onClick={() => setShowMenuActions(true)} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, border: 'none', background: t.fill, color: t.text2, cursor: 'pointer', display: settings.id ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                </button>
              )}
              <button onClick={addMenu} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: t.text3, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
                {tr('me.newMenu')}
              </button>
            </div>
          )}

          {/* ══ CATEGORIES & ITEMS ══ */}
          {tab === 'categories' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onCatDragEnd}>
                  <SortableContext items={sortedCats.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                    {sortedCats.map(cat => (
                      <Sortable key={cat.id} id={cat.id} style={{ flexShrink: 0 }}>
                        {(listeners) => (
                          <button {...listeners} onClick={() => setSelectedCat(cat.id)} style={{ touchAction: 'none', padding: '8px 16px', borderRadius: 20, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: selectedCat === cat.id ? 700 : 500, cursor: 'grab', background: selectedCat === cat.id ? t.purple : t.fill, color: selectedCat === cat.id ? '#fff' : t.text2, opacity: cat.is_visible ? 1 : 0.5 }}>
                            {cat.name}
                          </button>
                        )}
                      </Sortable>
                    ))}
                  </SortableContext>
                </DndContext>
                <button onClick={() => setShowAddCat(true)} disabled={!activeMenuId} style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 20, border: `1.5px dashed ${t.sep}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: activeMenuId ? 'pointer' : 'not-allowed', background: 'transparent', color: t.text3, display: 'flex', alignItems: 'center', gap: 6, opacity: activeMenuId ? 1 : 0.5 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
                  {tr('me.category')}
                </button>
              </div>

              {selectedCat && (() => {
                const cat = categories.find(c => c.id === selectedCat); if (!cat) return null
                return (
                  <div style={{ background: t.surface, borderRadius: 16, padding: '12px 16px', marginBottom: 16, boxShadow: t.sh, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: t.text }}>{cat.name}</div>
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{tr('me.itemsCount', { n: selectedCatItems.length })}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => toggleCatVisibility(cat.id)} style={{ padding: '6px 12px', borderRadius: 10, background: cat.is_visible ? `${t.green}18` : t.fill, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: cat.is_visible ? t.green : t.text3, fontFamily: 'inherit' }}>{cat.is_visible ? tr('me.visible') : tr('me.hidden')}</button>
                      <button onClick={() => deleteCategory(cat.id)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })()}

              {selectedCat && (
                <>
                  {selectedCatItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: t.text3 }}>
                      <div style={{ width: 64, height: 64, borderRadius: 18, background: t.fill, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', opacity: 0.6 }}>
                        <svg width="30" height="30" fill="none" stroke={t.text3} strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2, marginBottom: 6 }}>{tr('me.catEmpty')}</div>
                      <div style={{ fontSize: 13, marginBottom: 20 }}>{tr('me.catEmptySub')}</div>
                    </div>
                  ) : (
                    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
                        <SortableContext items={selectedCatItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                          {selectedCatItems.map((item, i) => (
                            <Sortable key={item.id} id={item.id} style={{ background: t.surface, borderBottom: i < selectedCatItems.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                              {(listeners) => (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', opacity: item.is_visible ? 1 : 0.5 }}>
                                  <span {...listeners} style={{ touchAction: 'none', cursor: 'grab', color: t.text3, display: 'flex', alignItems: 'center', flexShrink: 0 }}><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg></span>
                                  {item.image_url ? <img src={item.image_url} alt={item.name} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 48, height: 48, borderRadius: 10, background: t.fill, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="20" height="20" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg></div>}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 15, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}{item.type === 'combo' && <span style={{ fontSize: 10, fontWeight: 700, color: t.purple, background: `${t.purple}18`, padding: '1px 6px', borderRadius: 6, marginLeft: 6 }}>SET</span>}</div>
                                    <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                                      {item.price != null && <span style={{ fontSize: 13, fontWeight: 600, color: t.purple }}>{item.price}{currency}</span>}
                                      {(item.tags || []).slice(0, 3).map(tg => { const d = MENU_TAGS.find(x => x.id === tg); return d ? <span key={tg} style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block' }} /> : null })}
                                      {!item.is_available && <span style={{ fontSize: 11, color: t.orange, background: `${t.orange}18`, padding: '2px 7px', borderRadius: 6 }}>{tr('me.outOfStock')}</span>}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => toggleItemVisibility(item)} style={{ width: 32, height: 32, borderRadius: 10, background: item.is_visible ? `${t.green}18` : t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" fill="none" stroke={item.is_visible ? t.green : t.text3} strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></button>
                                    <button onClick={() => openEditItem(item)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.blue}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" fill="none" stroke={t.blue} strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                                    <button onClick={() => deleteItem(item.id)} style={{ width: 32, height: 32, borderRadius: 10, background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg></button>
                                  </div>
                                </div>
                              )}
                            </Sortable>
                          ))}
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}
                  <button onClick={openAddItem} style={{ width: '100%', padding: '16px', borderRadius: 16, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.purple}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 18 18"><path d="M9 1v16M1 9h16" /></svg>
                    {tr('me.addItem')}
                  </button>
                </>
              )}

              {categories.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 8 }}>{tr('me.menuEmpty')}</div>
                  <div style={{ fontSize: 14, color: t.text3, marginBottom: 24 }}>{activeMenuId ? tr('me.menuEmptySub') : tr('me.setAddrSub')}</div>
                  {activeMenuId
                    ? <button onClick={() => setShowAddCat(true)} style={{ padding: '14px 32px', borderRadius: 14, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{tr('me.createCat')}</button>
                    : <button onClick={() => setTab('settings')} style={{ padding: '14px 32px', borderRadius: 14, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{tr('me.tabSettings')}</button>}
                </div>
              )}
            </div>
          )}

          {/* ══ SETTINGS ══ */}
          {tab === 'settings' && (
            <div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16, color: t.text }}>{tr('me.publish')}</div>
                    <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{tr('me.publishSub')}</div>
                  </div>
                  <Toggle value={settings.is_published} onChange={v => setSettings(s => ({ ...s, is_published: v }))} color={t.green} />
                </div>
              </div>

              {/* Cover */}
              <div style={SECTION_LABEL(t)}>{tr('me.cover')}</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ height: 120, borderRadius: 12, background: t.fill, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {settings.cover_url ? <img src={settings.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <svg width="32" height="32" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => coverFileRef.current?.click()} disabled={photoUploading} style={{ background: t.fill, border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: t.purple, cursor: 'pointer', fontFamily: 'inherit' }}>{photoUploading ? tr('me.uploading') : settings.cover_url ? tr('me.replaceCover') : tr('me.uploadCover')}</button>
                  {settings.cover_url && <button onClick={() => setSettings(s => ({ ...s, cover_url: null }))} style={{ background: 'none', border: 'none', color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('me.remove')}</button>}
                  <input ref={coverFileRef} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadPhoto(file, url => setSettings(s => ({ ...s, cover_url: url }))) }} style={{ display: 'none' }} />
                </div>
              </div>

              {/* Slug */}
              <div style={SECTION_LABEL(t)}>{tr('me.addr')}</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ fontSize: 13, color: t.text3, marginBottom: 8 }}>{appHost}/menu/</div>
                <input value={settings.slug || ''} onChange={e => { setSettings(s => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })); setSlugError('') }} placeholder={tr("me.slugPh")} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${slugError ? t.red : t.sep2}`, fontSize: 16, color: t.text, background: t.fill2, fontFamily: 'inherit', outline: 'none' }} />
                {slugError && <div style={{ fontSize: 12, color: t.red, marginTop: 6 }}>{slugError}</div>}
                {settings.slug && !slugError && <div style={{ fontSize: 12, color: t.green, marginTop: 6 }}>{appHost}/menu/{settings.slug}</div>}
              </div>

              {/* Presets */}
              <div style={SECTION_LABEL(t)}>{tr('me.presets')}</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {THEME_PRESETS.map(p => {
                  const on = settings.theme_preset === p.id
                  return (
                    <button key={p.id} onClick={() => applyPreset(p.id)} style={{ flexShrink: 0, padding: '12px 14px', borderRadius: 14, background: t.surface, boxShadow: t.sh, border: `2px solid ${on ? p.accent_color : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 96 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: p.accent_color }} />
                        <span style={{ fontFamily: fontStack(p.font_heading), fontWeight: 700, fontSize: 16, color: t.text }}>Aa</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: on ? p.accent_color : t.text }}>{tr(p.labelKey)}</span>
                    </button>
                  )
                })}
              </div>

              {/* Typography */}
              <div style={SECTION_LABEL(t)}>{tr('me.typography')}</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                {([['font_heading', 'me.fontHeading'], ['font_body', 'me.fontBody']] as const).map(([key, lab]) => (
                  <div key={key} style={{ marginBottom: key === 'font_heading' ? 12 : 0 }}>
                    <div style={{ fontSize: 13, color: t.text2, marginBottom: 8 }}>{tr(lab)}</div>
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
                      {MENU_FONTS.map(f => {
                        const on = (settings as any)[key] === f.id || (!(settings as any)[key] && f.id === 'system')
                        return <button key={f.id} onClick={() => setSettings(s => ({ ...s, [key]: f.id, theme_preset: 'custom' }))} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 10, border: `1.5px solid ${on ? t.purple : t.sep2}`, background: on ? `${t.purple}12` : t.surface, color: t.text, cursor: 'pointer', fontFamily: f.stack, fontSize: 15, fontWeight: 600 }}>{f.name}</button>
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Theme */}
              <div style={SECTION_LABEL(t)}>{tr('me.theme')}</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {THEMES.map((th, i) => (
                  <div key={th.id} onClick={() => setSettings(s => ({ ...s, theme: th.id as any }))} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < THEMES.length - 1 ? `0.5px solid ${t.sep2}` : 'none', cursor: 'pointer' }}>
                    <span style={{ fontSize: 16, color: t.text }}>{tr(th.label)}</span>
                    {settings.theme === th.id && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill={t.purple} /><path d="m6 10 2.5 2.5L14 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>}
                  </div>
                ))}
              </div>

              {/* Layout */}
              <div style={SECTION_LABEL(t)}>{tr('me.layout')}</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {([
                  { id: 'list', label: tr('me.list'), icon: <><rect x="3" y="5" width="18" height="4" rx="1.5" /><rect x="3" y="13" width="18" height="4" rx="1.5" /></> },
                  { id: 'grid', label: tr('me.grid'), icon: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></> },
                ] as const).map(opt => {
                  const on = settings.layout === opt.id
                  return (
                    <button key={opt.id} onClick={() => setSettings(s => ({ ...s, layout: opt.id }))} style={{ flex: 1, background: t.surface, borderRadius: 16, padding: '18px 12px', boxShadow: t.sh, border: `2px solid ${on ? t.purple : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <svg width="26" height="26" fill={on ? t.purple : t.text3} viewBox="0 0 24 24">{opt.icon}</svg>
                      <span style={{ fontSize: 14, fontWeight: 600, color: on ? t.purple : t.text }}>{opt.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Accent */}
              <div style={SECTION_LABEL(t)}>{tr('me.accent')}</div>
              <div style={{ background: t.surface, borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {ACCENT_PRESETS.map(color => (
                    <button key={color} onClick={() => setSettings(s => ({ ...s, accent_color: color }))} style={{ width: 36, height: 36, borderRadius: '50%', background: color, border: settings.accent_color === color ? `3px solid ${t.text}` : '3px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {settings.accent_color === color && <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 14 14"><path d="m2 7 3.5 3.5L12 3" /></svg>}
                    </button>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={settings.accent_color} onChange={e => setSettings(s => ({ ...s, accent_color: e.target.value }))} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 }} />
                    <span style={{ fontSize: 13, color: t.text3 }}>{tr('me.customColor')}</span>
                  </div>
                </div>
                {/* Radius */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: t.text2, marginBottom: 6 }}><span>{tr('me.radius')}</span><span>{radius}px</span></div>
                  <input type="range" min={0} max={28} value={radius} onChange={e => setSettings(s => ({ ...s, radius: parseInt(e.target.value) }))} style={{ width: '100%', accentColor: settings.accent_color }} />
                </div>
              </div>

              {/* Display options */}
              <div style={SECTION_LABEL(t)}>{tr('me.display')}</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {[
                  { key: 'show_photos', label: tr('me.optPhotos'), desc: tr('me.optPhotosD') },
                  { key: 'show_calories', label: tr('me.optCalories'), desc: tr('me.optCaloriesD') },
                  { key: 'show_allergens', label: tr('me.optAllergens'), desc: tr('me.optAllergensD') },
                  { key: 'allow_orders', label: tr('me.optOrders'), desc: tr('me.optOrdersD') },
                  { key: 'allow_pay_at_table', label: tr('me.optPay'), desc: tr('me.optPayD'), needsOrders: true },
                  { key: 'allow_tips', label: tr('me.allowTips'), desc: tr('me.allowTipsD'), needsOrders: true },
                ].map((opt: any, i, arr) => {
                  const disabled = opt.needsOrders && !settings.allow_orders
                  return (
                    <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none', opacity: disabled ? 0.45 : 1 }}>
                      <div><div style={{ fontSize: 16, color: t.text, fontWeight: 500 }}>{opt.label}</div><div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{opt.desc}</div></div>
                      <Toggle value={(settings as any)[opt.key]} onChange={v => { if (disabled) return; setSettings(s => ({ ...s, [opt.key]: v, ...(opt.key === 'allow_orders' && !v ? { allow_pay_at_table: false, allow_tips: false } : {}) })) }} color={t.purple} />
                    </div>
                  )
                })}
              </div>

              {/* Upsell category */}
              {settings.allow_orders && categories.length > 0 && (
                <>
                  <div style={SECTION_LABEL(t)}>{tr('me.upsellCategory')}</div>
                  <div style={{ background: t.surface, borderRadius: 16, padding: '8px', marginBottom: 12, boxShadow: t.sh, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setSettings(s => ({ ...s, upsell_category_id: null }))} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: !settings.upsell_category_id ? t.purple : t.fill, color: !settings.upsell_category_id ? '#fff' : t.text2 }}>{tr('me.none')}</button>
                    {sortedCats.map(c => <button key={c.id} onClick={() => setSettings(s => ({ ...s, upsell_category_id: c.id }))} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: settings.upsell_category_id === c.id ? t.purple : t.fill, color: settings.upsell_category_id === c.id ? '#fff' : t.text2 }}>{c.name}</button>)}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, padding: '0 4px 8px' }}>{tr('me.upsellCategoryD')}</div>
                </>
              )}

              <button onClick={saveSettings} disabled={saving} style={{ width: '100%', padding: '16px', borderRadius: 16, background: saving ? t.fill : t.purple, color: saving ? t.text3 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: saving ? 'none' : `0 4px 16px ${t.purple}44` }}>{saving ? tr('me.saving') : tr('me.saveSettings')}</button>
            </div>
          )}

          {/* ══ PREVIEW (QR) ══ */}
          {tab === 'preview' && (
            <div>
              {settings.slug ? (
                <>
                  <div style={{ background: t.surface, borderRadius: 20, overflow: 'hidden', boxShadow: t.sh, padding: 20, textAlign: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 16 }}>{tr('me.qrCode')}</div>
                    <div ref={qrSvgRef} style={{ display: 'inline-block', background: '#fff', padding: 14, borderRadius: 18 }}>
                      {qrValue && <QRCodeSVG value={qrValue} size={200} level="H" fgColor={settings.accent_color} bgColor="#ffffff" marginSize={1} imageSettings={restLogo ? { src: restLogo, height: 44, width: 44, excavate: true } : undefined} />}
                    </div>
                    <div ref={qrCanvasRef} style={{ position: 'absolute', left: -9999, top: -9999 }}>{qrValue && <QRCodeCanvas value={qrValue} size={640} level="H" fgColor={settings.accent_color} bgColor="#ffffff" marginSize={2} imageSettings={restLogo ? { src: restLogo, height: 140, width: 140, excavate: true } : undefined} />}</div>
                    <div style={{ fontSize: 13, color: t.text3, marginTop: 12, wordBreak: 'break-all' }}>{appHost}/menu/{settings.slug}{qrTable ? `?table=${qrTable}` : ''}</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
                      <button onClick={downloadQrPng} style={{ padding: '10px 18px', borderRadius: 12, background: t.purple, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr('me.downloadPng')}</button>
                      <button onClick={downloadQrSvg} style={{ padding: '10px 18px', borderRadius: 12, background: t.fill, color: t.text, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr('me.downloadSvg')}</button>
                      <button onClick={() => { navigator.clipboard.writeText(menuUrl); showToast(tr('me.copied')) }} style={{ padding: '10px 18px', borderRadius: 12, background: t.fill, color: t.text, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr('me.copy')}</button>
                    </div>
                  </div>
                  <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh }}>
                    <div style={{ fontSize: 13, color: t.text2, marginBottom: 8 }}>{tr('me.tableQr')} · {tr('me.tableNumber')}</div>
                    <input value={qrTable} onChange={e => setQrTable(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 10))} placeholder="12" style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.fill2, fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                  {!settings.is_published && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, fontWeight: 500 }}>{tr('me.notPublished')}</div>}
                  {settings.is_published && <a href={`/menu/${settings.slug}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '14px', borderRadius: 14, background: t.purple, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 15, textAlign: 'center', boxShadow: `0 4px 16px ${t.purple}44` }}>{tr('me.openMenu')}</a>}
                </>
              ) : (
                <div style={{ background: t.surface, borderRadius: 20, padding: 20, textAlign: 'center', boxShadow: t.sh }}>
                  <div style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 8 }}>{tr('me.setAddr')}</div>
                  <div style={{ fontSize: 13, color: t.text3 }}>{tr('me.setAddrSub')}</div>
                </div>
              )}
            </div>
          )}

          {/* ══ ANALYTICS ══ */}
          {tab === 'analytics' && (() => {
            const views = anEvents.filter(e => e.type === 'view').length
            const itemViews = anEvents.filter(e => e.type === 'item_view')
            const orders = anOrders.length
            const revenue = anOrders.reduce((s, o) => s + (o.total || 0), 0)
            const conversion = views > 0 ? Math.round((orders / views) * 100) : 0
            const viewCounts: Record<string, number> = {}
            for (const e of itemViews) if (e.item_id) viewCounts[e.item_id] = (viewCounts[e.item_id] || 0) + 1
            const top = Object.entries(viewCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
            const itemName = (id: string) => items.find(i => i.id === id)?.name || '—'
            const Card = ({ label, value }: { label: string; value: string }) => (
              <div style={{ flex: 1, background: t.surface, borderRadius: 16, padding: '16px', boxShadow: t.sh }}>
                <div style={{ fontSize: 13, color: t.text3 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: t.text, marginTop: 4 }}>{value}</div>
              </div>
            )
            return (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {([7, 30] as const).map(p => <button key={p} onClick={() => setAnPeriod(p)} style={{ padding: '8px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: anPeriod === p ? 700 : 500, background: anPeriod === p ? t.purple : t.fill, color: anPeriod === p ? '#fff' : t.text2 }}>{tr(p === 7 ? 'me.an7d' : 'me.an30d')}</button>)}
                  {anLoading && <div style={{ width: 18, height: 18, border: `2px solid ${t.fill}`, borderTopColor: t.purple, borderRadius: '50%', animation: 'spin .7s linear infinite', alignSelf: 'center' }} />}
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}><Card label={tr('me.anViews')} value={String(views)} /><Card label={tr('me.anOrders')} value={String(orders)} /></div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}><Card label={tr('me.anRevenue')} value={`${revenue.toFixed(0)}${currency}`} /><Card label={tr('me.anConversion')} value={`${conversion}%`} /></div>
                <div style={SECTION_LABEL(t)}>{tr('me.anTopItems')}</div>
                <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                  {top.length === 0 ? <div style={{ padding: '32px 16px', textAlign: 'center', color: t.text3, fontSize: 14 }}>{tr('me.anNoData')}</div>
                    : top.map(([id, n], i) => (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < top.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ fontSize: 13, fontWeight: 700, color: t.text3, width: 18 }}>{i + 1}</span><span style={{ fontSize: 15, color: t.text }}>{itemName(id)}</span></div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: t.purple }}>{n}</span>
                      </div>
                    ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* NAV: сегмент-строка над контентом (внутри shell) */}
      <div style={{ order: 1, display: 'flex', gap: 2, background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, maxWidth: 1100, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === tb.id ? 700 : 500, cursor: 'pointer', background: tab === tb.id ? t.surface : 'transparent', color: tab === tb.id ? t.purple : t.text3, boxShadow: tab === tb.id ? t.sh2 : 'none', transition: 'all .18s' }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* MENU ACTIONS SHEET */}
      {showMenuActions && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowMenuActions(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, padding: '0 16px 32px', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 16px' }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 16 }}>{settings.name}</div>
            {[
              { label: tr('me.rename'), fn: renameMenu },
              { label: tr('me.duplicate'), fn: duplicateMenu },
              ...(settings.is_default ? [] : [{ label: tr('me.makeDefault'), fn: setDefaultMenu }]),
            ].map(a => <button key={a.label} onClick={() => { a.fn() }} style={{ width: '100%', padding: '15px 16px', borderRadius: 14, background: t.surface, color: t.text, border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 500, cursor: 'pointer', marginBottom: 8, textAlign: 'left' }}>{a.label}</button>)}
            {menus.length > 1 && <button onClick={deleteMenu} style={{ width: '100%', padding: '15px 16px', borderRadius: 14, background: `${t.red}14`, color: t.red, border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>{tr('me.deleteMenu')}</button>}
          </div>
        </div>
      )}

      {/* ADD CATEGORY MODAL */}
      {showAddCat && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowAddCat(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, padding: '0 16px 32px', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 16px' }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 16 }}>{tr('me.newCat')}</div>
            <input value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} placeholder={tr("me.catNamePh")} autoFocus style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }} />
            <button onClick={addCategory} disabled={!newCatName.trim()} style={{ width: '100%', padding: '16px', borderRadius: 14, background: newCatName.trim() ? t.purple : t.fill, color: newCatName.trim() ? '#fff' : t.text3, border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{tr('me.create')}</button>
          </div>
        </div>
      )}

      {/* ADD/EDIT ITEM MODAL */}
      {showAddItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowAddItem(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', animation: 'slideUp .3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontWeight: 700, fontSize: 18, textAlign: 'center', padding: '14px 20px 0', color: t.text }}>{editItem ? tr('me.edit') : tr('me.newItem')}</div>
            <div style={{ padding: '16px 16px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Type */}
              <div style={{ display: 'flex', gap: 8 }}>
                {([['dish', 'me.typeDish'], ['combo', 'me.typeCombo']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setItemType(v)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: `1.5px solid ${itemType === v ? t.purple : t.sep2}`, background: itemType === v ? `${t.purple}12` : t.surface, color: itemType === v ? t.purple : t.text2, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr(l)}</button>
                ))}
              </div>

              {/* Photo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 2 }}>
                <div style={{ width: 72, height: 72, borderRadius: 14, background: t.fill, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {itemForm.image_url ? <img src={itemForm.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <svg width="26" height="26" fill="none" stroke={t.text4} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => itemFileRef.current?.click()} disabled={photoUploading} style={{ background: t.fill, border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: t.purple, cursor: 'pointer', fontFamily: 'inherit' }}>{photoUploading ? tr('me.uploading') : itemForm.image_url ? tr('me.replace') : tr('me.uploadPhoto')}</button>
                  {itemForm.image_url && <button onClick={() => setItemForm(f => ({ ...f, image_url: '' }))} style={{ background: 'none', border: 'none', color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('me.remove')}</button>}
                  <input ref={itemFileRef} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadPhoto(file, url => setItemForm(f => ({ ...f, image_url: url }))) }} style={{ display: 'none' }} />
                </div>
              </div>

              {[
                { key: 'name', placeholder: tr('me.fName') },
                { key: 'description', placeholder: tr('me.fDesc') },
                { key: 'price', placeholder: tr('me.fPrice', { c: currency }), type: 'number' },
                { key: 'calories', placeholder: tr('me.fCalories'), type: 'number' },
                { key: 'allergens', placeholder: tr('me.fAllergens') },
              ].map(field => (
                <input key={field.key} value={(itemForm as any)[field.key]} onChange={e => setItemForm(f => ({ ...f, [field.key]: e.target.value }))} placeholder={field.placeholder} type={field.type || 'text'} style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
              ))}

              {/* Diet tags */}
              <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>{tr('me.tags')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {MENU_TAGS.map(tg => {
                    const on = itemTags.includes(tg.id)
                    return <button key={tg.id} onClick={() => setItemTags(s => on ? s.filter(x => x !== tg.id) : [...s, tg.id])} style={{ padding: '7px 12px', borderRadius: 999, border: `1.5px solid ${on ? tg.color : t.sep2}`, background: on ? tg.color : 'transparent', color: on ? '#fff' : t.text2, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tr(tg.labelKey)}</button>
                  })}
                </div>
              </div>

              {/* Combo items */}
              {itemType === 'combo' && (
                <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>{tr('me.comboItems')}</div>
                  {comboItems.map((ci, idx) => {
                    const it = items.find(x => x.id === ci.item_id)
                    return <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ flex: 1, fontSize: 14, color: t.text }}>{it?.name || '—'}</span>
                      <input type="number" value={ci.qty} onChange={e => setComboItems(s => s.map((x, i) => i === idx ? { ...x, qty: parseInt(e.target.value) || 1 } : x))} style={{ width: 56, textAlign: 'center', padding: '6px', borderRadius: 8, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit' }} />
                      <button onClick={() => setComboItems(s => s.filter((_, i) => i !== idx))} style={{ width: 30, borderRadius: 8, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer' }}>−</button>
                    </div>
                  })}
                  <select onChange={e => { if (e.target.value) { setComboItems(s => [...s, { item_id: e.target.value, qty: 1 }]); e.target.value = '' } }} style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${t.sep2}`, background: t.surface, color: t.text2, fontFamily: 'inherit', fontSize: 14, marginTop: 6 }}>
                    <option value="">{tr('me.addComboItem')}…</option>
                    {items.filter(x => x.id !== editItem?.id && x.type !== 'combo').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              )}

              {/* Modifiers */}
              <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: mods.length ? 10 : 0 }}>{tr('me.mods')}</div>
                {mods.map((g, gi) => (
                  <div key={gi} style={{ background: t.fill2, borderRadius: 12, padding: 10, marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input value={g.name} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, name: e.target.value } : x))} placeholder={tr("me.modGroup")} style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', fontWeight: 600 }} />
                      <button onClick={() => setMods(ms => ms.filter((_, i) => i !== gi))} style={{ width: 36, borderRadius: 10, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' }}>−</button>
                    </div>
                    {g.options.map((o, oi) => (
                      <div key={oi} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <input value={o.name} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, name: e.target.value } : y) } : x))} placeholder={tr("me.modOption")} style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                        <input type="number" value={o.price} onChange={e => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, price: e.target.value } : y) } : x))} placeholder="+0" style={{ width: 76, textAlign: 'right', padding: '8px 10px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                        <button onClick={() => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x))} style={{ width: 32, borderRadius: 10, border: 'none', background: t.fill, color: t.text3, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>−</button>
                      </div>
                    ))}
                    <button onClick={() => setMods(ms => ms.map((x, i) => i === gi ? { ...x, options: [...x.options, { name: '', price: '' }] } : x))} style={{ background: 'none', border: 'none', color: t.purple, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>{tr('me.addOption')}</button>
                  </div>
                ))}
                <button onClick={() => setMods(ms => [...ms, { name: '', options: [{ name: '', price: '' }] }])} style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginTop: mods.length ? 0 : 8 }}>{tr('me.addModGroup')}</button>
              </div>

              {/* Availability (dayparting) */}
              <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{tr('me.schedule')}</span>
                  <Toggle value={schedOn} onChange={setSchedOn} color={t.purple} />
                </div>
                {schedOn && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                      {WEEKDAY_KEYS.map((wk, di) => {
                        const day = di + 1; const on = (sched.days || []).includes(day)
                        return <button key={day} onClick={() => setSched(s => ({ ...s, days: on ? (s.days || []).filter(d => d !== day) : [...(s.days || []), day] }))} style={{ width: 40, padding: '8px 0', borderRadius: 10, border: 'none', background: on ? t.purple : t.fill, color: on ? '#fff' : t.text2, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tr(wk)}</button>
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: t.text2 }}>{tr('me.from')}</span>
                      <input type="time" value={sched.from || ''} onChange={e => setSched(s => ({ ...s, from: e.target.value }))} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit' }} />
                      <span style={{ fontSize: 13, color: t.text2 }}>{tr('me.to')}</span>
                      <input type="time" value={sched.to || ''} onChange={e => setSched(s => ({ ...s, to: e.target.value }))} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Translations */}
              <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button onClick={() => setShowTrans(v => !v)} style={{ background: 'none', border: 'none', color: t.text, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {tr('me.contentLang')}
                    <svg width="14" height="14" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24" style={{ transform: showTrans ? 'rotate(180deg)' : 'none' }}><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <button onClick={autoTranslate} disabled={translating || !itemForm.name.trim()} style={{ padding: '6px 12px', borderRadius: 10, background: `${t.purple}18`, color: t.purple, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: translating || !itemForm.name.trim() ? 0.5 : 1 }}>{translating ? tr('me.translating') : tr('me.autoTranslate')}</button>
                </div>
                {showTrans && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {MENU_LOCALES.filter(l => l !== settings.language).map(l => (
                      <div key={l}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, marginBottom: 6 }}>{LOCALE_LABEL[l]}</div>
                        <input value={i18nName[l] || ''} onChange={e => setI18nName(v => ({ ...v, [l]: e.target.value }))} placeholder={tr('me.fName')} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 6 }} />
                        <input value={i18nDesc[l] || ''} onChange={e => setI18nDesc(v => ({ ...v, [l]: e.target.value }))} placeholder={tr('me.fDesc')} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recommended (upsell) */}
              {items.filter(x => x.id !== editItem?.id).length > 0 && (
                <div style={{ background: t.surface, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>{tr('me.recommended')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {items.filter(x => x.id !== editItem?.id).map(x => {
                      const on = recommended.includes(x.id)
                      return <button key={x.id} onClick={() => setRecommended(s => on ? s.filter(v => v !== x.id) : [...s, x.id])} style={{ padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${on ? t.purple : t.sep2}`, background: on ? `${t.purple}12` : 'transparent', color: on ? t.purple : t.text2, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{x.name}</button>
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, background: t.surface, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, color: t.text }}>{tr('me.showItem')}</span>
                  <Toggle value={itemForm.is_visible} onChange={v => setItemForm(f => ({ ...f, is_visible: v }))} color={t.purple} />
                </div>
                <div style={{ flex: 1, background: t.surface, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, color: t.text }}>{tr('me.inStock')}</span>
                  <Toggle value={itemForm.is_available} onChange={v => setItemForm(f => ({ ...f, is_available: v }))} color={t.green} />
                </div>
              </div>

              <button onClick={saveItem} disabled={saving || !itemForm.name.trim()} style={{ width: '100%', padding: '16px', borderRadius: 16, background: saving || !itemForm.name.trim() ? t.fill : t.purple, color: saving || !itemForm.name.trim() ? t.text3 : '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 4, boxShadow: !saving && itemForm.name.trim() ? `0 4px 16px ${t.purple}44` : 'none' }}>{saving ? tr('me.saving') : editItem ? tr('me.save') : tr('me.add')}</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap', animation: 'toastIn .25s ease', border: `1px solid ${t.dark ? 'rgba(255,255,255,0.1)' : 'transparent'}` }}>{toast}</div>
      )}
    </div>
  )
}
