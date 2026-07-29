'use client'
// Настройки: заведение, логотип, категории расходов, кальяны, аналитика, гео, тема.
// Перенесено из SettingsTab (+подкарточки) старого dashboard/page.tsx.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useI18n, SUPPORTED_LOCALES } from '@/lib/i18n'
import { Card, Btn, Field, Spinner, SectionTitle, Toggle, inputStyle, Container } from '@/components/ui'
import { useDash } from '@/components/dash/context'

const XIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>
)

// ── CATEGORIES ────────────────────────────────────────────────────────────────
function CategoriesCard({ restaurantId }: { restaurantId: string }) {
  const { t: tr } = useI18n()
  const [cats, setCats] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('expense_categories').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name')
    // Закреплённые — первыми (как в Аналитике), внутри групп по алфавиту.
    const rows = (data || []).sort((a: any, b: any) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
    setCats(rows); setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    // Реактивируем ранее удалённую категорию с тем же названием вместо дубля с новым id
    // (сохраняет is_pinned, старые расходы уже используют это имя текстом).
    const { data: existing } = await db.from('expense_categories').select('*').eq('restaurant_id', restaurantId).ilike('name', name).limit(1)
    const match = existing?.[0]
    if (match) {
      if (!match.is_active) await db.from('expense_categories').update({ is_active: true }).eq('id', match.id)
    } else {
      await db.from('expense_categories').insert({ restaurant_id: restaurantId, name })
    }
    setNewName(''); load()
  }

  const togglePin = async (cat: any) => {
    const { error } = await db.from('expense_categories').update({ is_pinned: !cat.is_pinned }).eq('id', cat.id)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    load()
  }

  const remove = async (id: string) => {
    // Soft-delete (Б6-follow-up): строка остаётся, старые расходы (текстом category_name)
    // не задеты; повторное добавление того же названия реактивирует эту же запись.
    const { error } = await db.from('expense_categories').update({ is_active: false }).eq('id', id)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    load()
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.expenseCats')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 14px' }}>{tr('dash.expenseCatsSub')}</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={tr('dash.catPh')} className="ui-input"
          style={{ ...inputStyle, flex: 1, width: 'auto' }} />
        <Btn onClick={add}>{tr('dash.add')}</Btn>
      </div>
      {loading ? <Spinner />
        : cats.length === 0
          ? <div style={{ color: 'var(--tx2)', fontSize: '.85rem' }}>{tr('dash.noCats')}</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cats.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: cat.is_pinned ? 'var(--accent-soft)' : 'var(--fill)', border: cat.is_pinned ? '1px solid var(--accent)' : '1px solid transparent', borderRadius: 980, padding: '6px 12px' }}>
                  <button onClick={() => togglePin(cat)} title={cat.is_pinned ? tr('dash.unpinCat') : tr('dash.pinCat')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, display: 'flex', color: cat.is_pinned ? 'var(--accent)' : 'var(--tx3)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={cat.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7z" /><line x1="12" y1="16" x2="12" y2="21" />
                    </svg>
                  </button>
                  <span style={{ fontSize: '.85rem', fontWeight: 500, color: 'var(--tx)' }}>{cat.name}</span>
                  <button onClick={() => remove(cat.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', padding: 0, lineHeight: 0, display: 'flex' }}><XIcon /></button>
                </div>
              ))}
            </div>
      }
    </Card>
  )
}

