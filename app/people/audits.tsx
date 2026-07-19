'use client'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { btnB2, inp, lbl, clock, hoursOf, fmtHours, HistoryList } from './shared'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Чек-листы и аудиты: карточка, прогоны, отчёты, статистика
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// ── AUDITS (чек-листы смены + разовые проверки + статистика) ────────────────────
// Данные: shift_checklists (kind='shift' — открытие/закрытие; kind='audit' — разовый прогон,
// сам является и шаблоном, и инстансом) + shift_checklist_completions (прохождение).
// items/items_state читаются в СТАРОМ ([string]/[bool]) И НОВОМ ({label,photo_required}/{done,photo_url})
// форматах — обратная совместимость, миграция данных не требуется (см. normItem/normState).

// Цеха для чек-листов (role=null → общий, виден всем).
const CHECKLIST_ROLES: { val: string | null; label: string }[] = [
  { val: null, label: 'pe.clAll' },
  { val: 'kitchen', label: 'pe.roleKitchen' },
  { val: 'bar', label: 'pe.roleBar' },
  { val: 'hookah', label: 'pe.roleHookah' },
  { val: 'waiter', label: 'pe.clWaiter' },
  { val: 'host', label: 'pe.roleHost' },
  { val: 'cleaner', label: 'pe.roleCleaner' },
]

// Готовые шаблоны под общепит — добавляются кнопкой, не автоматически.
const PRESET_TEMPLATES: { type: 'open' | 'close'; role: string | null; items: string[] }[] = [
  { type: 'open', role: null, items: ['Свет и музыка включены', 'Столы и стулья расставлены', 'Меню в наличии на всех столах', 'Кассовая смена открыта'] },
  { type: 'close', role: null, items: ['Столы протёрты', 'Мусор вынесен', 'Касса закрыта и сверена', 'Свет и техника выключены'] },
  { type: 'open', role: 'bar', items: ['Барная стойка чистая', 'Лёд заготовлен', 'Остатки алкоголя сверены'] },
  { type: 'open', role: 'kitchen', items: ['Холодильники — температура в норме', 'Заготовки на месте', 'Чистота рабочих поверхностей'] },
  { type: 'close', role: 'kitchen', items: ['Продукты убраны в холод', 'Плита и духовка выключены', 'Поверхности продезинфицированы'] },
]

// Дни недели: индекс = JS Date.getUTCDay() (0=вс..6=сб) — так же считает cron
// (runScheduledAudits в app/api/cron/reminders/route.ts). Порядок отображения — Пн..Вс.
const WEEKDAY_LABELS = ['pe.wdSun', 'pe.wdMon', 'pe.wdTue', 'pe.wdWed', 'pe.wdThu', 'pe.wdFri', 'pe.wdSat']
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function recurrenceSummary(audit: any, tr: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!audit?.recurrence || audit.recurrence === 'none') return null
  if (audit.recurrence === 'daily') return tr('pe.recurrenceDaily')
  if (audit.recurrence === 'weekly') {
    const days: number[] = Array.isArray(audit.recurrence_weekdays) ? audit.recurrence_weekdays : []
    if (!days.length) return tr('pe.recurrenceWeekly')
    return days.slice().sort((a, b) => a - b).map(d => tr(WEEKDAY_LABELS[d])).join(', ')
  }
  if (audit.recurrence === 'monthly') return tr('pe.dayOfMonth', { n: audit.recurrence_day_of_month || 1 })
  return null
}

// weight — вес пункта в скоринге разовых аудитов (Б6, kind='audit'); по умолчанию 1
// (обратная совместимость: старые пункты и чек-листы смены без веса весят как обычно).
export function normItem(x: any, i: number): { id: string; label: string; photo_required: boolean; weight: number } {
  if (typeof x === 'string') return { id: String(i), label: x, photo_required: false, weight: 1 }
  const w = Number(x?.weight)
  return { id: x?.id ?? String(i), label: x?.label ?? '', photo_required: !!x?.photo_required, weight: Number.isFinite(w) && w > 0 ? w : 1 }
}
// Оценка пункта аудита (ревью Б1/Б2): result пишется только в grading-режиме (разовые
// аудиты), done остаётся для обратной совместимости (result != null ⇒ done = true —
// «пункт проверен», прогон завершается как раньше). note — комментарий проверяющего.
export type ItemState = { done: boolean; photo_url: string | null; result?: 'pass' | 'fail' | 'na' | null; note?: string | null }
// Старые записи без result: done трактуем как pass (бинарная модель), пусто — не проверен.
export function effResult(s: ItemState | undefined): 'pass' | 'fail' | 'na' | null {
  return s?.result ?? (s?.done ? 'pass' : null)
}
export function normState(x: any): ItemState {
  if (typeof x === 'boolean') return { done: x, photo_url: null }
  if (x == null) return { done: false, photo_url: null }
  // Спред первым: доп. поля (result/note — оценки аудита, ревью Б1) переживают мерж,
  // а не стираются при каждой отметке.
  return { ...x, done: !!x.done, photo_url: x.photo_url ?? null }
}

