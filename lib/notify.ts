// Centralised notification dispatch: journal row(s) + APNs push, honoring per-user prefs.
//
// Используется из /api/notify (события из приложения) и из cron (напоминания о сменах).
// Получатели задаются «аудиторией»: конкретные сотрудники, владелец, и/или все менеджеры.

import { createHash } from 'node:crypto'
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
  salary_payout_reminder: 'salary_payout',
  // G4 (аудит 2026-08-15): раньше без записи здесь — фолбэк `prefKey ? ... : true` пропускал
  // их мимо проверки пользовательских настроек, шли ВСЕГДА независимо от prefs. Ключи (пока)
  // не выведены тумблером в NotificationSettings (app/people/tabs-salary.tsx) — как и booking/
  // news выше, это тот же паттерн: без строки в notification_prefs.prefs поведение не меняется
  // (undefined !== false → включено), запись здесь просто делает систему честной на будущее,
  // когда тумблер появится.
  audit: 'audit',
  audit_close_reminder: 'audit_close_reminder',
  violation: 'violation',
}

export interface Audience { staff_ids?: string[]; owner?: boolean; managers?: boolean; all?: boolean }

export interface NotifyInput {
  type: string
  /** Internal booking event identity, stable across lease retries; never a lease token. */
  eventKey?: string
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

// UUIDv8: deterministic SHA-256 identity for a tenant/event/recipient journal entry.
// Ignoring duplicate IDs preserves the original sent_at/read_at on a retried event.
function bookingJournalId(eventKey: string, rid: string, recipient: Recipient): string {
  const bytes = createHash('sha256').update(JSON.stringify(['booking-notification-v1', rid, eventKey,
    recipient.to_owner ? 'owner' : recipient.staff_id])).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// admin — supabase service-role клиент (тип any, чтобы не тащить зависимость в сигнатуру).
export async function dispatchNotification(admin: any, rid: string, input: NotifyInput): Promise<{ inserted: number; push: number }> {
  const { eventKey, type, title, body = '', titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data = {}, audience } = input

  if (eventKey !== undefined && (type !== 'booking' || typeof eventKey !== 'string' || !eventKey.trim() || eventKey.length > 200)) {
    throw new Error('Invalid booking notification event key')
  }

  // 1. Получатели
  const recipients: Recipient[] = []
  if (audience.owner || audience.managers || audience.all) recipients.push({ staff_id: null, to_owner: true })

  const staffSet = new Set<string>(audience.staff_ids || [])
  if (audience.all) {
    const { data: all, error: staffError } = await admin.from('staff')
      .select('id').eq('restaurant_id', rid).eq('is_active', true)
    if (eventKey && (staffError || !Array.isArray(all))) throw new Error('Booking notification recipients could not be read')
    ;(all || []).forEach((s: any) => staffSet.add(s.id))
  } else if (audience.managers) {
    // "managers" = у кого есть доступ к приложению Manager (staff.apps), а не должность
    // (role) — доступ к приложениям выдаётся отдельно от цеха/должности сотрудника.
    const { data: staff, error: staffError } = await admin.from('staff')
      .select('id, apps').eq('restaurant_id', rid).eq('is_active', true)
    if (eventKey && (staffError || !Array.isArray(staff))) throw new Error('Booking notification recipients could not be read')
    ;(staff || []).forEach((s: any) => { if (Array.isArray(s.apps) && s.apps.includes('manager')) staffSet.add(s.id) })
  }
  staffSet.forEach(id => recipients.push({ staff_id: id, to_owner: false }))
  if (!recipients.length) return { inserted: 0, push: 0 }

  // 2. Персональные настройки
  const { data: prefRows, error: prefsError } = await admin.from('notification_prefs')
    .select('staff_id, to_owner, prefs').eq('restaurant_id', rid)
  if (eventKey && (prefsError || !Array.isArray(prefRows))) throw new Error('Booking notification preferences could not be read')
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
  // клиентам (веб-колокольчик, iOS-журнал) перерендерить текст на языке ЗРИТЕЛЯ при показе.
  // Сегменты (в т.ч. секьюрные суммы кассы, ревью Г3) едут в журнал конвенцией
  // body_key='_segments' + body_params={segments} — jsonb, миграция не нужна; лейблы
  // переводятся при показе, суммы остаются отформатированными строками.
  const now = new Date().toISOString()
  const enTitle = titleKey ? renderNotify('en', titleKey, resolveParams('en', titleParams)) : title
  const rows = allowed.map(r => {
    const segs = isSecure(r) ? (secureBodySegments ?? null) : (bodySegments ?? null)
    const usesTemplate = !isSecure(r) && !!bodyKey && !segs
    return {
      ...(eventKey ? { id: bookingJournalId(eventKey, rid, r) } : {}),
      restaurant_id: rid, staff_id: r.staff_id, to_owner: r.to_owner,
      type, title: enTitle, body: bodyFor(r, 'en'),
      data, sent_at: now,
      title_key: titleKey ?? null, title_params: titleParams ?? null,
      body_key: segs ? '_segments' : (usesTemplate ? bodyKey! : null),
      body_params: segs ? { segments: segs } : (usesTemplate ? (bodyParams ?? null) : null),
    }
  })
  let inserted = rows.length
  let insertedJournalIds: Set<string> | null = null
  if (eventKey) {
    const { data: insertedRows, error: journalError } = await admin.from('notifications')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id')
    if (journalError || !Array.isArray(insertedRows)) throw new Error('Booking notification journal could not be saved')
    inserted = insertedRows.length
    insertedJournalIds = new Set(insertedRows.map((row: { id: string }) => row.id))
  } else {
    await admin.from('notifications').insert(rows)
  }

  // 4. Push — рендерим per-recipient НА ЯЗЫКЕ УСТРОЙСТВА (push_subscriptions.lang), не отправителя.
  // Durable booking delivery means a journal row, not exactly-once APNs delivery.
  // After that commit, push failures must not turn the event back into a failed write.
  let pushed = 0
  try {
    const { data: subs } = await admin.from('push_subscriptions')
      .select('staff_id, to_owner, device_token, lang').eq('restaurant_id', rid).not('device_token', 'is', null)
    const subsFor = (r: Recipient) =>
      (subs || []).filter((s: any) => r.to_owner ? s.to_owner : s.staff_id === r.staff_id)

    const invalid: string[] = []
    for (const r of allowed) {
      // Only a freshly inserted journal entry permits a booking push attempt. A lease
      // completion retry must not resend pushes for already durable recipient rows.
      if (eventKey && !insertedJournalIds?.has(bookingJournalId(eventKey, rid, r))) continue
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
        // type в data явно — iOS читает его из userInfo при тапе по системному пушу
        // (PushManager.didReceive response:), чтобы открыть нужный модуль/вкладку.
        const res = await sendPush(tokens, { title: pTitle, body: pBody, data: { ...data, type } })
        pushed += res.sent
        invalid.push(...res.invalid)
      }
    }
    if (invalid.length) {
      await admin.from('push_subscriptions').delete().eq('restaurant_id', rid).in('device_token', invalid)
    }
  } catch (error) {
    if (!eventKey) throw error
  }

  return { inserted, push: pushed }
}