// ── HOOKAH TYPES ──────────────────────────────────────────────────────────────
// Виды кальянов: у каждого своё имя, цена, граммовка и допустимые бренды
// (пусто = любые). Кальянщик в Stash отмечает продажи по этим видам.
function HookahSettingsCard() {
  const { t: tr } = useI18n()
  const [types, setTypes] = useState<any[]>([])
  const [edit, setEdit] = useState<{ id?: string; name: string; price: string; portion: string; brands: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [cats, setCats] = useState<string[]>([])
  const [newCat, setNewCat] = useState('')

  const load = () => {
    db.from('hookah_types').select('*').eq('is_active', true).order('created_at').then(({ data }: any) => setTypes(data || []))
    db.from('restaurant_settings').select('free_hookah_categories').then(({ data }: any) => setCats(data?.[0]?.free_hookah_categories || []))
  }
  useEffect(() => { load() }, [])

  // Категории бесплатных кальянов — кальянщик выбирает из них в Stash.
  const saveCats = async (next: string[]) => {
    setCats(next)
    const res = await db.from('restaurant_settings').update({ free_hookah_categories: next })
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); load() }
  }
  const addCat = () => {
    const v = newCat.trim()
    if (!v || cats.includes(v)) { setNewCat(''); return }
    saveCats([...cats, v]); setNewCat('')
  }

  const save = async () => {
    if (!edit || !edit.name.trim()) { alert(tr('dash.enterTitle')); return }
    if (saving) return
    setSaving(true)
    const name = edit.name.trim()
    const payload = {
      name,
      price: parseFloat(edit.price) || 0,
      portion_g: parseFloat(edit.portion) || 20,
      brands: edit.brands.split(',').map(b => b.trim()).filter(Boolean),
    }
    let res
    if (edit.id) {
      res = await db.from('hookah_types').update(payload).eq('id', edit.id)
    } else {
      // Реактивируем ранее удалённый тип с тем же названием вместо дубля с новым id
      // (старые продажи уже привязаны к его id и переживут это как обычно).
      const { data: existing } = await db.from('hookah_types').select('id').ilike('name', name).limit(1)
      const match = existing?.[0]
      res = match
        ? await db.from('hookah_types').update({ ...payload, is_active: true }).eq('id', match.id)
        : await db.from('hookah_types').insert(payload)
    }
    setSaving(false)
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); return }
    setEdit(null); await load()
  }
  const remove = async (id: string) => {
    if (!confirm(tr('dash.removeHookahType'))) return
    await db.from('hookah_types').update({ is_active: false }).eq('id', id)
    await load()
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.hookahTypes')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 14px' }}>{tr('dash.hookahTypesSub')}</div>

      {types.map(tp => (
        <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--fill)', borderRadius: 12, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '.86rem', color: 'var(--tx)' }}>{tp.name} · €{tp.price} · {tp.portion_g} г</div>
            <div style={{ fontSize: '.72rem', color: 'var(--tx2)', marginTop: 1 }}>{tp.brands?.length ? tp.brands.join(', ') : tr('dash.anyBrands')}</div>
          </div>
          <button onClick={() => setEdit({ id: tp.id, name: tp.name, price: String(tp.price), portion: String(tp.portion_g), brands: (tp.brands || []).join(', ') })} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('dash.edit')}</button>
          <button onClick={() => remove(tp.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('dash.remove')}</button>
        </div>
      ))}

      {edit ? (
        <div style={{ background: 'var(--fill2)', borderRadius: 12, padding: 12, marginTop: 8 }}>
          <Field label={tr('dash.title')} value={edit.name} onChange={(v: string) => setEdit({ ...edit, name: v })} placeholder={tr('dash.hookahNamePh')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={tr('dash.price')} value={edit.price} onChange={(v: string) => setEdit({ ...edit, price: v })} type="number" placeholder="15" />
            <Field label={tr('dash.portionG')} value={edit.portion} onChange={(v: string) => setEdit({ ...edit, portion: v })} type="number" placeholder="20" />
          </div>
          <Field label={tr('dash.brandsField')} value={edit.brands} onChange={(v: string) => setEdit({ ...edit, brands: v })} placeholder="Darkside, Element" />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : tr('dash.saveType')}</Btn>
            <Btn variant="gray" onClick={() => setEdit(null)}>{tr('dash.cancel')}</Btn>
          </div>
        </div>
      ) : (
        <Btn variant="ghost" onClick={() => setEdit({ name: '', price: '', portion: '20', brands: '' })}>{tr('dash.addHookahType')}</Btn>
      )}

      {/* Категории бесплатных кальянов */}
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)', marginTop: 20 }}>{tr('dash.freeCats')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 12px' }}>{tr('dash.freeCatsSub')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {cats.map(c => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--fill)', borderRadius: 999, fontSize: '.8rem', color: 'var(--tx)' }}>
            {c}
            <button onClick={() => saveCats(cats.filter(x => x !== c))} style={{ background: 'none', border: 'none', color: 'var(--danger)', lineHeight: 0, cursor: 'pointer', fontFamily: 'inherit', padding: 0, display: 'flex' }}><XIcon size={10} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat() }}
          placeholder={tr('dash.freeCatPh')} className="ui-input"
          style={{ ...inputStyle, flex: 1, width: 'auto', background: 'var(--fill)' }} />
        <Btn variant="gray" onClick={addCat}>{tr('dash.add')}</Btn>
      </div>
    </Card>
  )
}

