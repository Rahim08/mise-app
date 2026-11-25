// Сохранение смены одной операцией базы (docs/migrations/shift-save-atomic-2026-11-25.sql).
// Общее для app/manager и dashboard/shifts; iOS — ShiftForm.swift + ManagerView.persistOnce.
import type { ShiftExpenseRow } from './shiftForm'

export type ShiftSavePayload = {
  expected: { income: number; income_card: number; inkassation: number }
  income: number; income_card: number; inkassation: number
  /** Все строки смены, какими их видела форма: появилась новая или изменилась — отказ. */
  seen: ShiftExpenseRow[]
  /** Строки формы: их база заменяет на rows + custom. */
  replace_ids: string[]
  rows: { category_id?: string; employee_id?: string; amount: number; note?: string; unpaid: boolean }[]
  custom: { id: string; name: string; amount: number; unpaid: boolean; note: string }[]
  debts: Record<string, unknown>[]
  ink_expense_delta: number; ink_reason: string; ink_loaded_reason: string
}

export type ShiftSaveResult = {
  opening_balance: number; total_expense: number; closing_balance: number
  rows: ShiftExpenseRow[]
  ink: { expense: number | null; reason: string | null } | null
}

export type SaveAttempt = { key: string; opId: string } | null

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

/**
 * Повтор той же формы после потерянного ответа идёт с тем же op_id — база вернёт уже
 * применённый результат. Изменённая форма — новая операция.
 */
export async function saveShiftAtomic(db: Rpc, attempt: { current: SaveAttempt }, shiftId: string, payload: ShiftSavePayload) {
  const key = JSON.stringify([shiftId, payload])
  if (attempt.current?.key !== key) attempt.current = { key, opId: crypto.randomUUID() }
  const { data, error } = await db.rpc('save_shift', { p_shift_id: shiftId, p: { ...payload, op_id: attempt.current.opId } })
  if (!error) attempt.current = null
  return { result: data as ShiftSaveResult, error }
}
