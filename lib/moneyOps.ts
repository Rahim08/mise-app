// Денежные операции одной функцией базы (docs/migrations/*-atomic-2026-11-25.sql).
// iOS — те же функции в ManagerView.swift / ManagerSalary.swift.

export type OpAttempt = { key: string; opId: string } | null

/**
 * Повтор той же операции после потерянного ответа идёт с тем же op_id — база второй раз
 * ничего не запишет. Изменённая форма — новая операция. Сбросить после успеха.
 */
export function opIdFor(attempt: { current: OpAttempt }, key: string): string {
  if (attempt.current?.key !== key) attempt.current = { key, opId: crypto.randomUUID() }
  return attempt.current.opId
}

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

export async function runMoneyOp(db: Rpc, attempt: { current: OpAttempt }, fn: string, payload: Record<string, unknown>, opId?: (id: string) => Record<string, unknown>) {
  const id = opIdFor(attempt, JSON.stringify([fn, payload]))
  const { data, error } = await db.rpc(fn, { p: { ...payload, ...opId?.(id), op_id: id } })
  if (!error) attempt.current = null
  return { data, error }
}
