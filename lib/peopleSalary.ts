// Личный расчёт зарплаты (People→Зарплата) на сервере — аудит People 2026-11-14.
//
// Раньше клиент сам тянул employees/авансы/выплаты ВСЕГО ресторана и выбирал строку по
// имени: (1) зарплаты коллег уходили на устройство, (2) однофамильцы видели чужую сумму,
// (3) сбой любого подзапроса молча превращался в ноль, (4) открытый ЗП-долг показывался
// как «Выплачено». Теперь сервер находит сотрудника по staff.employee_id и возвращает только
// его строку; любой сбой — ошибка, а не нули.

import { resolveEmployeesForMonth, type SalaryHistoryRow } from '@/lib/salaryHistory'

export type PersonalSalaryInput = {
  employee: { id: string; name: string; salary: number | null; deduct_per_absence: number | null }
  history: SalaryHistoryRow[]
  absences: { date: string; source?: string | null }[]
  cardAmount: number | null
  advances: { id?: string; amount: number | null; date?: string | null; note?: string | null; period?: string | null }[]
  payments: { amount: number | null; method?: string | null; paid_at?: string | null }[]
  openDebt: number
  attendance: { check_in_at: string | null; check_out_at: string | null }[]
  monthStart: string
}

export type PersonalSalary = {
  id: string; name: string; salary: number; dates: string[]; absences: number; deduct: number
  card: number; advance: number; advances: PersonalSalaryInput['advances']; paid: number
  total: number; cash: number; remaining: number; openDebt: number; lastPaidAt: string | null; hours: number
  /** paid | debt | partial | unpaid | none — статус выплаты считает сервер, клиенты только рисуют. */
  status: 'paid' | 'debt' | 'partial' | 'unpaid' | 'none'
}

const num = (v: unknown) => Number(v || 0)

export function computePersonalSalary(i: PersonalSalaryInput): PersonalSalary {
  const [e] = resolveEmployeesForMonth([{ ...i.employee, salary: num(i.employee.salary), deduct_per_absence: num(i.employee.deduct_per_absence) }], i.history, i.monthStart)
  const salary = num(e.salary)
  // Авто-прогулы (source='auto', черновики крона) деньги не удерживают — канон 2026-07-17.
  const dates = i.absences.filter(a => a.source !== 'auto').map(a => a.date).sort()
  const deduct = dates.length * num(e.deduct_per_absence)
  const card = num(i.cardAmount)
  const advance = i.advances.reduce((s, a) => s + num(a.amount), 0)
  const paid = i.payments.reduce((s, p) => s + num(p.amount), 0)
  const paidCash = i.payments.filter(p => (p.method || 'cash') === 'cash').reduce((s, p) => s + num(p.amount), 0)
  const lastPaidAt = i.payments.map(p => p.paid_at || '').filter(Boolean).sort().pop() || null
  const total = Math.max(0, salary - deduct)
  const cash = Math.max(0, total - advance - card)
  const openDebt = Math.max(0, i.openDebt)
  const remaining = Math.max(0, cash - paidCash - openDebt)
  const hours = i.attendance.reduce((s, r) => {
    if (!r.check_in_at || !r.check_out_at) return s
    const h = (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3_600_000
    return h > 0 && h < 24 ? s + h : s
  }, 0)
  // Открытый ЗП-долг — обещание, а не выплата: «Выплачено» только когда и остаток, и долг 0.
  const status: PersonalSalary['status'] = total <= 0 ? 'none'
    : remaining > 0 ? (remaining === total ? 'unpaid' : 'partial')
    : openDebt > 0 ? 'debt' : 'paid'
  return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, advance, advances: i.advances,
    paid, total, cash, remaining, openDebt, lastPaidAt, hours, status }
}

export function monthBounds(ym: string): { monthStart: string; monthEnd: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { monthStart: `${ym}-01`, monthEnd: `${ym}-${String(last).padStart(2, '0')}` }
}