// ── ANALYTICS SETTING ─────────────────────────────────────────────────────────
// Безнал в аналитике: менеджер не видит расходов по карте, поэтому включённый безнал
// раздувает итог. По умолчанию выкл — владелец видит реальные (наличные) показатели.
function AnalyticsSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [includeCard, setIncludeCard] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) { setRow(r); setIncludeCard(!!r.include_card_in_analytics) }
    })
  }, [])

  const toggle = async (v: boolean) => {
    setIncludeCard(v)
    if (row?.id) await db.from('restaurant_settings').update({ include_card_in_analytics: v }).eq('id', row.id)
    else { const { data } = await db.from('restaurant_settings').insert({ include_card_in_analytics: v }).select().single(); if (data) setRow(data) }
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.includeCard')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2, maxWidth: 380 }}>
            {tr('dash.includeCardSub')}
          </div>
        </div>
        <Toggle value={includeCard} onChange={toggle} tone="ok" label={tr('dash.includeCard')} />
      </div>
    </Card>
  )
}

// ── ДЕНЬ ВЫДАЧИ ЗП (ЗП-долг 2026-07-28) ────────────────────────────────────────
// День месяца, когда выдаётся ЗП за прошлый месяц (обычно 10-15 число следующего).
// Используется только для напоминания и группировки «срочно»/«накопление» в People→Зарплата —
// сам период начисления ЗП остаётся календарным месяцем (не меняется).
function SalaryPayoutSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [day, setDay] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) { setRow(r); setDay(r.salary_payout_day != null ? String(r.salary_payout_day) : '') }
    })
  }, [])

  const save = async () => {
    if (saving) return
    setSaving(true)
    const n = day ? Math.min(31, Math.max(1, parseInt(day) || 1)) : null
    const payload = { salary_payout_day: n }
    const res = row?.id
      ? await db.from('restaurant_settings').update(payload).eq('id', row.id)
      : await db.from('restaurant_settings').insert(payload).select().single()
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); setSaving(false); return }
    if (!row?.id && res.data) setRow(res.data)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.salaryPayoutDay')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2, marginBottom: 12, maxWidth: 420 }}>{tr('dash.salaryPayoutDaySub')}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ maxWidth: 140 }}>
          <Field label={tr('dash.salaryPayoutDayLabel')} value={day} onChange={(v: string) => setDay(v.replace(/[^0-9]/g, ''))} placeholder="10" />
        </div>
        <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : saved ? tr('dash.savedCheck') : tr('dash.save')}</Btn>
      </div>
    </Card>
  )
}

// ── GEO / ATTENDANCE (mise People) ────────────────────────────────────────────
function GeoSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [f, setF] = useState({ attendance_enabled: false, latitude: '', longitude: '', geo_radius_m: '150', reminder_mode: 'hours_before', reminder_hours: '12', reminder_time: '18:00', timezone: 'UTC' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) {
        setRow(r)
        setF({
          attendance_enabled: !!r.attendance_enabled,
          latitude: r.latitude != null ? String(r.latitude) : '',
          longitude: r.longitude != null ? String(r.longitude) : '',
          geo_radius_m: String(r.geo_radius_m ?? 150),
          reminder_mode: r.reminder_mode || 'hours_before',
          reminder_hours: String(r.reminder_hours ?? 12),
          reminder_time: (r.reminder_time || '18:00').slice(0, 5),
          // До миграции restaurant-timezone-2026-07.sql колонки нет — дефолт с устройства владельца.
          timezone: r.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        })
      }
    })
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => { setF(s => ({ ...s, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })); setLocating(false) },
      () => { alert(tr('dash.geoFailed')); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    const payload: any = {
      attendance_enabled: f.attendance_enabled,
      latitude: f.latitude ? Number(f.latitude) : null,
      longitude: f.longitude ? Number(f.longitude) : null,
      geo_radius_m: parseInt(f.geo_radius_m) || 150,
      reminder_mode: f.reminder_mode,
      reminder_hours: parseInt(f.reminder_hours) || 12,
      reminder_time: f.reminder_time || '18:00',
      timezone: f.timezone || 'UTC',
    }
    const res = row?.id
      ? await db.from('restaurant_settings').update(payload).eq('id', row.id)
      : await db.from('restaurant_settings').insert(payload).select().single()
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); setSaving(false); return }
    if (!row?.id && res.data) setRow(res.data)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 7 }}>
            {tr('dash.geoTitle')}
            <span style={{ fontSize: '.6rem', fontWeight: 800, letterSpacing: '.4px', color: 'var(--violet)', background: 'var(--violet-soft)', padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2 }}>{tr('dash.geoSub')}</div>
        </div>
        <Toggle value={f.attendance_enabled} onChange={v => setF({ ...f, attendance_enabled: v })} tone="violet" label={tr('dash.geoTitle')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
        <Field label={tr('dash.latitude')} value={f.latitude} onChange={(v: string) => setF({ ...f, latitude: v })} placeholder="41.3111" />
        <Field label={tr('dash.longitude')} value={f.longitude} onChange={(v: string) => setF({ ...f, longitude: v })} placeholder="69.2797" />
      </div>
      <button onClick={useMyLocation} className="ui-press" style={{ background: 'var(--fill)', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: 'var(--violet)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
        {locating ? tr('dash.locating') : tr('dash.useMyLocation')}
      </button>
      <Field label={tr('dash.radiusM')} value={f.geo_radius_m} onChange={(v: string) => setF({ ...f, geo_radius_m: v })} type="number" placeholder="150" />

      <div style={{ fontWeight: 600, fontSize: '.82rem', color: 'var(--tx)', margin: '8px 0 6px' }}>{tr('dash.shiftReminder')}</div>
      {/* Режимы «за N часов»/«в фиксированное время» скрыты: cron на текущем плане Vercel
          запускается раз в сутки и их не исполняет — UI не должен обещать лишнего (ревью A5).
          Поля reminder_mode/hours/time в БД сохранены — вернуть контролы после апгрейда на Pro. */}
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 12 }}>{tr('dash.reminderDailyNote')}</div>
      {/* Таймзона точки: cron считает «сегодня/завтра/HH:MM» в ней (напоминания, авто-прогулы, аудиты). */}
      <Field label={tr('dash.timezone')} value={f.timezone} onChange={(v: string) => setF({ ...f, timezone: v })} select
        options={(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']).map((z: string) => ({ value: z, label: z }))} />

      <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : saved ? tr('dash.savedCheck') : tr('dash.save')}</Btn>
    </Card>
  )
}

