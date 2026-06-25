// Centralised notification dispatch: journal row(s) + APNs push, honoring per-user prefs.
//
// Используется из /api/notify (события из приложения) и из cron (напоминания о сменах).
// Получатели задаются «аудиторией»: конкретные сотрудники, владелец, и/или все менеджеры.

import { sendPush } from './apns'

// Тип уведомления → ключ в notification_prefs.prefs. Отсутствие ключа = включено.
const TYPE_PREF: Record<string, string> = {
  shift_reminder: 'shift_reminder',
  swap_request: 'swap',
  swap_result: 'swap',
  task: 'task',
  attendance: 'attendance',
  cash_open: 'cash_open',
  cash_close: 'cash_close',
  purchase: 'purchase',
}

export interface Audience { staff_ids?: string[]; owner?: boolean; managers?: boolean }

export interface NotifyInput {
  type: string
  title: string
  body?: string
  /** Вариант текста с суммой кассы — уйдёт только тем, у кого включён show_cash_amount. */
  secureBody?: string
  data?: Record<string, unknown>
  audience: Audience
}

interface Recipient { staff_id: string | null; to_owner: boolean }

// admin — supabase service-role клиент (тип any, чтобы не тащить зависимость в сигнатуру).
export async function dispatchNotification(admin: any, rid: string, input: NotifyInput): Promise<{ inserted: number; push: number }> {
  const { type, title, body = '', secureBody, data = {}, audience } = input

  // 1. Получатели
  const recipients: Recipient[] = []
  if (audience.owner || audience.managers) recipients.push({ staff_id: null, to_owner: true })

  const staffSet = new Set<string>(audience.staff_ids || [])
  if (audience.managers) {
    const { data: mgrs } = await admin.from('staff')
      .select('id').eq('restaurant_id', rid).eq('is_active', true).eq('role', 'manager')
    ;(mgrs || []).forEach((m: any) => staffSet.add(m.id))
  }
  staffSet.forEach(id => recipients.push({ staff_id: id, to_owner: false }))
  if (!recipients.length) return { inserted: 0, push: 0 }

  // 2. Персональные настройки
  const { data: prefRows } = await admin.from('notification_prefs')
    .select('staff_id, to_owner, prefs').eq('restaurant_id', rid)
  const prefsFor = (r: Recipient): Record<string, any> =>
    (prefRows || []).find((p: any) => r.to_owner ? p.to_owner : p.staff_id === r.staff_id)?.prefs || {}

  const prefKey = TYPE_PREF[type]
  const allowed = recipients.filter(r => {
    const p = prefsFor(r)
    return prefKey ? p[prefKey] !== false : true   // нет ключа → включено
  })
  if (!allowed.length) return { inserted: 0, push: 0 }

  // Текст для получателя (касса с суммой — только при show_cash_amount).
  const bodyFor = (r: Recipient) =>
    (secureBody && prefsFor(r).show_cash_amount === true) ? secureBody : body

  // 3. Журнал уведомлений
  const now = new Date().toISOString()
  const rows = allowed.map(r => ({
    restaurant_id: rid, staff_id: r.staff_id, to_owner: r.to_owner,
    type, title, body: bodyFor(r), data, sent_at: now,
  }))
  await admin.from('notifications').insert(rows)

  // 4. Push
  const { data: subs } = await admin.from('push_subscriptions')
    .select('staff_id, to_owner, device_token').eq('restaurant_id', rid).not('device_token', 'is', null)
  const tokensFor = (r: Recipient): string[] =>
    (subs || []).filter((s: any) => r.to_owner ? s.to_owner : s.staff_id === r.staff_id)
      .map((s: any) => s.device_token)

  let pushed = 0
  const invalid: string[] = []
  for (const r of allowed) {
    // Закуп: получатели в режиме «раз в день» push сейчас не получают (им шлёт дайджест cron);
    // запись в журнал у них уже есть — увидят в колокольчике.
    if (type === 'purchase' && prefsFor(r).purchase_digest === 'daily') continue
    const tokens = tokensFor(r)
    if (!tokens.length) continue
    const res = await sendPush(tokens, { title, body: bodyFor(r), data })
    pushed += res.sent
    invalid.push(...res.invalid)
  }
  if (invalid.length) {
    await admin.from('push_subscriptions').delete().eq('restaurant_id', rid).in('device_token', invalid)
  }

  return { inserted: rows.length, push: pushed }
}
