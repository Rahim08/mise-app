// Backend audit trail for everything that touches money (cash register, inkassation, payroll).
//
// Two layers write into the same table, `financial_audit_log` (see
// docs/migrations/financial-audit-v2-2026-09-19.sql):
//   • DB triggers (source='db')  — exact before/after row image for EVERY insert/update/delete,
//     no matter who or what changed the row (gateway, RPC, SQL editor, cron). Cannot say WHO.
//   • This module (source='api') — called by the /api/db gateway after a successful write;
//     records WHO (owner account / staff member + role), from which app, and the row images.
// Join the two on (table_name, row_id, changed_at ±2s) to see "who changed what, when".
//
// Logging must never break a user action: every failure here is swallowed and console.error'd.

import type { Caller } from '@/lib/apiAuth'

// Money tables. Anything a manager/owner can edit that moves cash, payroll or the inkassation fund.
export const AUDITED_TABLES = new Set([
  'shifts', 'shift_expenses', 'shift_absences', 'inkassations', 'transactions',
  'salary_payments', 'salary_advances', 'salary_records', 'monthly_card_amounts',
  'employees', 'salary_history', 'expense_categories', 'restaurant_settings',
])

const MAX_ROWS_PER_REQUEST = 200

interface Actor {
  actor_type: 'owner' | 'staff' | 'admin_view'
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
}

async function resolveActor(admin: any, caller: Caller): Promise<Actor> {
  if (caller.via === 'admin_view') return { actor_type: 'admin_view', actor_id: null, actor_name: 'super-admin (view as client)', actor_role: 'admin' }
  if (caller.sid && caller.sid !== 'owner') {
    const { data } = await admin.from('staff').select('name, role').eq('id', caller.sid).eq('restaurant_id', caller.rid).single()
    return { actor_type: caller.owner ? 'owner' : 'staff', actor_id: caller.sid, actor_name: data?.name ?? null, actor_role: data?.role ?? null }
  }
  return { actor_type: 'owner', actor_id: caller.uid ?? null, actor_name: caller.email ?? (caller.sid === 'owner' ? 'owner (PIN)' : null), actor_role: 'owner' }
}

const asRows = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? [x] : [])
const sameJson = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)

interface WriteAudit {
  table: string
  op: 'insert' | 'update' | 'delete' | 'upsert'
  filters?: any
  oldRows?: any[]   // row images BEFORE the write (update/delete)
  newRows?: any[]   // row images AFTER the write (insert/update/upsert)
  app?: string      // which client app sent it, if known
}

export async function auditWrite(admin: any, caller: Caller, w: WriteAudit): Promise<void> {
  try {
    const actor = await resolveActor(admin, caller)
    const oldRows = (w.oldRows || []).slice(0, MAX_ROWS_PER_REQUEST)
    const newRows = (w.newRows || []).slice(0, MAX_ROWS_PER_REQUEST)
    const request = { filters: w.filters ?? null, apps: caller.apps, app: w.app ?? null }
    const rows: any[] = []

    if (w.op === 'delete') {
      for (const o of oldRows) rows.push({ row_id: o.id ?? null, old_data: o, new_data: null })
    } else if (w.op === 'insert') {
      for (const n of newRows) rows.push({ row_id: n.id ?? null, old_data: null, new_data: n })
    } else {
      for (const n of newRows) {
        const o = oldRows.find(x => x.id != null && x.id === n.id) ?? null
        if (o && sameJson(o, n)) continue // no-op save (autosave re-write) — nothing changed
        rows.push({ row_id: n.id ?? null, old_data: o, new_data: n })
      }
    }
    if (!rows.length) return

    const { error } = await admin.from('financial_audit_log').insert(rows.map(r => ({
      source: 'api',
      table_name: w.table,
      operation: w.op === 'upsert' ? (r.old_data ? 'UPDATE' : 'INSERT') : w.op.toUpperCase(),
      restaurant_id: caller.rid,
      ...r,
      ...actor,
      request,
    })))
    if (error) console.error('[financialAudit] insert failed:', error.message)
  } catch (err) {
    console.error('[financialAudit] threw:', err)
  }
}

export async function auditRpc(admin: any, caller: Caller, fn: string, args: any): Promise<void> {
  try {
    const actor = await resolveActor(admin, caller)
    const { error } = await admin.from('financial_audit_log').insert({
      source: 'api',
      table_name: `rpc:${fn}`,
      operation: 'RPC',
      restaurant_id: caller.rid,
      row_id: null,
      old_data: null,
      new_data: args ?? null,
      ...actor,
      request: { apps: caller.apps },
    })
    if (error) console.error('[financialAudit] rpc insert failed:', error.message)
  } catch (err) {
    console.error('[financialAudit] rpc threw:', err)
  }
}