async function uploadAuditPhoto(restaurantId: string, folder: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `audits/${restaurantId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('restaurant-assets').upload(path, file, { upsert: true })
  if (error) return null
  const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
  return publicUrl
}

// Провал пункта → задача (staff_tasks). Дедуп на уже открытую задачу по тому же пункту за
// 7 дней — паттерн SafetyCulture Actions: не плодить дубли по одной и той же проблеме.
async function reportViolation(opts: {
  restaurantId: string; myId: string; label: string; completionId?: string; assignee: string
  staff: any[]; photoFile: File | null; toast: (m: string) => void; tr: (k: string, v?: Record<string, string | number>) => string
}) {
  const { restaurantId, myId, label, completionId, assignee, staff, photoFile, toast, tr } = opts
  if (!assignee) return
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: existing } = await db.from('staff_tasks').select('id,status,created_at')
    .eq('source_item_label', label).neq('status', 'done').gte('created_at', cutoff).limit(1)
  if (existing && existing.length > 0) {
    if (typeof window !== 'undefined' && !window.confirm(tr('pe.linkExistingTask'))) return
    toast(tr('pe.existingTaskNoted')); return
  }
  let photo_url: string | null = null
  if (photoFile) photo_url = await uploadAuditPhoto(restaurantId, 'violations', photoFile)
  let targets: string[]
  if (assignee.startsWith('role:')) targets = staff.filter((s: any) => s.role === assignee.slice(5)).map((s: any) => s.id)
  else targets = [assignee]
  if (targets.length === 0) { toast(tr('pe.noActiveStaffRole')); return }
  const base = {
    title: label, description: null, created_by: myId || null, priority: 'high', status: 'todo',
    // Corrective action со сроком (ревью Б5, паттерн SafetyCulture): по умолчанию — завтра.
    due_date: fmtDate(new Date(Date.now() + 86400000)),
    source_completion_id: completionId || null, source_item_label: label, photo_url,
  }
  await Promise.all(targets.map(tid => db.from('staff_tasks').insert({ ...base, assigned_to: tid })))
  const notifyIds = targets.filter(tid => tid !== myId)
  if (notifyIds.length) pushNotify({ type: 'task', title: 'Audit violation', body: label, titleKey: 'notify.violationTitle', bodyKey: 'notify.violationBody', bodyParams: { item: label }, audience: { staff_ids: notifyIds } })
  toast(tr('pe.violationTaskCreated'))
}

// Карточка пунктов — общая для «Смены» и разовых «Аудитов».
// grading (ревью Б1/Б2): вместо бинарной галки — исход ✓/✗/N/A + комментарий к пункту
// (модель SafetyCulture/iAuditor). Включается только для разовых аудитов.
export function ChecklistCard({ title, items, state, canFill, restaurantId, completionId, staff, myId, accent, t, toast, onSetItem, actions, grading }: {
  title: React.ReactNode; items: { id: string; label: string; photo_required: boolean; weight: number }[]; state: ItemState[]
  canFill: boolean; restaurantId: string; completionId?: string; staff: any[]; myId: string; accent: string; t: any; toast: (m: string) => void
  onSetItem: (idx: number, next: ItemState) => void
  actions?: React.ReactNode
  grading?: boolean
}) {
  const { t: tr } = useI18n()
  const [reporting, setReporting] = useState<number | null>(null)
  const [assignee, setAssignee] = useState('')
  const [reportFile, setReportFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const [noteOpen, setNoteOpen] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const doneCount = items.filter((_, i) => state[i]?.done).length
  // Нарушения в заголовке: зелёный «ГОТОВО» при провалах вводит в заблуждение.
  const failCount = grading ? items.filter((_, i) => effResult(state[i]) === 'fail').length : 0

  const toggle = async (i: number, file?: File) => {
    if (!canFill) { toast(tr('pe.needCheckInFirst')); return }
    const it = items[i]; const cur = state[i] || { done: false, photo_url: null }
    if (!cur.done && it.photo_required && !cur.photo_url) {
      if (!file) return
      setUploading(i)
      const url = await uploadAuditPhoto(restaurantId, completionId || 'pending', file)
      setUploading(null)
      if (!url) return
      onSetItem(i, { ...cur, done: true, photo_url: url })
      return
    }
    onSetItem(i, { ...cur, done: !cur.done, photo_url: cur.photo_url })
  }

  // Оценка исхода: повторный тап по той же оценке снимает её; pass с обязательным фото
  // требует снимок (как бинарная галка); fail сразу открывает форму «нарушение → задача».
  const grade = async (i: number, r: 'pass' | 'fail' | 'na', file?: File) => {
    if (!canFill) { toast(tr('pe.needCheckInFirst')); return }
    const it = items[i]; const cur = state[i] || { done: false, photo_url: null }
    if (effResult(cur) === r) { onSetItem(i, { ...cur, done: false, result: null }); return }
    if (r === 'pass' && it.photo_required && !cur.photo_url) {
      if (!file) return
      setUploading(i)
      const url = await uploadAuditPhoto(restaurantId, completionId || 'pending', file)
      setUploading(null)
      if (!url) return
      onSetItem(i, { ...cur, done: true, result: 'pass', photo_url: url })
      return
    }
    onSetItem(i, { ...cur, done: true, result: r })
    if (r === 'fail') { setReporting(i); setAssignee(''); setReportFile(null) }
  }

  const saveNote = (i: number) => {
    const cur = state[i] || { done: false, photo_url: null }
    const clean = noteDraft.trim()
    if (clean !== (cur.note || '')) onSetItem(i, { ...cur, note: clean || null })
    setNoteOpen(null)
  }

  const pill = (on: boolean, color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 14px',
    borderRadius: 9, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: canFill ? 'pointer' : 'default', background: on ? color : t.fill, color: on ? '#fff' : t.text3,
  })

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title} · {doneCount}/{items.length}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
          {failCount > 0 ? (
            <span title={tr('pe.resultFail')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: t.red, background: `${t.red}1a`, padding: '3px 9px', borderRadius: 8 }}>
              <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="3.2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>{failCount}
            </span>
          ) : doneCount === items.length && items.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.doneCaps')}</span>
          )}
        </span>
      </div>
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
        {items.map((it, i) => {
          const s = state[i] || { done: false, photo_url: null }
          const needsPhoto = it.photo_required && !s.done && !s.photo_url
          if (grading) {
            const eff = effResult(s)
            const passNeedsPhoto = it.photo_required && !s.photo_url && eff !== 'pass'
            return (
              <div key={it.id} style={{ borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 15, color: t.text, opacity: eff === 'pass' ? 0.55 : 1 }}>{it.label}</span>
                      {uploading === i && <span style={{ display: 'block', fontSize: 11, color: t.text3 }}>{tr('pe.uploadingPhoto')}</span>}
                      {s.photo_url && <a href={s.photo_url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 11, color: accent }}>{tr('pe.photoRequired')} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M20 6L9 17l-5-5" /></svg></a>}
                      {!!s.note && noteOpen !== i && <div style={{ fontSize: 12, color: t.text3, marginTop: 3, whiteSpace: 'pre-wrap' }}>{s.note}</div>}
                    </div>
                    <button onClick={() => { setReporting(reporting === i ? null : i); setAssignee(''); setReportFile(null) }} title={tr('pe.reportViolation')} style={{ background: 'none', border: 'none', color: reporting === i ? t.red : t.text4, cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22V15" /></svg>
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    {passNeedsPhoto && canFill ? (
                      <label style={pill(false, t.green)}>
                        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) grade(i, 'pass', f); e.target.value = '' }} />
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                      </label>
                    ) : (
                      <button onClick={() => grade(i, 'pass')} disabled={!canFill} style={pill(eff === 'pass', t.green)}>
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                      </button>
                    )}
                    <button onClick={() => grade(i, 'fail')} disabled={!canFill} style={pill(eff === 'fail', t.red)}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                    <button onClick={() => grade(i, 'na')} disabled={!canFill} style={pill(eff === 'na', t.text3)}>N/A</button>
                    <button onClick={() => { if (noteOpen === i) { saveNote(i) } else { setNoteOpen(i); setNoteDraft(s.note || '') } }} disabled={!canFill} title={tr('pe.itemNote')} style={{ background: 'none', border: 'none', color: (noteOpen === i || s.note) ? accent : t.text4, cursor: canFill ? 'pointer' : 'default', padding: 4, display: 'flex', marginLeft: 'auto' }}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                    </button>
                  </div>
                  {noteOpen === i && (
                    <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => saveNote(i)} autoFocus
                      placeholder={tr('pe.itemNote')} rows={2}
                      style={{ ...inp(t), marginBottom: 0, marginTop: 10, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                  )}
                </div>
                {reporting === i && (
                  <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ ...inp(t), marginBottom: 0 }}>
                      <option value="">{tr('pe.auditTarget')}</option>
                      {CHECKLIST_ROLES.filter(r => r.val).map(r => <option key={r.val} value={`role:${r.val}`}>{tr(r.label)}</option>)}
                      {staff.map((s2: any) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}
                    </select>
                    <label style={{ ...btnB2(t), textAlign: 'center', cursor: 'pointer', display: 'block' }}>
                      {reportFile ? reportFile.name : tr('pe.addPhoto')}
                      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setReportFile(e.target.files?.[0] || null)} />
                    </label>
                    <button onClick={async () => { await reportViolation({ restaurantId, myId, label: it.label, completionId, assignee, staff, photoFile: reportFile, toast, tr }); setReporting(null); setReportFile(null) }} disabled={!assignee} style={{ width: '100%', padding: '10px', borderRadius: 12, border: 'none', background: t.red, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: assignee ? 'pointer' : 'default', opacity: assignee ? 1 : 0.5 }}>{tr('pe.reportViolation')}</button>
                  </div>
                )}
              </div>
            )
          }
          return (
            <div key={it.id} style={{ borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                {needsPhoto ? (
                  <label style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${accent}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: accent }}>
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) toggle(i, f); e.target.value = '' }} />
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  </label>
                ) : (
                  <button onClick={() => toggle(i)} disabled={!canFill} style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${s.done ? accent : t.sep}`, background: s.done ? accent : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canFill ? 'pointer' : 'default', padding: 0 }}>
                    {s.done && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}
                  </button>
                )}
                <div onClick={() => canFill && !needsPhoto && toggle(i)} style={{ flex: 1, cursor: canFill && !needsPhoto ? 'pointer' : 'default', minWidth: 0 }}>
                  <span style={{ fontSize: 15, color: t.text, textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.55 : 1 }}>{it.label}</span>
                  {uploading === i && <span style={{ display: 'block', fontSize: 11, color: t.text3 }}>{tr('pe.uploadingPhoto')}</span>}
                  {s.photo_url && <a href={s.photo_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'block', fontSize: 11, color: accent }}>{tr('pe.photoRequired')} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M20 6L9 17l-5-5" /></svg></a>}
                </div>
                <button onClick={() => { setReporting(reporting === i ? null : i); setAssignee(''); setReportFile(null) }} title={tr('pe.reportViolation')} style={{ background: 'none', border: 'none', color: reporting === i ? t.red : t.text4, cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22V15" /></svg>
                </button>
              </div>
              {reporting === i && (
                <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ ...inp(t), marginBottom: 0 }}>
                    <option value="">{tr('pe.auditTarget')}</option>
                    {CHECKLIST_ROLES.filter(r => r.val).map(r => <option key={r.val} value={`role:${r.val}`}>{tr(r.label)}</option>)}
                    {staff.map((s2: any) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}
                  </select>
                  <label style={{ ...btnB2(t), textAlign: 'center', cursor: 'pointer', display: 'block' }}>
                    {reportFile ? reportFile.name : tr('pe.addPhoto')}
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setReportFile(e.target.files?.[0] || null)} />
                  </label>
                  <button onClick={async () => { await reportViolation({ restaurantId, myId, label: it.label, completionId, assignee, staff, photoFile: reportFile, toast, tr }); setReporting(null); setReportFile(null) }} disabled={!assignee} style={{ width: '100%', padding: '10px', borderRadius: 12, border: 'none', background: t.red, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: assignee ? 'pointer' : 'default', opacity: assignee ? 1 : 0.5 }}>{tr('pe.reportViolation')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ShiftChecklistsView({ isManager, myId, myRole, canFill, openShiftId, staff, restaurantId, accent, t, toast }: {
  isManager: boolean; myId: string; myRole?: string; canFill: boolean; openShiftId: string | null; staff: any[]; restaurantId: string; accent: string; t: any; toast: (m: string) => void
}) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  // Чек-лист открытия/закрытия смены привязан к кассовой смене Manager (shifts.date) —
  // без неё отмечать пункты нельзя, как на iOS (guard let sid = openShiftId).
  const canFillShift = canFill && !!openShiftId
  const [type, setType] = useState<'open' | 'close'>('open')
  const [lists, setLists] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id?: string; role: string | null; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [{ data: cl }, { data: cm }] = await Promise.all([
      db.from('shift_checklists').select('*').eq('kind', 'shift'),
      db.from('shift_checklist_completions').select('*').eq('date', today),
    ])
    setLists(cl || []); setCompletions(cm || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Сотрудник видит общие (role=null) + по своей роли; менеджер — все цеха.
  const relevant = lists.filter(l => l.type === type && (isManager || !l.role || l.role === myRole))

  const setItem = async (list: any, idx: number, next: { done: boolean; photo_url: string | null }) => {
    if (!openShiftId) { toast(tr('pe.openShiftFirst')); return }
    const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
    const completion = completions.find(c => c.checklist_id === list.id)
    const curState = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
    let nextState = items.map((_, i) => i === idx ? next : (curState[i] || { done: false, photo_url: null }))
    let allDone = nextState.every(s => s.done)
    if (completion?.id) {
      // Против lost update: перечитываем свежую строку и мержим ТОЛЬКО свой индекс —
      // параллельные отметки коллег не затираем.
      const { data: freshRows } = await db.from('shift_checklist_completions').select('items_state').eq('id', completion.id)
      const freshState = (Array.isArray(freshRows?.[0]?.items_state) ? freshRows[0].items_state : curState).map(normState)
      nextState = items.map((_, i) => i === idx ? next : (freshState[i] || { done: false, photo_url: null }))
      allDone = nextState.every(s => s.done)
      setCompletions(cs => cs.map(c => c.id === completion.id ? { ...c, items_state: nextState } : c))
      await db.from('shift_checklist_completions').update({ items_state: nextState, status: allDone ? 'done' : 'in_progress', staff_id: myId || null, completed_at: allDone ? new Date().toISOString() : null }).eq('id', completion.id)
    } else {
      const { data } = await db.from('shift_checklist_completions').insert({
        checklist_id: list.id, shift_id: openShiftId, date: today, staff_id: myId || null,
        items_state: nextState, status: allDone ? 'done' : 'in_progress', completed_at: allDone ? new Date().toISOString() : null,
      }).select().single()
      if (data) setCompletions(cs => [...cs, data])
    }
    if (allDone) toast(type === 'open' ? tr('pe.openDone') : tr('pe.closeDone'))
  }

  const saveTemplate = async () => {
    if (!editing) return
    const clean = editing.items.map(s => s.trim()).filter(Boolean)
    if (clean.length === 0) { toast(tr('pe.addAtLeastOneItem')); return }
    setSaving(true)
    if (editing.id) await db.from('shift_checklists').update({ items: clean, role: editing.role }).eq('id', editing.id)
    else await db.from('shift_checklists').insert({ type, items: clean, role: editing.role, kind: 'shift' })
    setSaving(false); setEditing(null); toast(tr('pe.checklistSaved')); await load()
  }
  const removeList = async (id: string) => {
    setLists(ls => ls.filter(l => l.id !== id))
    await db.from('shift_checklists').delete().eq('id', id)
  }
  const addPresets = async () => {
    await Promise.all(PRESET_TEMPLATES.map(p => db.from('shift_checklists').insert({ type: p.type, role: p.role, items: p.items, kind: 'shift' })))
    toast(tr('pe.presetsAdded')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {!openShiftId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: `${t.orange}14`, borderRadius: 14, padding: '14px', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{tr('mg.emptyTitle')}</div>
            <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{tr('pe.checklistNoShiftHint')}</div>
          </div>
        </div>
      )}
      {canFillShift === false && !!openShiftId && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, marginBottom: 14 }}>{tr('pe.needCheckInFirst')}</div>}
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['open', tr('pe.opening')], ['close', tr('pe.closing')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setType(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: type === id ? 700 : 500, cursor: 'pointer', background: type === id ? t.surface : 'transparent', color: type === id ? accent : t.text3, boxShadow: type === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {relevant.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.checklistNotSet')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{isManager ? tr('pe.checklistManagerHint') : tr('pe.checklistStaffHint')}</div>
        </div>
      ) : relevant.map(list => {
        const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
        const completion = completions.find(c => c.checklist_id === list.id)
        const state = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
        return (
          <div key={list.id}>
            {isManager && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 2 }}>
                <button onClick={() => setEditing({ id: list.id, role: list.role ?? null, items: items.length ? items.map(x => x.label) : [''] })} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}>{tr('pe.edit')}</button>
                <button onClick={() => removeList(list.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                </button>
              </div>
            )}
            <ChecklistCard
              title={list.role ? tr(roleLabel(list.role)) : tr('pe.general')}
              items={items} state={state} canFill={canFillShift}
              restaurantId={restaurantId} completionId={completion?.id} staff={staff} myId={myId}
              accent={accent} t={t} toast={toast}
              onSetItem={(idx, next) => setItem(list, idx, next)}
            />
          </div>
        )
      })}

      {isManager && (
        <>
          <button onClick={() => setEditing({ role: null, items: [''] })} style={{ width: '100%', padding: '13px', borderRadius: 14, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: accent, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
            {tr('pe.addChecklistForRole')}
          </button>
          <button onClick={addPresets} style={{ width: '100%', padding: '11px', borderRadius: 14, border: 'none', background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
            {tr('pe.presetTemplates')}
          </button>
        </>
      )}

      {editing != null && (
        <Sheet onClose={() => setEditing(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{type === 'open' ? tr('pe.checklistOpenTitle') : tr('pe.checklistCloseTitle')}</div>
            <label style={lbl(t)}>{tr('pe.workshop')}</label>
            <select value={editing.role ?? ''} onChange={e => setEditing(ed => ({ ...ed!, role: e.target.value || null }))} style={inp(t)}>
              {CHECKLIST_ROLES.map(r => <option key={r.val ?? 'all'} value={r.val ?? ''}>{tr(r.label)}</option>)}
            </select>
            {editing.items.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={v} onChange={e => setEditing(ed => ({ ...ed!, items: ed!.items.map((x, j) => j === i ? e.target.value : x) }))} placeholder={tr('pe.itemN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <button onClick={() => setEditing(ed => ({ ...ed!, items: ed!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <button onClick={() => setEditing(ed => ({ ...ed!, items: [...ed!.items, ''] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addItem')}</button>
            <button onClick={saveTemplate} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.save')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function AdHocAuditsView({ isManager, myId, myName, myRole, staff, canFill, restaurantId, accent, t, toast }: {
  isManager: boolean; myId: string; myName: string; myRole?: string; staff: any[]; canFill: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void
}) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  const [audits, setAudits] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<{
    id: string | null; title: string; items: { label: string; weight: number }[]; targetType: 'role' | 'staff' | 'venue'; targetVal: string
    recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; recurrenceWeekdays: number[]; recurrenceDayOfMonth: number
    origItems?: { label: string; photo_required: boolean; weight: number }[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [historyOf, setHistoryOf] = useState<any | null>(null)
  const [reportOf, setReportOf] = useState<{ audit: any; completion: any } | null>(null)

  const load = async () => {
    // Только сегодняшние прогоны (как iOS todayAuditRuns): иначе отметка попадала в
    // старый прогон повторяющегося аудита, а история грузилась вся без лимита (A1).
    const [{ data: au }, { data: cm }] = await Promise.all([
      db.from('shift_checklists').select('*').eq('kind', 'audit').order('created_at', { ascending: false }).limit(50),
      db.from('shift_checklist_completions').select('*').eq('date', today),
    ])
    setAudits(au || []); setCompletions(cm || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = audits.filter(a =>
    isManager || a.target_scope === 'venue' ||
    (a.target_scope === 'role' && (!a.role || a.role === myRole)) ||
    (a.target_scope === 'staff' && a.assigned_staff_id === myId)
  )

  const setItem = async (audit: any, idx: number, next: ItemState) => {
    const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
    const completion = completions.find(c => c.checklist_id === audit.id && c.date === today)
    const curState = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
    let nextState = items.map((_, i) => i === idx ? next : (curState[i] || { done: false, photo_url: null }))
    let allDone = nextState.every(s => s.done)
    if (completion?.id) {
      // Против lost update: свежая строка с сервера, мержим ТОЛЬКО свой индекс.
      const { data: freshRows } = await db.from('shift_checklist_completions').select('items_state').eq('id', completion.id)
      const freshState = (Array.isArray(freshRows?.[0]?.items_state) ? freshRows[0].items_state : curState).map(normState)
      nextState = items.map((_, i) => i === idx ? next : (freshState[i] || { done: false, photo_url: null }))
      allDone = nextState.every(s => s.done)
      setCompletions(cs => cs.map(c => c.id === completion.id ? { ...c, items_state: nextState } : c))
      await db.from('shift_checklist_completions').update({ items_state: nextState, status: allDone ? 'done' : 'in_progress', staff_id: myId || null, completed_at: allDone ? new Date().toISOString() : null }).eq('id', completion.id)
    } else {
      const { data } = await db.from('shift_checklist_completions').insert({
        checklist_id: audit.id, date: today, staff_id: myId || null,
        items_state: nextState, status: allDone ? 'done' : 'in_progress', completed_at: allDone ? new Date().toISOString() : null,
      }).select().single()
      if (data) setCompletions(cs => [...cs, data])
    }
    if (allDone) toast(tr('pe.auditDone'))
  }

  // Пуш целевой аудитории аудита (запуск сегодняшнего прогона).
  const notifyAudience = (audit: any, title: string) => {
    let targets: string[] = []
    if (audit.target_scope === 'role') targets = staff.filter((s: any) => s.role === audit.role).map((s: any) => s.id)
    else if (audit.target_scope === 'staff') targets = audit.assigned_staff_id ? [audit.assigned_staff_id] : []
    else targets = staff.map((s: any) => s.id)
    const notifyIds = targets.filter(tid => tid !== myId)
    if (notifyIds.length) pushNotify({ type: 'audit', title: 'New audit', body: title, titleKey: 'notify.auditAssignedTitle', bodyKey: 'notify.auditAssignedBody', bodyParams: { name: myName || 'Manager', title }, audience: { staff_ids: notifyIds } })
  }

  /// Повторный запуск существующего шаблона (как iOS startAudit): прогон pending + пуш.
  const startAudit = async (audit: any) => {
    if (completions.some(c => c.checklist_id === audit.id && c.date === today)) return
    await db.from('shift_checklist_completions').insert({ checklist_id: audit.id, date: today, status: 'pending', requested_by: myId || null })
    notifyAudience(audit, audit.title || '')
    toast(tr('pe.auditLaunched')); await load()
  }

  const removeAudit = async (audit: any) => {
    if (!confirm(tr('pe.deleteAuditConfirm'))) return
    await db.from('shift_checklist_completions').delete().eq('checklist_id', audit.id)
    await db.from('shift_checklists').delete().eq('id', audit.id)
    await load()
  }

  const editAudit = (audit: any) => {
    const orig = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
    setCreating({
      id: audit.id, title: audit.title || '', items: orig.map((it: any) => ({ label: it.label, weight: it.weight })),
      targetType: audit.target_scope || 'venue',
      targetVal: audit.target_scope === 'role' ? (audit.role || '') : audit.target_scope === 'staff' ? (audit.assigned_staff_id || '') : '',
      recurrence: audit.recurrence || 'none',
      recurrenceWeekdays: audit.recurrence_weekdays || [], recurrenceDayOfMonth: audit.recurrence_day_of_month || 1,
      origItems: orig,
    })
  }

  const launch = async () => {
    if (!creating) return
    const clean = creating.items
      .map(it => ({ label: it.label.trim(), weight: Number(it.weight) > 0 ? Math.round(Number(it.weight)) : 1 }))
      .filter(it => it.label)
    if (!creating.title.trim() || clean.length === 0) { toast(tr('pe.addAtLeastOneItem')); return }
    if (creating.targetType !== 'venue' && !creating.targetVal) return
    setSaving(true)
    // items — объекты {id,label,weight,photo_required} (Б6): вес правится в веб-форме,
    // photo_required сохраняем по индексу при редактировании (в веб-форме флаг не правится).
    const payload: any = {
      kind: 'audit', title: creating.title.trim(),
      items: clean.map((it, i) => ({ id: String(i), label: it.label, weight: it.weight, photo_required: creating.origItems?.[i]?.photo_required || false })),
      target_scope: creating.targetType,
      recurrence: creating.recurrence,
      recurrence_weekdays: creating.recurrence === 'weekly' ? creating.recurrenceWeekdays : null,
      recurrence_day_of_month: creating.recurrence === 'monthly' ? creating.recurrenceDayOfMonth : null,
      role: null, assigned_staff_id: null,
    }
    if (creating.targetType === 'role') payload.role = creating.targetVal
    if (creating.targetType === 'staff') payload.assigned_staff_id = creating.targetVal
    if (creating.id) {
      await db.from('shift_checklists').update(payload).eq('id', creating.id)
      setSaving(false); setCreating(null); toast(tr('pe.save')); await load()
      return
    }
    const { data: audit } = await db.from('shift_checklists').insert(payload).select().single()
    if (audit) {
      await db.from('shift_checklist_completions').insert({ checklist_id: audit.id, date: today, status: 'pending', requested_by: myId || null })
      notifyAudience(audit, creating.title.trim())
    }
    setSaving(false); setCreating(null); toast(tr('pe.auditLaunched')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {!canFill && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, marginBottom: 14 }}>{tr('pe.needCheckInFirst')}</div>}
      {isManager && (
        <button onClick={() => setCreating({ id: null, title: '', items: [{ label: '', weight: 1 }], targetType: 'role', targetVal: '', recurrence: 'none', recurrenceWeekdays: [], recurrenceDayOfMonth: 1 })} style={{ width: '100%', padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, boxShadow: `0 4px 16px ${accent}44` }}>
          {tr('pe.newAudit')}
        </button>
      )}

      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: t.text2 }}>{tr('pe.noAudits')}</div>
          {isManager && <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5, maxWidth: 340, margin: '8px auto 0' }}>{tr('pe.noAuditsHint')}</div>}
        </div>
      ) : visible.map(audit => {
        const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
        const completion = completions.find(c => c.checklist_id === audit.id && c.date === today)
        const state = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
        const targetLabel = audit.target_scope === 'role' ? tr(roleLabel(audit.role)) : audit.target_scope === 'staff' ? (staff.find((s: any) => s.id === audit.assigned_staff_id)?.name || '—') : tr('pe.auditTargetVenue')
        const recurLabel = recurrenceSummary(audit, tr)
        return (
          <ChecklistCard
            key={audit.id}
            title={<>{audit.title || '—'} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {targetLabel}{recurLabel ? ` · ${recurLabel}` : ''}</span></>}
            items={items} state={state} canFill={canFill} grading
            restaurantId={restaurantId} completionId={completion?.id} staff={staff} myId={myId}
            accent={accent} t={t} toast={toast}
            onSetItem={(idx, next) => setItem(audit, idx, next)}
            actions={isManager && (
              <>
                {!completion && (
                  <button onClick={() => startAudit(audit)} title={tr('pe.runAudit')} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: 2, display: 'flex' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                  </button>
                )}
                <button onClick={() => setHistoryOf(audit)} title={tr('pe.auditHistory')} style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </button>
                <button onClick={() => editAudit(audit)} title={tr('pe.editAudit')} style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                </button>
                <button onClick={() => removeAudit(audit)} title={tr('pe.deleteAuditConfirm')} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                </button>
              </>
            )}
          />
        )
      })}

      {creating != null && (
        <Sheet onClose={() => setCreating(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{tr('pe.newAudit')}</div>
            <input value={creating.title} onChange={e => setCreating(c => ({ ...c!, title: e.target.value }))} placeholder={tr('pe.auditTitlePh')} style={inp(t)} />
            <label style={lbl(t)}>{tr('pe.auditTarget')}</label>
            <select value={creating.targetType} onChange={e => setCreating(c => ({ ...c!, targetType: e.target.value as any, targetVal: '' }))} style={inp(t)}>
              <option value="role">{tr('pe.auditTargetRole')}</option>
              <option value="staff">{tr('pe.auditTargetStaff')}</option>
              <option value="venue">{tr('pe.auditTargetVenue')}</option>
            </select>
            {creating.targetType === 'role' && (
              <select value={creating.targetVal} onChange={e => setCreating(c => ({ ...c!, targetVal: e.target.value }))} style={inp(t)}>
                <option value="">—</option>
                {CHECKLIST_ROLES.filter(r => r.val).map(r => <option key={r.val} value={r.val!}>{tr(r.label)}</option>)}
              </select>
            )}
            {creating.targetType === 'staff' && (
              <select value={creating.targetVal} onChange={e => setCreating(c => ({ ...c!, targetVal: e.target.value }))} style={inp(t)}>
                <option value="">—</option>
                {staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <label style={lbl(t)}>{tr('pe.recurrenceLabel')}</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {([['none', tr('pe.recurrenceNone')], ['daily', tr('pe.recurrenceDaily')], ['weekly', tr('pe.recurrenceWeekly')], ['monthly', tr('pe.recurrenceMonthly')]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setCreating(c => ({ ...c!, recurrence: id }))} style={{ flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: creating.recurrence === id ? 700 : 500, cursor: 'pointer', background: creating.recurrence === id ? accent : t.fill, color: creating.recurrence === id ? '#fff' : t.text3 }}>{label}</button>
              ))}
            </div>
            {creating.recurrence === 'weekly' && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {WEEKDAY_DISPLAY_ORDER.map(d => {
                  const on = creating.recurrenceWeekdays.includes(d)
                  return (
                    <button key={d} onClick={() => setCreating(c => ({ ...c!, recurrenceWeekdays: on ? c!.recurrenceWeekdays.filter(x => x !== d) : [...c!.recurrenceWeekdays, d] }))}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer', background: on ? accent : t.fill, color: on ? '#fff' : t.text3 }}>
                      {tr(WEEKDAY_LABELS[d])}
                    </button>
                  )
                })}
              </div>
            )}
            {creating.recurrence === 'monthly' && (
              <input type="number" min={1} max={31} value={creating.recurrenceDayOfMonth}
                onChange={e => setCreating(c => ({ ...c!, recurrenceDayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))}
                placeholder={tr('pe.dayOfMonthLabel')} style={{ ...inp(t), marginBottom: 14 }} />
            )}
            <label style={lbl(t)}>{tr('pe.itemsLabel')}</label>
            {creating.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={it.label} onChange={e => setCreating(c => ({ ...c!, items: c!.items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} placeholder={tr('pe.itemN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <input type="number" min={1} max={9} value={it.weight} title={tr('pe.itemWeight')}
                  onChange={e => setCreating(c => ({ ...c!, items: c!.items.map((x, j) => j === i ? { ...x, weight: Math.min(9, Math.max(1, Math.round(Number(e.target.value)) || 1)) } : x) }))}
                  style={{ ...inp(t), marginBottom: 0, width: 52, flexShrink: 0, textAlign: 'center', padding: '0 4px' }} />
                <button onClick={() => setCreating(c => ({ ...c!, items: c!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <div style={{ fontSize: 11, color: t.text3, marginTop: -4, marginBottom: 10 }}>{tr('pe.itemWeight')}: 1–9</div>
            <button onClick={() => setCreating(c => ({ ...c!, items: [...c!.items, { label: '', weight: 1 }] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addItem')}</button>
            <button onClick={launch} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.launchAudit')}
            </button>
          </div>
        </Sheet>
      )}

      {historyOf != null && (
        <AuditHistorySheet audit={historyOf} staff={staff} accent={accent} t={t}
          onClose={() => setHistoryOf(null)}
          onOpenRun={c => { setReportOf({ audit: historyOf, completion: c }); setHistoryOf(null) }} />
      )}
      {reportOf != null && (
        <AuditReportSheet audit={reportOf.audit} completion={reportOf.completion} staff={staff} accent={accent} t={t}
          onClose={() => setReportOf(null)} />
      )}
    </div>
  )
}

// Счёт прогона (ревью Б3/Б4, весы — Б6): N/A вне знаменателя; fail и «не проверено» = не
// выполнено. Пункт весит items[i].weight (по умолчанию 1 — старые записи и чек-листы смены
// без весов считаются как раньше, поштучно).
export function runScore(items: any[], state: ItemState[]): { pass: number; total: number } {
  let pass = 0, total = 0
  items.forEach((it, i) => {
    const eff = effResult(state[i])
    if (eff === 'na') return
    const w = Number(it?.weight) > 0 ? Number(it.weight) : 1
    total += w
    if (eff === 'pass') pass += w
  })
  return { pass, total }
}

// PDF-отчёт прогона (ревью Б3): шапка, пункты со статусами, комментарии, фото.
// Та же инфраструктура, что в Analytics (jsPDF + PT Sans для кириллицы).
async function exportAuditRunPdf(opts: { audit: any; completion: any; staffName: string; targetLabel: string; tr: (k: string, v?: Record<string, string | number>) => string }) {
  const { audit, completion, staffName, targetLabel, tr } = opts
  const { jsPDF } = await import('jspdf')
  const { ptSansBase64 } = await import('@/lib/ptSansFont')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.addFileToVFS('PTSans.ttf', ptSansBase64)
  doc.addFont('PTSans.ttf', 'PTSans', 'normal')
  doc.setFont('PTSans')
  const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
  const state = (Array.isArray(completion.items_state) ? completion.items_state : []).map(normState)
  const { pass, total } = runScore(items, state)
  let y = 46
  doc.setFontSize(17); doc.text(audit.title || tr('pe.auditReport'), 40, y); y += 22
  doc.setFontSize(10); doc.setTextColor(110)
  doc.text(`${completion.date || ''} · ${staffName} · ${targetLabel}`, 40, y); y += 14
  doc.text(`${tr('pe.completionRate')}: ${total > 0 ? Math.round((pass / total) * 100) : 0}% (${pass}/${total})`, 40, y); y += 10
  doc.setDrawColor(200); doc.line(40, y, 555, y); y += 20
  for (let i = 0; i < items.length; i++) {
    const s = state[i]; const eff = effResult(s)
    if (y > 770) { doc.addPage(); y = 46 }
    const tag = eff === 'pass' ? 'OK' : eff === 'fail' ? tr('pe.resultFail') : eff === 'na' ? 'N/A' : tr('pe.notChecked')
    doc.setFontSize(11)
    if (eff === 'fail') doc.setTextColor(200, 40, 40)
    else if (eff === 'pass') doc.setTextColor(30, 140, 70)
    else doc.setTextColor(120)
    doc.text(tag, 40, y)
    doc.setTextColor(20)
    const lines = doc.splitTextToSize(items[i].label, 400)
    doc.text(lines, 135, y); y += lines.length * 14
    if (s?.note) {
      if (y > 780) { doc.addPage(); y = 46 }
      doc.setFontSize(9); doc.setTextColor(110)
      const nl = doc.splitTextToSize(s.note, 400)
      doc.text(nl, 135, y); y += nl.length * 12
      doc.setTextColor(20)
    }
    if (s?.photo_url) {
      // Фото пунктов — публичные URL Supabase Storage; не загрузилось (CORS/сеть) — URL строкой.
      try {
        const blob = await (await fetch(s.photo_url)).blob()
        const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob) })
        if (y > 690) { doc.addPage(); y = 46 }
        doc.addImage(dataUrl, dataUrl.includes('image/png') ? 'PNG' : 'JPEG', 135, y, 90, 90, undefined, 'FAST'); y += 100
      } catch {
        doc.setFontSize(8); doc.setTextColor(110); doc.text(String(s.photo_url), 135, y); y += 12; doc.setTextColor(20)
      }
    }
    y += 8
  }
  doc.save(`audit-${(audit.title || 'report').replace(/[^0-9A-Za-zЀ-ӿ-]+/g, '_')}-${completion.date || ''}.pdf`)
}

// История прогонов аудита за 30 дней (ревью Б4) — вход в отчёт Б3.
export function AuditHistorySheet({ audit, staff, accent, t, onClose, onOpenRun }: {
  audit: any; staff: any[]; accent: string; t: any; onClose: () => void; onOpenRun: (completion: any) => void
}) {
  const { t: tr } = useI18n()
  const [runs, setRuns] = useState<any[] | null>(null)
  useEffect(() => {
    const since = fmtDate(new Date(Date.now() - 30 * 86400000))
    db.from('shift_checklist_completions').select('*').eq('checklist_id', audit.id)
      .gte('date', since).order('date', { ascending: false }).limit(100)
      .then(({ data }: any) => setRuns(data || []))
  }, [audit.id])
  const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
  return (
    <Sheet onClose={onClose} t={t}>
      <div style={{ padding: '14px 20px 32px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 4 }}>{audit.title || '—'}</div>
        <div style={{ fontSize: 12, color: t.text3, textAlign: 'center', marginBottom: 16 }}>{tr('pe.auditHistory')} · {tr('pe.last30Days')}</div>
        {runs === null ? (
          <div style={{ textAlign: 'center', padding: 30, color: t.text3 }}>{tr('pe.loading')}</div>
        ) : runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: t.text3, fontSize: 14 }}>{tr('pe.auditHistoryEmpty')}</div>
        ) : (
          <div style={{ background: t.fill, borderRadius: 16, overflow: 'hidden' }}>
            {runs.map((c, i) => {
              const state = (Array.isArray(c.items_state) ? c.items_state : []).map(normState)
              const { pass, total } = runScore(items, state)
              const pct = total > 0 ? Math.round((pass / total) * 100) : 0
              const pending = c.status === 'pending'
              const who = staff.find((s: any) => s.id === c.staff_id)?.name || '—'
              return (
                <button key={c.id} onClick={() => onOpenRun(c)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '13px 16px', background: 'none', border: 'none', borderBottom: i < runs.length - 1 ? `0.5px solid ${t.sep2}` : 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: t.text }}>{c.date}</span>
                    <span style={{ display: 'block', fontSize: 12, color: t.text3 }}>{who}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, color: pending ? t.text3 : pct >= 80 ? t.green : pct >= 50 ? t.orange : t.red }}>
                    {pending ? tr('pe.notChecked') : `${pct}%`}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Sheet>
  )
}

// Отчёт по прогону (ревью Б3): пункты со статусами, комментарии, фото + экспорт PDF.
export function AuditReportSheet({ audit, completion, staff, accent, t, onClose }: {
  audit: any; completion: any; staff: any[]; accent: string; t: any; onClose: () => void
}) {
  const { t: tr } = useI18n()
  const [exporting, setExporting] = useState(false)
  const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
  const state = (Array.isArray(completion.items_state) ? completion.items_state : []).map(normState)
  const { pass, total } = runScore(items, state)
  const pct = total > 0 ? Math.round((pass / total) * 100) : 0
  const staffName = staff.find((s: any) => s.id === completion.staff_id)?.name || '—'
  const targetLabel = audit.target_scope === 'role' ? tr(roleLabel(audit.role)) : audit.target_scope === 'staff' ? (staff.find((s: any) => s.id === audit.assigned_staff_id)?.name || '—') : tr('pe.auditTargetVenue')
  const tagOf = (eff: ReturnType<typeof effResult>) => eff === 'pass'
    ? { label: 'OK', color: t.green } : eff === 'fail'
    ? { label: tr('pe.resultFail'), color: t.red } : eff === 'na'
    ? { label: 'N/A', color: t.text3 } : { label: tr('pe.notChecked'), color: t.text3 }
  return (
    <Sheet onClose={onClose} t={t}>
      <div style={{ padding: '14px 20px 32px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 4 }}>{audit.title || tr('pe.auditReport')}</div>
        <div style={{ fontSize: 12, color: t.text3, textAlign: 'center', marginBottom: 14 }}>{completion.date} · {staffName} · {targetLabel}</div>
        <div style={{ background: t.fill, borderRadius: 14, padding: '14px', textAlign: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 30, fontWeight: 800, color: pct >= 80 ? t.green : pct >= 50 ? t.orange : t.red }}>{pct}%</span>
          <span style={{ fontSize: 13, color: t.text3, marginLeft: 8 }}>{pass}/{total}</span>
        </div>
        <div style={{ background: t.fill, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          {items.map((it, i) => {
            const s = state[i]
            const tag = tagOf(effResult(s))
            return (
              <div key={it.id} style={{ padding: '12px 16px', borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: tag.color, background: `${tag.color}1a`, padding: '3px 8px', borderRadius: 7, flexShrink: 0, whiteSpace: 'nowrap' }}>{tag.label}</span>
                  <span style={{ fontSize: 14, color: t.text, minWidth: 0 }}>{it.label}</span>
                </div>
                {!!s?.note && <div style={{ fontSize: 12, color: t.text3, marginTop: 5, whiteSpace: 'pre-wrap' }}>{s.note}</div>}
                {!!s?.photo_url && (
                  <a href={s.photo_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 7 }}>
                    <img src={s.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
        <button disabled={exporting} onClick={async () => { setExporting(true); try { await exportAuditRunPdf({ audit, completion, staffName, targetLabel, tr }) } finally { setExporting(false) } }}
          style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: exporting ? 0.6 : 1, boxShadow: `0 4px 16px ${accent}44` }}>
          {exporting ? '...' : `PDF · ${tr('pe.auditReport')}`}
        </button>
      </div>
    </Sheet>
  )
}

export function AuditStatsView({ accent, t }: { accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [loading, setLoading] = useState(true)
  const [lists, setLists] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  // Раздельная статистика: рутина открытия/закрытия смены размывала «% выполнения» аудитов.
  const [kind, setKind] = useState<'audit' | 'shift'>('audit')

  useEffect(() => {
    const since = fmtDate(new Date(Date.now() - 30 * 86400000))
    Promise.all([
      db.from('shift_checklists').select('*'),
      db.from('shift_checklist_completions').select('*').gte('date', since),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
    ]).then(([{ data: cl }, { data: cm }, { data: dir }]: any) => {
      setLists(cl || []); setCompletions(cm || []); setStaff(dir || []); setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (completions.length === 0) return <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>{tr('pe.noStatsYet')}</div>

  const listById = new Map(lists.map((l: any) => [l.id, l]))
  let totalItems = 0, doneItems = 0
  const violationsByLabel = new Map<string, number>()
  const byStaff = new Map<string, { total: number; done: number }>()

  // Что считать (ревью A2): status='done' ставится только когда отмечены ВСЕ пункты, поэтому
  // «нарушение» = неотмеченный пункт в прогоне, работа над которым закончена по времени:
  // done-прогоны + начатые (in_progress) за ПРОШЛЫЕ дни. Сегодняшние in_progress ещё
  // заполняются, pending вообще не открывались — они идут отдельной метрикой «не пройдено»,
  // а не в нарушения (иначе пустой прогон = 100% нарушений).
  const todayKey = fmtDate(new Date())
  const ofKind = (c: any) => {
    const l: any = listById.get(c.checklist_id)
    return !!l && ((l.kind || 'shift') === kind)
  }
  const finished = completions.filter((c: any) => ofKind(c) && (c.status === 'done' || (c.status === 'in_progress' && c.date < todayKey)))
  const unfinished = completions.filter((c: any) => ofKind(c) && c.status === 'pending' && c.date < todayKey).length

  for (const c of finished) {
    const list = listById.get(c.checklist_id)
    if (!list) continue
    const items = (Array.isArray((list as any).items) ? (list as any).items : []).map((x: any, i: number) => normItem(x, i))
    const state = (Array.isArray(c.items_state) ? c.items_state : []).map(normState)
    // Оценки Б1: N/A выпадает из знаменателя, fail = нарушение, pass = выполнено;
    // старые записи без result — по done (бинарная модель).
    const staffCur = c.staff_id ? (byStaff.get(c.staff_id) || { total: 0, done: 0 }) : null
    items.forEach((it: any, i: number) => {
      const eff = effResult(state[i])
      if (eff === 'na') return
      totalItems++
      if (staffCur) staffCur.total++
      if (eff === 'pass') { doneItems++; if (staffCur) staffCur.done++ }
      else violationsByLabel.set(it.label, (violationsByLabel.get(it.label) || 0) + 1)
    })
    if (c.staff_id && staffCur) byStaff.set(c.staff_id, staffCur)
  }

  const rate = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  const topViolations = Array.from(violationsByLabel.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const rating = Array.from(byStaff.entries())
    .map(([id, v]) => ({ name: staff.find((s: any) => s.id === id)?.name || '—', pct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 14, gap: 2 }}>
        {([['audit', tr('dash.audits')], ['shift', tr('pe.shiftChecklists')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setKind(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: kind === id ? 700 : 500, cursor: 'pointer', background: kind === id ? t.surface : 'transparent', color: kind === id ? accent : t.text3, boxShadow: kind === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>
      {totalItems === 0 && unfinished === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>{tr('pe.noStatsYet')}</div>
      ) : (
      <>
      <div style={{ background: t.surface, borderRadius: 20, padding: '24px 20px', boxShadow: t.sh, textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 44, fontWeight: 800, color: accent }}>{rate}%</div>
        <div style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>{tr('pe.completionRate')} · {tr('pe.last30Days')}</div>
        {unfinished > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: t.orange, marginTop: 6 }}>{tr('pe.unfinishedRuns', { n: unfinished })}</div>}
      </div>

      {topViolations.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.topViolations')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 16 }}>
            {topViolations.map(([label, n], i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < topViolations.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ fontSize: 14, color: t.text }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.red }}>{n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {rating.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.staffRating')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
            {rating.map((r, i) => (
              <div key={r.name + i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < rating.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ fontSize: 14, color: t.text }}>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.pct >= 80 ? t.green : r.pct >= 50 ? t.orange : t.red }}>{r.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

// Обёртка: сегмент «Смена / Разовые / Статистика» + общий гео-гейт (личная явка сегодня).
export function AuditsView({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const myId = me.id || ''
  const myRole = me.role
  const today = fmtDate(new Date())
  const [seg, setSeg] = useState<'shift' | 'oneoff' | 'stats'>('shift')
  const [staff, setStaff] = useState<any[]>([])
  const [geoRequired, setGeoRequired] = useState(false)
  const [checkedInToday, setCheckedInToday] = useState(true)
  const [openShiftId, setOpenShiftId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      db.from('restaurant_settings').select('attendance_enabled').limit(1),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      myId ? db.from('attendance_records').select('id').eq('staff_id', myId).eq('date', today).limit(1) : Promise.resolve({ data: [] as any[] }),
      // Чек-лист открытия/закрытия смены привязан к кассовой смене Manager за сегодня
      // (shifts.date уникален по (restaurant_id, date) — см. CLAUDE.md), как на iOS.
      db.from('shifts').select('id,status').eq('date', today).order('opened_at', { ascending: false }).limit(1),
    ]).then(([rs, dir, att, sh]: any) => {
      const s = Array.isArray(rs.data) ? rs.data[0] : rs.data
      setGeoRequired(!!s?.attendance_enabled)
      setStaff(dir.data || [])
      setCheckedInToday((att.data || []).length > 0)
      setOpenShiftId(sh.data?.[0]?.id || null)
      setReady(true)
    })
  }, [myId])

  // Fail-closed до загрузки данных (гео/явка/смена) — как на iOS (requireGeoCheckIn ждёт
  // loadAttendance перед решением), не оставляем короткое окно кликабельности "вслепую".
  const canFill = ready && (!geoRequired || !myId || checkedInToday)

  const SEGS = [
    { id: 'shift', label: tr('pe.shiftChecklists') },
    { id: 'oneoff', label: tr('pe.oneOffAudits') },
    ...(isManager ? [{ id: 'stats', label: tr('pe.statistics') }] : []),
  ] as const

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {SEGS.map(s => (
          <button key={s.id} onClick={() => setSeg(s.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: seg === s.id ? 700 : 500, cursor: 'pointer', background: seg === s.id ? t.surface : 'transparent', color: seg === s.id ? accent : t.text3, boxShadow: seg === s.id ? t.sh2 : 'none' }}>{s.label}</button>
        ))}
      </div>
      {seg === 'shift' && <ShiftChecklistsView isManager={isManager} myId={myId} myRole={myRole} canFill={canFill} openShiftId={openShiftId} staff={staff} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {seg === 'oneoff' && <AdHocAuditsView isManager={isManager} myId={myId} myName={me.name || ''} myRole={myRole} staff={staff} canFill={canFill} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {seg === 'stats' && isManager && <AuditStatsView accent={accent} t={t} />}
    </div>
  )
}

