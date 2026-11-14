// Клиентские вызовы серверных People-эндпоинтов (аудит People 2026-11-14).
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), credentials: 'same-origin',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json?.data
}

/** Атомарная отметка одного пункта чек-листа/аудита; возвращает актуальный прогон. */
export function saveChecklistItem(p: {
  checklist_id: string; idx: number; item: Record<string, unknown>
  completion_id?: string | null; shift_id?: string | null; date?: string; attendance_id?: string | null
}): Promise<any> {
  return post('/api/people/checklist-item', p)
}

/** Утверждение обмена сменой (заявка + график одной операцией на сервере). */
export function approveSwap(id: string): Promise<any> {
  return post('/api/people/swap', { id })
}

/** Личный расчёт зарплаты за месяц YYYY-MM (только своя строка). */
export async function fetchMySalary(month: string): Promise<any | null> {
  const res = await fetch(`/api/people/salary?month=${encodeURIComponent(month)}`, { credentials: 'same-origin', cache: 'no-store' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json?.data ?? null
}
