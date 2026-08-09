// Client helper for triggering a notification via /api/notify.
// Best-effort: push не должен ломать основной сценарий, поэтому ошибки глотаем.

export interface NotifyAudience { staff_ids?: string[]; owner?: boolean; managers?: boolean; all?: boolean }

export interface NotifyPayload {
  type: string
  title: string
  body?: string
  /** Если задан — сервер рендерит текст на языке КАЖДОГО получателя вместо title/body
   *  выше (те остаются лишь EN-фолбэком). См. lib/notifyStrings.ts на сервере. */
  titleKey?: string
  titleParams?: Record<string, string | number>
  bodyKey?: string
  bodyParams?: Record<string, string | number>
  bodySegments?: { key?: string; value: string; sep?: string }[]
  secureBody?: string
  /** Сегменты дайджеста (напр. касса с суммами) — лейбл каждого переводится сервером на
   *  язык получателя, value (готовая сумма) — как есть. См. lib/notifyStrings.ts. */
  secureBodySegments?: { key?: string; value: string; sep?: string }[]
  data?: Record<string, unknown>
  audience: NotifyAudience
}

export async function notify(input: NotifyPayload): Promise<void> {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'same-origin',
    })
  } catch { /* best-effort */ }
}
