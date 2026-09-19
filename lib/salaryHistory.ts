// Расчёт зарплаты за конкретный месяц должен использовать оклад, который ДЕЙСТВОВАЛ в тот
// месяц, а не текущее значение employees.salary — иначе правка оклада задним числом меняет
// начисление за все прошлые месяцы (и может материализовать фиктивный долг в
// manager/tabs-salary.tsx syncLedger). См. docs/migrations/salary-history-2026-09.sql.

export type SalaryHistoryRow = {
  employee_id: string
  salary: number | string
  deduct_per_absence: number | string
  effective_from: string
}

// Последняя запись истории с effective_from <= начало месяца; null, если истории ещё нет
// (сотрудник без единой правки оклада после введения фичи — вызывающий код должен сам
// сделать fallback на employees.salary/deduct_per_absence).
export function resolveSalaryFor(
  history: SalaryHistoryRow[],
  employeeId: string,
  monthStart: string
): { salary: number; deduct_per_absence: number } | null {
  let best: SalaryHistoryRow | null = null
  for (const h of history) {
    if (h.employee_id !== employeeId) continue
    if (h.effective_from > monthStart) continue
    if (!best || h.effective_from > best.effective_from) best = h
  }
  return best ? { salary: Number(best.salary || 0), deduct_per_absence: Number(best.deduct_per_absence || 0) } : null
}

// Возвращает копию employees с salary/deduct_per_absence, подставленными из истории за
// monthStart (первое число месяца). Сотрудники без истории на этот месяц остаются как есть
// (текущее значение) — это и есть fallback для месяцев до введения фичи.
export function resolveEmployeesForMonth<T extends { id: string; salary?: number; deduct_per_absence?: number }>(
  employees: T[],
  history: SalaryHistoryRow[],
  monthStart: string
): T[] {
  return employees.map(e => {
    const r = resolveSalaryFor(history, e.id, monthStart)
    return r ? { ...e, salary: r.salary, deduct_per_absence: r.deduct_per_absence } : e
  })
}
