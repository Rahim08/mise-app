'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { normalizeExpenseName, type CustomExpenseDraft } from '@/lib/customExpenses'

type ExpenseTheme = { surface: string; text: string; text3: string; sep2: string; fill: string; blue: string; red: string; orange: string }
const dashboardTheme: ExpenseTheme = {
  surface: 'var(--surface)', text: 'var(--tx)', text3: 'var(--tx3)', sep2: 'var(--sep-c)',
  fill: 'var(--fill)', blue: 'var(--accent)', red: 'var(--danger)', orange: 'var(--warn)',
}
type Props = {
  rows: CustomExpenseDraft[]
  onChange: (rows: CustomExpenseDraft[]) => void
  restaurantId: string
  contextKey: string
  disabled?: boolean
  theme?: ExpenseTheme
}

export function CustomExpenseFields({ rows, onChange, restaurantId, contextKey, disabled = false, theme = dashboardTheme }: Props) {
  const { t: tr } = useI18n()
  const [focusId, setFocusId] = useState<string | null>(null)
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {rows.map((row, index) => (
        <CustomExpenseRow key={row.id} row={row} index={index} restaurantId={restaurantId} contextKey={contextKey}
          disabled={disabled} theme={theme} autoFocus={focusId === row.id}
          onChange={next => onChange(rows.map(value => value.id === row.id ? next : value))}
          onRemove={() => onChange(rows.filter(value => value.id !== row.id))} />
      ))}
      <button type="button" onClick={() => {
        const id = crypto.randomUUID()
        onChange([...rows, { id, name: '', amount: '' }])
        setFocusId(id)
      }} style={{ minHeight: 44, border: 0, borderRadius: 10, background: 'transparent', color: theme.blue,
        font: 'inherit', fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', padding: '8px 4px' }}>
        <span aria-hidden="true">＋ </span>{tr('mg.addExpense')}
      </button>
    </fieldset>
  )
}

function CustomExpenseRow({ row, index, restaurantId, contextKey, disabled, theme, autoFocus, onChange, onRemove }: {
  row: CustomExpenseDraft; index: number; restaurantId: string; contextKey: string; disabled: boolean
  theme: ExpenseTheme; autoFocus: boolean; onChange: (row: CustomExpenseDraft) => void; onRemove: () => void
}) {
  const { t: tr } = useI18n()
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const [result, setResult] = useState<{ key: string; names: string[] } | null>(null)
  const prefix = normalizeExpenseName(row.name)
  // Results belong to an exact tenant, day and query. Old responses cannot reopen a new list.
  const queryKey = JSON.stringify([restaurantId, contextKey, prefix])
  useEffect(() => {
    if (!focused || disabled || !restaurantId || !prefix) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await db.rpc<{ name: string }[]>('shift_expense_name_suggestions', { p_prefix: prefix })
        if (cancelled) return
        setResult({ key: queryKey, names: error ? [] : (data || []).map(value => value.name).filter(name => typeof name === 'string').slice(0, 20) })
      } catch {
        if (!cancelled) setResult({ key: queryKey, names: [] })
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [focused, disabled, restaurantId, prefix, queryKey])
  const suggestions = focused && !disabled && result?.key === queryKey ? result.names : []
  const selected = Math.min(active, Math.max(0, suggestions.length - 1))
  const choose = (name: string) => { onChange({ ...row, name }); setFocused(false); setActive(0) }
  const input: CSSProperties = { width: '100%', minWidth: 0, minHeight: 44, padding: '9px 11px', borderRadius: 10,
    border: `1px solid ${theme.sep2}`, background: theme.fill, color: theme.text, font: 'inherit', fontSize: 14, boxSizing: 'border-box' }
  const label: CSSProperties = { display: 'block', color: theme.text3, fontSize: 12, marginBottom: 5 }
  const iconButton: CSSProperties = { width: 44, height: 44, padding: 0, flexShrink: 0, border: 0, borderRadius: 10,
    background: 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
  return (
    <div style={{ padding: '12px 0', borderBottom: `1px solid ${theme.sep2}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 100px', minWidth: 0, position: 'relative' }}>
          <label htmlFor={`${id}-name`} style={label}>{tr('mg.expenseName')}</label>
          <input id={`${id}-name`} value={row.name} maxLength={120} autoComplete="off" autoFocus={autoFocus}
            role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
            aria-controls={suggestions.length ? `${id}-list` : undefined}
            aria-activedescendant={suggestions.length ? `${id}-option-${selected}` : undefined}
            onChange={event => { onChange({ ...row, name: event.target.value }); setFocused(true); setActive(0) }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={event => {
              if (event.key === 'Escape') { setFocused(false); return }
              if (!suggestions.length) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
              } else if (event.key === 'Enter') { event.preventDefault(); choose(suggestions[selected]) }
            }} style={input} />
          {suggestions.length > 0 && (
            <ul id={`${id}-list`} role="listbox" aria-label={tr('mg.expenseHistory')}
              style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, listStyle: 'none', padding: 4, margin: '4px 0 0',
                background: theme.surface, border: `1px solid ${theme.sep2}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto' }}>
              {suggestions.map((name, optionIndex) => (
                <li key={`${name}-${optionIndex}`} role="option" id={`${id}-option-${optionIndex}`} aria-selected={selected === optionIndex}>
                  <button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(name)}
                    style={{ width: '100%', textAlign: 'left', minHeight: 44, border: 0, borderRadius: 7, padding: '8px 10px', color: theme.text,
                      font: 'inherit', fontSize: 14, cursor: 'pointer', background: selected === optionIndex ? theme.fill : 'transparent' }}>{name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ flex: '0 1 105px', minWidth: 80 }}>
          <label htmlFor={`${id}-amount`} style={label}>{tr('mg.expenseAmount')}</label>
          <input id={`${id}-amount`} value={row.amount} type="text" inputMode="decimal" placeholder="0.00"
            onChange={event => onChange({ ...row, amount: event.target.value })} style={{ ...input, textAlign: 'right' }} />
        </div>
        <button type="button" aria-label={`${tr('mg.debtToggle')} ${index + 1}`} title={tr('mg.debtToggle')} aria-pressed={!!row.unpaid}
          onClick={() => onChange({ ...row, unpaid: !row.unpaid })} style={{ ...iconButton, color: row.unpaid ? theme.orange : theme.text3 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></svg>
        </button>
        <button type="button" onClick={onRemove} aria-label={`${tr('mg.removeExpense')} ${index + 1}`} style={{ ...iconButton, color: theme.red }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
        </button>
      </div>
      {row.unpaid && <div style={{ fontSize: 12, color: theme.orange, marginTop: 6 }}>{tr('mg.onDebtShort')}</div>}
    </div>
  )
}
