'use client'
import React, { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { CHECKLIST_ROLES, PRESET_TEMPLATES, ChecklistCard, normItem, normState } from '@/app/people/audits'
import { lbl, inp } from '@/app/people/shared'
import { Sheet, roleLabel, getMe } from '@/components/people/helpers'

// Manager → Настройки → Чек-листы (реструктура 2026-08-13/14). Два раздела: Шаблоны
// (kind="shift", открытие/закрытие) и Верификация (pass/fail проверка прогонов, было
// grading в ShiftChecklistsView, Д4 2026-07-31) — переехала сюда 2026-08-14 по индустрии
// (SafetyCulture/Jolt/Zenput: field team исполняет → manager team проверяет через
// отдельный dashboard). В People теперь только прохождение. Паритет с iOS ManagerChecklists.swift.

export function ManagerChecklistsTab({ restaurantId, accent, t }: { restaurantId: string; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [section, setSection] = useState<'templates' | 'verify'>('templates')
  const [type, setType] = useState<'open' | 'close'>('open')
  const [lists, setLists] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id?: string; role: string | null; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }
  // B5 (аудит 2026-08-13): Manager нигде не подгружал свою личность → myId="" ломал
  // created_by (violation-задачи без автора) и notifyIds (менеджер слал пуш сам себе).
  const myId = getMe(restaurantId).id || ''

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('shift_checklists').select('*').eq('kind', 'shift')
    setLists(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // ── Верификация: те же completions, что видит сотрудник, только менеджер решает pass/fail/N/A ──
  const [completions, setCompletions] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [verifyLoading, setVerifyLoading] = useState(true)
  const today = fmtDate(new Date())
  const loadVerify = async () => {
    setVerifyLoading(true)
    const [{ data: cm }, { data: st }] = await Promise.all([
      db.from('shift_checklist_completions').select('*').eq('date', today),
      db.from('staff_directory').select('*').eq('is_active', true),
    ])
    setCompletions(cm || []); setStaff(st || []); setVerifyLoading(false)
  }
  useEffect(() => { if (section === 'verify') loadVerify() }, [section])

  const setVerifyItem = async (list: any, idx: number, next: any) => {
    const completion = completions.find(c => c.checklist_id === list.id)
    if (!completion) return
    const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
    const curState = (Array.isArray(completion.items_state) ? completion.items_state : []).map(normState)
    const { data: freshRows } = await db.from('shift_checklist_completions').select('items_state').eq('id', completion.id)
    const freshState = (Array.isArray(freshRows?.[0]?.items_state) ? freshRows[0].items_state : curState).map(normState)
    const nextState = items.map((_: any, i: number) => i === idx ? next : (freshState[i] || { done: false, photo_url: null }))
    const allDone = nextState.every((s: any) => s.done)
    setCompletions(cs => cs.map(c => c.id === completion.id ? { ...c, items_state: nextState } : c))
    await db.from('shift_checklist_completions').update({ items_state: nextState, status: allDone ? 'done' : 'in_progress' }).eq('id', completion.id)
  }

  const verifiable = lists.filter(l => completions.find(c => c.checklist_id === l.id && c.status === 'done'))

  const relevant = lists.filter(l => l.type === type)

  const saveTemplate = async () => {
    if (!editing) return
    const clean = editing.items.map(s => s.trim()).filter(Boolean)
    if (clean.length === 0) { showToast(tr('pe.addAtLeastOneItem')); return }
    setSaving(true)
    if (editing.id) await db.from('shift_checklists').update({ items: clean, role: editing.role }).eq('id', editing.id)
    else await db.from('shift_checklists').insert({ type, items: clean, role: editing.role, kind: 'shift' })
    setSaving(false); setEditing(null); showToast(tr('pe.checklistSaved')); await load()
  }
  const removeList = async (id: string) => {
    setLists(ls => ls.filter(l => l.id !== id))
    await db.from('shift_checklists').delete().eq('id', id)
  }
  const addPresets = async () => {
    await Promise.all(PRESET_TEMPLATES.map(p => db.from('shift_checklists').insert({ type: p.type, role: p.role, items: p.items, kind: 'shift' })))
    showToast(tr('pe.presetsAdded')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['templates', tr('pe.checklistTemplates')], ['verify', tr('pe.verification')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: section === id ? 700 : 500, cursor: 'pointer', background: section === id ? t.surface : 'transparent', color: section === id ? accent : t.text3, boxShadow: section === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {section === 'verify' ? (
        verifyLoading ? <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div> :
        verifiable.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>{tr('pe.noRunYet')}</div>
        ) : verifiable.map(list => {
          const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
          const completion = completions.find(c => c.checklist_id === list.id)
          const state = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
          return (
            <ChecklistCard key={list.id}
              title={list.role ? tr(roleLabel(list.role)) : tr('pe.general')}
              items={items} state={state} canFill={true} grading
              restaurantId={restaurantId} completionId={completion?.id} staff={staff} myId={myId}
              accent={accent} t={t} toast={showToast}
              onSetItem={(idx, next) => setVerifyItem(list, idx, next)}
            />
          )
        })
      ) : (
      <>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['open', tr('pe.opening')], ['close', tr('pe.closing')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setType(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: type === id ? 700 : 500, cursor: 'pointer', background: type === id ? t.surface : 'transparent', color: type === id ? accent : t.text3, boxShadow: type === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {relevant.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.checklistNotSet')}</div>
        </div>
      ) : relevant.map(list => {
        const items = Array.isArray(list.items) ? list.items : []
        return (
          <div key={list.id} style={{ background: t.surface, borderRadius: 16, boxShadow: t.sh, padding: 14, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{list.role ? tr(roleLabel(list.role)) : tr('pe.general')}</div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{items.length}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEditing({ id: list.id, role: list.role ?? null, items: items.length ? items.map((x: any) => (typeof x === 'string' ? x : x.label)) : [''] })} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}>{tr('pe.edit')}</button>
              <button onClick={() => removeList(list.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 0, display: 'flex' }}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
              </button>
            </div>
          </div>
        )
      })}

      <button onClick={() => setEditing({ role: null, items: [''] })} style={{ width: '100%', padding: '13px', borderRadius: 14, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: accent, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
        {tr('pe.addChecklistForRole')}
      </button>
      <button onClick={addPresets} style={{ width: '100%', padding: '11px', borderRadius: 14, border: 'none', background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
        {tr('pe.presetTemplates')}
      </button>

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
      </>
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}
