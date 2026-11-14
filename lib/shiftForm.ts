import { type CustomExpenseDraft } from './customExpenses'

// Разбор shift_expenses одной смены на «что показывает форма закрытия смены» и «что форма
// не трогает». Общий для app/manager/page.tsx и app/dashboard/(shell)/shifts/page.tsx
// (iOS — тот же алгоритм в ManagerView.swift splitShiftExpenses).
//
// Аудит 2026-09-27: раньше форма грузила строку с employee_id в empExtras[emp] (одно поле на
// сотрудника) и при сохранении удаляла ВСЕ старые строки смены, пересоздавая только то, что
// было в форме. Следствия, найденные на живых данных SO:
//  - ЗП-долг (note SALPERIOD:...) превращался в «Имя (экстра)» без метки — при погашении
//    salary_payments не писался, сотрудник оставался «не оплачен» (фантомные долги 31.08);
//  - две строки одного сотрудника/категории за день — оставалась одна, остальные удалялись;
//  - строки уволенных сотрудников и выключенных категорий удалялись без повторной вставки.
// Теперь форма «владеет» только тем, что может честно показать и пересоздать; остальное не
// удаляется, а его оплаченная часть входит в расход дня (unmanagedPaidTotal), как и раньше.

export const SALPERIOD_PREFIX = 'SALPERIOD:'

export type ShiftExpenseRow = {
  id: string
  is_custom?: boolean | null
  category_name?: string | null
  category_id?: string | null
  employee_id?: string | null
  amount?: number | string | null
  note?: string | null
  is_paid?: boolean | null
  paid_shift_id?: string | null
}

export type ShiftFormSplit = {
  customExpenses: CustomExpenseDraft[]
  catAmounts: Record<string, string>
  catNotes: Record<string, string>
  catUnpaid: Record<string, boolean>
  empExtras: Record<string, string>
  empUnpaid: Record<string, boolean>
  /** Строки, которые форма пересоздаёт при сохранении (их и только их можно удалять). */
  ownedIds: string[]
  /** Оплаченные строки вне формы (уволенный сотрудник, выключенная категория, …) — в расход дня. */
  unmanagedPaidTotal: number
  /** Погашения долгов, сделанные ЭТОЙ сменой (paid_shift_id == shiftId) — в расход дня. */
  settledTodayTotal: number
}

/** Деньги — до центов, без float-хвостов вида 482.49999999999864. */
export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

const numStr = (v: number) => String(round2(v))

export function splitShiftExpenses(
  rows: ShiftExpenseRow[],
  shiftId: string,
  activeCategoryIds: Set<string>,
  activeEmployeeIds: Set<string>,
  includeCustom = false,
): ShiftFormSplit {
  const out: ShiftFormSplit = {
    customExpenses: [], catAmounts: {}, catNotes: {}, catUnpaid: {}, empExtras: {}, empUnpaid: {},
    ownedIds: [], unmanagedPaidTotal: 0, settledTodayTotal: 0,
  }
  const sums: Record<string, number> = {}
  const unpaidByKey: Record<string, boolean> = {}
  for (const e of rows) {
    const amount = Number(e.amount || 0)
    if (e.paid_shift_id) {
      if (e.paid_shift_id === shiftId) out.settledTodayTotal += amount
      continue // историческая пометка «долг был здесь» — не считается и не трогается
    }
    const unpaid = e.is_paid === false
    const isSalaryDebt = !!e.note && e.note.startsWith(SALPERIOD_PREFIX)
    if (e.is_custom === true) {
      if (includeCustom && !isSalaryDebt && !e.category_id && !e.employee_id && e.category_name?.trim()) {
        out.customExpenses.push({ id: e.id, name: e.category_name, amount: numStr(amount), unpaid, note: e.note || '' })
        out.ownedIds.push(e.id)
      } else if (!unpaid) out.unmanagedPaidTotal += amount
      continue
    }
    const key = isSalaryDebt ? null
      : e.employee_id ? (activeEmployeeIds.has(e.employee_id) ? `e:${e.employee_id}` : null)
      : e.category_id ? (activeCategoryIds.has(e.category_id) ? `c:${e.category_id}` : null)
      : null
    // Смешанные «оплачено»/«в долг» на одном ключе — форма хранит один флаг: строки другого
    // статуса остаются вне формы (не удаляются), а не перекрашиваются молча.
    if (key && (unpaidByKey[key] === undefined || unpaidByKey[key] === unpaid)) {
      unpaidByKey[key] = unpaid
      sums[key] = (sums[key] || 0) + amount
      out.ownedIds.push(e.id)
      if (key.startsWith('c:') && e.note && !out.catNotes[key.slice(2)]) out.catNotes[key.slice(2)] = e.note
      continue
    }
    if (!unpaid) out.unmanagedPaidTotal += amount
  }
  for (const [key, sum] of Object.entries(sums)) {
    const id = key.slice(2)
    if (key.startsWith('e:')) {
      out.empExtras[id] = numStr(sum)
      if (unpaidByKey[key]) out.empUnpaid[id] = true
    } else {
      out.catAmounts[id] = numStr(sum)
      if (unpaidByKey[key]) out.catUnpaid[id] = true
    }
  }
  out.unmanagedPaidTotal = round2(out.unmanagedPaidTotal)
  out.settledTodayTotal = round2(out.settledTodayTotal)
  return out
}
