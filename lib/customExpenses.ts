/** One-off expenses are saved in the shift ledger, never in expense_categories. */
export type CustomExpenseDraft = { id: string; name: string; amount: string; unpaid?: boolean; note?: string }
export const normalizeExpenseName = (name: string) => name.trim().replace(/\s+/g, ' ')
export function parseExpenseCents(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null
  const [whole = '', fraction = ''] = text.split('.')
  const cents = Number(whole || 0) * 100 + Number(fraction.padEnd(2, '0') || 0)
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000_000 ? cents : null
}
export function prepareCustomExpenses(rows: CustomExpenseDraft[]) {
  return rows.flatMap(row => {
    const name = normalizeExpenseName(row.name)
    if (!name && !row.amount.trim()) return []
    const cents = parseExpenseCents(row.amount)
    if (!name || name.length > 120 || cents === null) throw new Error('custom_expense_invalid')
    return [{ id: row.id.toLowerCase(), category_name: name, amount: cents / 100, is_custom: true as const, is_paid: !row.unpaid, note: row.note || '' }]
  })
}
export function customExpenseTotal(rows: CustomExpenseDraft[]): number {
  return rows.reduce((sum, row) => sum + (row.unpaid ? 0 : (parseExpenseCents(row.amount) ?? 0)), 0) / 100
}

/** Validate custom ledger inserts at the gateway as well as in the client. */
export function customExpenseWriteError(values: unknown): boolean {
  return (Array.isArray(values) ? values : [values]).some(value => {
    if (!value || typeof value !== 'object') return false // generic gateway handles other payload errors
    const row = value as Record<string, unknown>
    if (row.is_custom != null && typeof row.is_custom !== 'boolean') return true
    if (row.is_custom !== true) return false
    if (row.category_id != null || row.employee_id != null || typeof row.category_name !== 'string') return true
    const name = normalizeExpenseName(row.category_name)
    if (!name || name.length > 120 || typeof row.amount !== 'number') return true
    return parseExpenseCents(String(row.amount)) === null
  })
}
