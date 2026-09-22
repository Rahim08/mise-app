'use client'
// Поступления в баланс инкассации (docs/migrations/inkassation-topups-2026-09-21.sql).
// Отдельная таблица inkassation_topups: кассу (shifts/наличные/карта) не трогает, в выручку и
// прибыль не входит. Здесь — добавление/правка/удаление (Manager); Analytics только читает.
// Удаление физическое — «до»-образ остаётся в financial_audit_log (триггер + /api/db).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate, fv, displayDate } from '@/lib/format'

type Topup = { id: string; date: string; amount: number; reason: string }

const parseAmount = (s: string) => Math.round((parseFloat(s.replace(',', '.')) || 0) * 100) / 100

export function InkassationTopups({ restaurantId, t, toast }: { restaurantId: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [rows, setRows] = useState<Topup[]>([])
  const [sheet, setSheet] = useState<{ id: string | null } | null>(null)
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = async () => {
    const { data } = await db.from('inkassation_topups').select('id, date, amount, reason').eq('restaurant_id', restaurantId).order('date', { ascending: false }).limit(20)
    setRows((data || []) as Topup[])
  }
  useEffect(() => { load() }, [restaurantId])

  // Баланс инкассации «сейчас» (та же формула, что Analytics/выплата ЗП): валовая инкассация −
  // (расход + ЗП) + поступления. null — не удалось прочитать (fail-closed: правку не пускаем).
  const inkBalance = async (): Promise<number | null> => {
    const [a, b, c] = await Promise.all([
      db.from('shifts').select('inkassation').eq('restaurant_id', restaurantId),
      db.from('inkassations').select('expense, salary').eq('restaurant_id', restaurantId),
      db.from('inkassation_topups').select('amount').eq('restaurant_id', restaurantId),
    ])
    if (a.error || b.error || c.error) return null
    const sum = (rows: any[] | null, f: (r: any) => number) => (rows || []).reduce((s, r) => s + f(r), 0)
    return sum(a.data, r => Number(r.inkassation || 0)) - sum(b.data, r => Number(r.expense || 0) + Number(r.salary || 0)) + sum(c.data, r => Number(r.amount || 0))
  }
  // Уменьшение/удаление поступления, из которого уже платили (ЗП, расход), увело бы баланс в минус.
  // Возвращает текст ошибки или '' если можно.
  const guardReduction = async (reduceBy: number): Promise<string> => {
    if (reduceBy <= 0) return ''
    const bal = await inkBalance()
    if (bal === null) return tr('mg.topupErrVerify')
    if (bal - reduceBy < -0.005) return tr('mg.topupErrNegative', { avail: `€${fv(Math.max(0, bal))}` })
    return ''
  }

  const openNew = () => {
    setDate(fmtDate(new Date())); setAmount(''); setReason(''); setErr(''); setConfirmDelete(false)
    setSheet({ id: null })
  }
  const openEdit = (r: Topup) => {
    setDate(r.date); setAmount(String(r.amount)); setReason(r.reason); setErr(''); setConfirmDelete(false)
    setSheet({ id: r.id })
  }

  const save = async () => {
    if (saving || !sheet) return
    const amt = parseAmount(amount)
    if (!(amt > 0)) { setErr(tr('mg.topupErrAmount')); return }
    if (!reason.trim()) { setErr(tr('mg.topupErrReason')); return }
    if (!date || date > fmtDate(new Date())) { setErr(tr('mg.topupErrDate')); return }
    setSaving(true); setErr('')
    if (sheet.id) {
      const old = rows.find(r => r.id === sheet.id)
      const g = await guardReduction(Number(old?.amount || 0) - amt)
      if (g) { setSaving(false); setErr(g); return }
    }
    const values = { date, amount: amt, reason: reason.trim().slice(0, 200) }
    const { error } = sheet.id
      ? await db.from('inkassation_topups').update(values).eq('id', sheet.id)
      : await db.from('inkassation_topups').insert({ restaurant_id: restaurantId, ...values })
    setSaving(false)
    if (error) { setErr(tr('mg.err') + ': ' + error.message); return }
    setSheet(null); toast(tr('mg.topupSaved')); load()
  }

  const remove = async () => {
    if (saving || !sheet?.id) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setSaving(true); setErr('')
    const g = await guardReduction(Number(rows.find(r => r.id === sheet.id)?.amount || 0))
    if (g) { setSaving(false); setConfirmDelete(false); setErr(g); return }
    const { error } = await db.from('inkassation_topups').delete().eq('id', sheet.id)
    setSaving(false)
    if (error) { setErr(tr('mg.err') + ': ' + error.message); return }
    setSheet(null); load()
  }

  const label = { fontSize: 12, color: t.text3, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.3 }
  const input = { width: '100%', padding: '10px 12px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, fontFamily: 'inherit', outline: 'none', background: t.fill2 }

  return (
    <>
      {/* zIndex 70 — выше матового стекла «смена сохранена» (z 60): поступление можно добавить и при закрытой смене */}
      <div style={{ position: 'relative', zIndex: 70 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('mg.topups')}</div>
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
        {rows.length === 0
          ? <div style={{ padding: '14px 16px', fontSize: 13, color: t.text4 }}>{tr('mg.topupNone')}</div>
          : rows.map(r => (
            <button key={r.id} onClick={() => openEdit(r)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: `0.5px solid ${t.sep2}`, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, color: t.text3 }}>{displayDate(new Date(r.date + 'T00:00:00'))}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: t.blue }}>+€{fv(r.amount)}</span>
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{r.reason}</div>
            </button>
          ))}
        <button onClick={openNew} style={{ display: 'block', width: '100%', padding: '13px 16px', border: 'none', background: 'transparent', color: t.blue, fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          + {tr('mg.addTx')}
        </button>
      </div>
      </div>

      {sheet && createPortal(
        <div onClick={() => !saving && setSheet(null)} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 600, background: t.surface, borderRadius: '20px 20px 0 0', padding: '20px 16px 28px', animation: 'fadeUp .22s ease' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 4 }}>{sheet.id ? tr('mg.topupEdit') : tr('mg.topupNew')}</div>
            <div style={{ fontSize: 12, color: t.text3, marginBottom: 14 }}>{tr('mg.topupHint')}</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={label}>{tr('mg.topupDate')}</div>
                <input type="date" value={date} max={fmtDate(new Date())} onChange={e => setDate(e.target.value)} style={input} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={label}>{tr('mg.topupAmount')}</div>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="€ 0" style={{ ...input, textAlign: 'right', color: t.blue, fontWeight: 600 }} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={label}>{tr('mg.topupReason')}</div>
              <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder={tr('mg.phPurpose')} style={input} />
            </div>
            {err && <div style={{ fontSize: 13, color: t.red, marginBottom: 10 }}>{err}</div>}
            <button onClick={save} disabled={saving} style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: t.blue, color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{tr('mg.topupSave')}</button>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button onClick={() => setSheet(null)} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: t.fill, color: t.text, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer' }}>{tr('mg.cancel')}</button>
              {sheet.id && (
                <button onClick={remove} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: `${t.red}18`, color: t.red, fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {confirmDelete ? tr('mg.topupDeleteSure') : tr('mg.topupDelete')}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
