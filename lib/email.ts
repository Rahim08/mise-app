// Transactional email via Resend (https://resend.com).
//
// Zero-dependency: uses the REST API directly. Every function is a safe no-op when
// RESEND_API_KEY is unset, so wiring these calls into flows is harmless until the key
// is added in Vercel. Callers should still wrap in try/catch — email must never break
// a signup, payment or cron run.
//
// To activate: set RESEND_API_KEY and (optionally) MISE_EMAIL_FROM in Vercel.
// See docs/LAUNCH-READINESS.md.

const FROM = process.env.MISE_EMAIL_FROM || 'Mise <support@misesuite.com>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://misesuite.com'

interface SendArgs {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendArgs): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, skipped: true } // not configured yet — silently skip
  if (!to) return { ok: false, error: 'no recipient' }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      return { ok: false, error: `Resend ${r.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'network error' }
  }
}

// ── Shared shell ────────────────────────────────────────────────────────────────
// Minimal, brand-clean layout. Inline styles only (email clients ignore <style>).
function shell(title: string, body: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.06)">
        <tr><td style="padding:36px 36px 28px">
          <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:24px">mis<span style="color:#8e8e93">e</span></div>
          <h1 style="font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0 0 12px">${title}</h1>
          <div style="font-size:15px;line-height:1.55;color:#3c3c43">${body}</div>
          ${cta ? `<div style="margin-top:28px"><a href="${cta.href}" style="display:inline-block;background:#1c1c1e;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:12px">${cta.label}</a></div>` : ''}
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid #f2f2f7;font-size:12px;color:#aeaeb2">
          Mise · система управления рестораном<br>${APP_URL.replace(/^https?:\/\//, '')}
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`
}

// ── Templates ─────────────────────────────────────────────────────────────────────
export function sendWelcomeEmail(to: string, name?: string) {
  return sendEmail({
    to,
    subject: 'Добро пожаловать в Mise',
    html: shell(
      `Добро пожаловать${name ? `, ${name}` : ''}!`,
      `Ваш аккаунт Mise готов. Откройте дашборд, чтобы настроить заведение, пригласить команду и подключить приложения.`,
      { label: 'Открыть дашборд', href: `${APP_URL}/dashboard` },
    ),
  })
}

export function sendTrialEndingEmail(to: string, daysLeft: number) {
  const when = daysLeft <= 0 ? 'сегодня' : daysLeft === 1 ? 'завтра' : `через ${daysLeft} дн.`
  return sendEmail({
    to,
    subject: `Пробный период Mise заканчивается ${when}`,
    html: shell(
      `Пробный период заканчивается ${when}`,
      `Чтобы команда не потеряла доступ к сменам, аналитике и складу, оформите подписку в разделе «Подписка».`,
      { label: 'Продлить доступ', href: `${APP_URL}/dashboard?tab=billing` },
    ),
  })
}

export function sendPaymentReceiptEmail(to: string, plan: string, amount?: string) {
  return sendEmail({
    to,
    subject: 'Оплата Mise получена',
    html: shell(
      'Спасибо за оплату',
      `Подписка <b>${plan}</b>${amount ? ` на сумму ${amount}` : ''} активна. Чек и историю платежей можно посмотреть в Customer Portal в разделе «Подписка».`,
      { label: 'Управление подпиской', href: `${APP_URL}/dashboard?tab=billing` },
    ),
  })
}
