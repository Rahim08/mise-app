// Client helper for triggering a notification via /api/notify.
// Best-effort: push не должен ломать основной сценарий, поэтому ошибки глотаем.

export interface NotifyAudience { staff_ids?: string[]; owner?: boolean; managers?: boolean }

export interface NotifyPayload {
  type: string
  title: string
  body?: string
  secureBody?: string
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
