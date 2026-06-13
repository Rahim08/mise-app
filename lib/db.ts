// Client helper for the authenticated data gateway (/api/db).
//
// Mirrors a subset of the Supabase query builder so migrating screens off direct anon
// access is mechanical:
//
//   supabase.from('shifts').select('*').eq('restaurant_id', rid).order('date')
//   →  db.from('shifts').select('*').eq('restaurant_id', rid).order('date')
//
// Returns { data, error } just like supabase-js. restaurant scoping is enforced server-side,
// so any restaurant_id filter passed here is redundant (harmless).

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'like' | 'ilike'
type Result<T = any> = { data: T; error: { message: string; code?: string } | null }

class Query<T = any> implements PromiseLike<Result<T>> {
  private table: string
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private columns = '*'
  private values: any = undefined
  private filters: { col: string; op: FilterOp; val: any }[] = []
  private orderBy: { col: string; ascending: boolean }[] = []
  private limitN: number | undefined
  private returning: 'many' | 'single' | 'maybeSingle' | undefined
  private onConflict: string | undefined
  private wantsReturn = false

  constructor(table: string) { this.table = table }

  select(columns = '*') {
    if (this.op === 'select') this.columns = columns
    else { this.wantsReturn = true; this.returning = 'many' }
    return this
  }
  insert(values: any) { this.op = 'insert'; this.values = values; return this }
  update(values: any) { this.op = 'update'; this.values = values; return this }
  upsert(values: any, opts?: { onConflict?: string }) { this.op = 'upsert'; this.values = values; this.onConflict = opts?.onConflict; this.wantsReturn = false; return this }
  delete() { this.op = 'delete'; return this }

  private addFilter(op: FilterOp, col: string, val: any) { this.filters.push({ col, op, val }); return this }
  eq(col: string, val: any) { return this.addFilter('eq', col, val) }
  neq(col: string, val: any) { return this.addFilter('neq', col, val) }
  gt(col: string, val: any) { return this.addFilter('gt', col, val) }
  gte(col: string, val: any) { return this.addFilter('gte', col, val) }
  lt(col: string, val: any) { return this.addFilter('lt', col, val) }
  lte(col: string, val: any) { return this.addFilter('lte', col, val) }
  in(col: string, val: any[]) { return this.addFilter('in', col, val) }
  is(col: string, val: any) { return this.addFilter('is', col, val) }
  like(col: string, val: any) { return this.addFilter('like', col, val) }
  ilike(col: string, val: any) { return this.addFilter('ilike', col, val) }

  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, ascending: opts?.ascending !== false }); return this }
  limit(n: number) { this.limitN = n; return this }

  single(): Promise<Result<T>> { this.returning = 'single'; this.wantsReturn = true; return this.exec() }
  maybeSingle(): Promise<Result<T>> { this.returning = 'maybeSingle'; this.wantsReturn = true; return this.exec() }

  private async exec(): Promise<Result<T>> {
    const payload: any = { table: this.table, op: this.op }
    if (this.op === 'select') {
      payload.columns = this.columns
      payload.returning = this.returning
    } else {
      payload.values = this.values
      if (this.onConflict) payload.onConflict = this.onConflict
      if (this.wantsReturn) payload.returning = this.returning || 'many'
    }
    if (this.filters.length) payload.filters = this.filters
    if (this.orderBy.length) payload.order = this.orderBy
    if (this.limitN) payload.limit = this.limitN

    // Сетевая устойчивость: короткие просадки wi-fi переживаем повтором.
    // ВАЖНО: ретраим только идемпотентные операции (select/update/delete). insert/upsert НЕ ретраим —
    // запрос мог дойти и выполниться, а ответ потеряться → повтор создал бы дубль (двойная запись денег).
    const idempotent = this.op === 'select' || this.op === 'update' || this.op === 'delete'
    const maxAttempts = idempotent ? 3 : 1
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'same-origin',
        })
        const json = await res.json()
        if (!res.ok) return { data: null as any, error: { message: json?.error || `HTTP ${res.status}`, code: json?.code } }
        return { data: json.data as T, error: null }
      } catch (err: any) {
        // Только сетевой сбой (fetch бросил). HTTP-ошибки выше не ретраятся.
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1))) // 0.5s, 1s
          continue
        }
        return { data: null as any, error: { message: err?.message || 'Network error' } }
      }
    }
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected)
  }
}

export const db = {
  from(table: string) { return new Query(table) },
}