// ── GOOGLE REVIEWS (вкладка «Отзывы» в Bookings) ──────────────────────────────
// Владелец вписывает свой Place ID + Google Cloud API-ключ (Places API (New), без OAuth
// в бизнес-аккаунт). После сохранения сразу дёргаем /api/google-reviews/sync-now — рейтинг
// и последние отзывы появляются мгновенно, не дожидаясь ночного cron.
function GoogleReviewsSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [placeId, setPlaceId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) { setRow(r); setPlaceId(r.google_place_id || ''); setApiKey(r.google_places_api_key || '') }
    })
  }, [])

  const saveAndSync = async () => {
    if (saving) return
    setSaving(true); setResult(null)
    const payload = { google_place_id: placeId.trim() || null, google_places_api_key: apiKey.trim() || null }
    const res = row?.id
      ? await db.from('restaurant_settings').update(payload).eq('id', row.id)
      : await db.from('restaurant_settings').insert(payload).select().single()
    if (res.error) { setResult({ ok: false, msg: res.error.message }); setSaving(false); return }
    if (!row?.id && res.data) setRow(res.data)

    try {
      const r = await fetch('/api/google-reviews/sync-now', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) setResult({ ok: false, msg: data.error || tr('dash.googleReviewsSyncError') })
      else setResult({ ok: true, msg: tr('dash.googleReviewsSynced').replace('{rating}', String(data.rating ?? '—')).replace('{count}', String(data.ratingsTotal ?? '—')) })
    } catch {
      setResult({ ok: false, msg: tr('dash.googleReviewsSyncError') })
    }
    setSaving(false)
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.googleReviewsTitle')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2, marginBottom: 14, maxWidth: 420 }}>{tr('dash.googleReviewsSub')}</div>

      <Field label={tr('dash.placeId')} value={placeId} onChange={setPlaceId} placeholder="ChIJ..." helper={tr('dash.placeIdHelper')} />
      <Field label={tr('dash.googleApiKey')} value={apiKey} onChange={setApiKey} type="password" placeholder="AIza..." helper={tr('dash.googleApiKeyHelper')} />

      <Btn onClick={saveAndSync} disabled={saving}>{saving ? tr('dash.saving') : tr('dash.saveAndSync')}</Btn>

      {result && (
        <div style={{ marginTop: 10, fontSize: '.8rem', fontWeight: 600, color: result.ok ? 'var(--ok)' : 'var(--danger)' }}>
          {result.msg}
        </div>
      )}
    </Card>
  )
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { t: tr, locale, setLocale } = useI18n()
  const { restaurant, theme, reload } = useDash()
  const [name, setName] = useState(restaurant?.name || '')
  const [currency, setCurrency] = useState(restaurant?.currency || '€')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState(restaurant?.logo_url || '')
  const [logoUploading, setLogoUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (restaurant) { setName(restaurant.name); setCurrency(restaurant.currency || '€'); setLogoPreview(restaurant.logo_url || '') }
  }, [restaurant])

  const pickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const uploadLogo = async () => {
    if (!logoFile || !restaurant) return
    setLogoUploading(true)
    const ext = logoFile.name.split('.').pop()
    const path = `logos/${restaurant.id}.${ext}`
    const { error } = await supabase.storage.from('restaurant-assets').upload(path, logoFile, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      await db.from('restaurants').update({ logo_url: publicUrl }).eq('id', restaurant.id)
      reload()
    }
    setLogoUploading(false)
  }

  const save = async () => {
    if (!restaurant || saving) return
    setSaving(true)
    const { error } = await db.from('restaurants').update({ name, currency }).eq('id', restaurant.id)
    if (error) { alert(tr('dash.notSaved') + error.message); setSaving(false); return }
    if (logoFile) await uploadLogo()
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); reload()
  }

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.navSettings')} sub={tr('dash.settingsSub')} />

      {/* Логотип */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: 'var(--tx)' }}>{tr('dash.venueLogo')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'var(--hairline-strong)', flexShrink: 0 }}>
            {logoPreview ? (
              <img src={logoPreview} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="30" height="30" fill="none" stroke="var(--tx3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 9l1.2-5h15.6L21 9" /><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9" /><path d="M3 9h18" /><path d="M9 21v-6h6v6" /></svg>
            )}
          </div>
          <div>
            <div style={{ fontSize: '.85rem', color: 'var(--tx)', fontWeight: 500, marginBottom: 6 }}>
              {logoPreview ? tr('dash.logoUploaded') : tr('dash.logoNotUploaded')}
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 10 }}>
              <span dangerouslySetInnerHTML={{ __html: tr('dash.logoNote') }} />
            </div>
            <button onClick={() => fileRef.current?.click()} className="ui-press" style={{ background: 'var(--fill)', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
              {logoUploading ? tr('dash.saving') : logoPreview ? tr('dash.replace') : tr('dash.uploadPhoto')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: 'var(--tx)' }}>{tr('dash.venue')}</div>
        <Field label={tr('dash.name')} value={name} onChange={setName} placeholder={tr('dash.restaurantNamePh')} />
        <Field
          label={tr('dash.currency')}
          value={currency}
          onChange={setCurrency}
          select
          options={[
            { value: '€', label: tr('dash.curEur') },
            { value: '₸', label: tr('dash.curKzt') },
            { value: '₽', label: tr('dash.curRub') },
            { value: '$', label: tr('dash.curUsd') },
          ]}
        />
        <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : saved ? tr('dash.savedCheck') : tr('dash.save')}</Btn>
      </Card>

      {restaurant && <CategoriesCard restaurantId={restaurant.id} />}

      <HookahSettingsCard />

      <AnalyticsSettingsCard />

      <SalaryPayoutSettingsCard />

      <GeoSettingsCard />

      <GoogleReviewsSettingsCard />

      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.theme')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2 }}>{tr('dash.themeSub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: 'var(--fill)', padding: 4, borderRadius: 12 }}>
          {([['system', tr('dash.system')], ['light', tr('dash.light')], ['dark', tr('dash.dark')]] as const).map(([m, label]) => {
            const on = theme.mode === m
            return (
              <button key={m} type="button" onClick={() => theme.setMode(m)} className="ui-press" style={{
                flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '.82rem', fontWeight: on ? 700 : 500,
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--tx2)',
                boxShadow: on ? '0 1px 4px rgba(0,0,0,.12)' : 'none',
              }}>{label}</button>
            )
          })}
        </div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.language')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2 }}>{tr('dash.languageSub')}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SUPPORTED_LOCALES.map(l => {
            const on = locale === l.code
            return (
              <button key={l.code} type="button" onClick={() => setLocale(l.code)} className="ui-press" style={{
                padding: '8px 14px', borderRadius: 980, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '.82rem', fontWeight: on ? 700 : 500,
                background: on ? 'var(--accent)' : 'var(--fill)',
                color: on ? '#fff' : 'var(--tx2)',
              }}>{l.native}</button>
            )
          })}
        </div>
      </Card>
    </Container>
  )
}
