// Centralised notification dispatch: journal row(s) + APNs push, honoring per-user prefs.
//
// Используется из /api/notify (события из приложения) и из cron (напоминания о сменах).
// Получатели задаются «аудиторией»: конкретные сотрудники, владелец, и/или все менеджеры.

import { sendPush } from './apns'
import { renderNotify, renderCategory, renderSegments } from './notifyStrings'

// Заготовка (закуп): {category} в titleParams приходит как СЫРОЙ код цеха (kitchen/bar/…),
// а не готовый лейбл — иначе он бы прибивался к языку отправителя. Резолвим per-lang здесь.
function resolveParams(lang: string, params?: Record<string, string | number>) {
  if (!params || !('category' in params)) return params
  return { ...params, category: renderCategory(lang, String(params.category)) }
}

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
  booking: 'booking',
  news: 'news',
}

export interface Audience { staff_ids?: string[]; owner?: boolean; managers?: boolean; all?: boolean }

export interface NotifyInput {
  type: string
  /** Литерал-фолбэк: язык отправителя. Используется только если *Key не задан (старые
   *  клиенты) или для типов без шаблона (news/booking — свободный пользовательский текст). */
  title: string
  body?: string
  /** Если задан — реальный текст рендерится СЕРВЕРОМ на языке получателя (push_subscriptions.lang),
   *  см. lib/notifyStrings.ts. title/body выше в этом случае используются только как EN-фолбэк
   *  для записи в notifications (журнал) и как safety-net, если lang получателя неизвестен. */
  titleKey?: string
  titleParams?: Record<string, string | number>
  bodyKey?: string
  bodyParams?: Record<string, string | number>
  /** Составное тело из разнородных частей (напр. бронь: «Имя · 4 · 19:00 · Стол 12») —
   *  часть с key переводится, без key — идёт как есть (имя, число, время). Приоритетнее bodyKey. */
  bodySegments?: { key?: string; value: string; sep?: string }[]
  /** Вариант текста с суммой кассы — уйдёт только тем, у кого включён show_cash_amount.
   *  Литерал-фолбэк (язык отправителя), реальный рендер — через secureBodySegments. */
  secureBody?: string
  /** Составные сегменты дайджеста (напр. «Выручка €120 · Касса €80») — каждый лейбл
   *  переводится СЕРВЕРОМ на язык получателя, value (уже отформатированная сумма) — как есть. */
  secureBodySegments?: { key?: string; value: string; sep?: string }[]
  data?: Record<string, unknown>
  audience: Audience
}

interface Recipient { staff_id: string | null; to_owner: boolean }

// admin — supabase service-role клиент (тип any, чтобы не тащить зависимость в сигнатуру).
export async function dispatchNotification(admin: any, rid: string, input: NotifyInput): Promise<{ inserted: number; push: number }> {
  const { type, title, body = '', titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data = {}, audience } = input

  // 1. Получатели
  const recipients: Recipient[] = []
  if (audience.owner || audience.managers || audience.all) recipients.push({ staff_id: null, to_owner: true })

  const staffSet = new Set<string>(audience.staff_ids || [])
  if (audience.all) {
    const { data: all } = await admin.from('staff')
      .select('id').eq('restaurant_id', rid).eq('is_active', true)
    ;(all || []).forEach((s: any) => staffSet.add(s.id))
  } else if (audience.managers) {
    // "managers" = у кого есть доступ к приложению Manager (staff.apps), а не должность
    // (role) — доступ к приложениям выдаётся отдельно от цеха/должности сотрудника.
    const { data: staff } = await admin.from('staff')
      .select('id, apps').eq('restaurant_id', rid).eq('is_active', true)
    ;(staff || []).forEach((s: any) => { if (Array.isArray(s.apps) && s.apps.includes('manager')) staffSet.add(s.id) })
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

  // Текст для получателя. «Секьюрная» ветка (касса с суммами — только у show_cash_amount)
  // рендерится из secureBodySegments НА ЯЗЫКЕ lang; обычная — из bodyKey/bodyParams либо
  // литерал-фолбэка (news/booking-тело/старые клиенты — там шаблона нет).
  const isSecure = (r: Recipient) => !!secureBody && prefsFor(r).show_cash_amount === true
  const bodyFor = (r: Recipient, lang: string) => {
    if (isSecure(r)) return secureBodySegments ? renderSegments(lang, secureBodySegments) : secureBody!
    if (bodySegments) return renderSegments(lang, bodySegments)
    return bodyKey ? renderNotify(lang, bodyKey, bodyParams) : body
  }

  // 3. Журнал уведомлений. title/body — EN-рендер (если задан *Key/сегменты) или литерал-фолбэк —
  // на случай, если запись читает старый клиент/cron/дебаг. *_key/*_params позволяют
  // веб-колокольчику (NotificationsTab) перерендерить текст на языке ЗРИТЕЛЯ при показе,
  // а не отправителя (секьюрные сегменты в этот механизм пока не заведены — сумма кассы
  // в журнале хранится EN-рендером, без live-перевода на клиенте).
  const now = new Date().toISOString()
  const enTitle = titleKey ? renderNotify('en', titleKey, resolveParams('en', titleParams)) : title
  const rows = allowed.map(r => {
    const usesTemplate = !isSecure(r) && !!bodyKey
    return {
      restaurant_id: rid, staff_id: r.staff_id, to_owner: r.to_owner,
      type, title: enTitle, body: bodyFor(r, 'en'),
      data, sent_at: now,
      title_key: titleKey ?? null, title_params: titleParams ?? null,
      body_key: usesTemplate ? bodyKey! : null, body_params: usesTemplate ? (bodyParams ?? null) : null,
    }
  })
  await admin.from('notifications').insert(rows)

  // 4. Push — рендерим per-recipient НА ЯЗЫКЕ УСТРОЙСТВА (push_subscriptions.lang), не отправителя.
  const { data: subs } = await admin.from('push_subscriptions')
    .select('staff_id, to_owner, device_token, lang').eq('restaurant_id', rid).not('device_token', 'is', null)
  const subsFor = (r: Recipient) =>
    (subs || []).filter((s: any) => r.to_owner ? s.to_owner : s.staff_id === r.staff_id)

  let pushed = 0
  const invalid: string[] = []
  for (const r of allowed) {
    // Закуп: получатели в режиме «раз в день» push сейчас не получают (им шлёт дайджест cron);
    // запись в журнал у них уже есть — увидят в колокольчике. Сам дайджест (data.digest)
    // адресован именно им — его не глушим.
    if (type === 'purchase' && !data.digest && prefsFor(r).purchase_digest === 'daily') continue
    const recSubs = subsFor(r)
    if (!recSubs.length) continue
    // Группируем токены по языку устройства — одному получателю с 2 устройствами на
    // разных языках каждое получит свой рендер.
    const byLang = new Map<string, string[]>()
    for (const s of recSubs) {
      const lang = (s.lang as string) || 'en'
      if (!byLang.has(lang)) byLang.set(lang, [])
      byLang.get(lang)!.push(s.device_token)
    }
    for (const [lang, tokens] of byLang) {
      const pTitle = titleKey ? renderNotify(lang, titleKey, resolveParams(lang, titleParams)) : title
      const pBody = bodyFor(r, lang)
      const res = await sendPush(tokens, { title: pTitle, body: pBody, data })
      pushed += res.sent
      invalid.push(...res.invalid)
    }
  }
  if (invalid.length) {
    await admin.from('push_subscriptions').delete().eq('restaurant_id', rid).in('device_token', invalid)
  }

  return { inserted: rows.length, push: pushed }
}
