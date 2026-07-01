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

type Locale = 'en' | 'ru' | 'it' | 'fr' | 'az' | 'tr' | 'uk' | 'kk'

// ── Email-specific translations ────────────────────────────────────────────────
const E: Record<string, Record<Locale, string>> = {
  // footer
  footer:       { en: 'Mise · restaurant management system', ru: 'Mise · система управления рестораном', it: 'Mise · gestione ristorante', fr: 'Mise · gestion de restaurant', az: 'Mise · restoran idarəetmə sistemi', tr: 'Mise · restoran yönetim sistemi', uk: 'Mise · система управління рестораном', kk: 'Mise · мейрамхана басқару жүйесі' },
  // welcome
  welcomeSubj:  { en: 'Welcome to Mise', ru: 'Добро пожаловать в Mise', it: 'Benvenuto in Mise', fr: 'Bienvenue sur Mise', az: 'Mise-ye xoş gəlmisiniz', tr: "Mise'ye Hoş Geldiniz", uk: 'Ласкаво просимо до Mise', kk: 'Mise-ге қош келдіңіз' },
  welcomeTitle: { en: 'Welcome{name}', ru: 'Добро пожаловать{name}', it: 'Benvenuto{name}', fr: 'Bienvenue{name}', az: 'Xoş gəlmisiniz{name}', tr: 'Hoş geldiniz{name}', uk: 'Ласкаво просимо{name}', kk: 'Қош келдіңіз{name}' },
  welcomeBody:  { en: 'Your Mise account is ready. Open the dashboard to set up your venue, invite your team, and connect apps.', ru: 'Ваш аккаунт Mise готов. Откройте дашборд, чтобы настроить заведение, пригласить команду и подключить приложения.', it: 'Il tuo account Mise è pronto. Apri la dashboard per configurare il locale, invitare il team e collegare le app.', fr: "Votre compte Mise est prêt. Ouvrez le tableau de bord pour configurer votre établissement, inviter votre équipe et connecter des apps.", az: 'Mise hesabınız hazırdır. Məkanı quraşdırmaq, komandanı dəvət etmək və tətbiqləri bağlamaq üçün tablonu açın.', tr: 'Mise hesabınız hazır. Mekanı kurmak, ekibinizi davet etmek ve uygulamaları bağlamak için panonuzu açın.', uk: 'Ваш акаунт Mise готовий. Відкрийте дашборд, щоб налаштувати заклад, запросити команду та підключити додатки.', kk: 'Mise тіркелгіңіз дайын. Мекенді орнату, команданы шақыру және қолданбаларды қосу үшін басқару тақтасын ашыңыз.' },
  welcomeCta:   { en: 'Open dashboard', ru: 'Открыть дашборд', it: 'Apri dashboard', fr: 'Ouvrir le tableau de bord', az: 'Tablonu aç', tr: 'Panoyu aç', uk: 'Відкрити дашборд', kk: 'Басқару тақтасын ашу' },
  // trial
  trialSubj:    { en: 'Mise trial ends {when}', ru: 'Пробный период Mise заканчивается {when}', it: 'La prova Mise scade {when}', fr: 'Essai Mise se termine {when}', az: 'Mise pulsuz dövrü {when} bitir', tr: 'Mise deneme süresi {when} sona eriyor', uk: 'Пробний період Mise закінчується {when}', kk: 'Mise сынақ мерзімі {when} аяқталады' },
  trialTitle:   { en: 'Trial ends {when}', ru: 'Пробный период заканчивается {when}', it: 'Prova scade {when}', fr: "L'essai se termine {when}", az: 'Pulsuz dövr {when} bitir', tr: 'Deneme süresi {when} sona eriyor', uk: 'Пробний період закінчується {when}', kk: 'Сынақ мерзімі {when} аяқталады' },
  trialBody:    { en: 'To keep your team\'s access to shifts, analytics, and inventory, subscribe in the Billing section.', ru: 'Чтобы команда не потеряла доступ к сменам, аналитике и складу, оформите подписку в разделе «Подписка».', it: "Per mantenere l'accesso del team a turni, analisi e inventario, abbonati nella sezione Fatturazione.", fr: "Pour garder l'accès de l'équipe aux services, analyses et inventaire, abonnez-vous dans la section Facturation.", az: 'Komandanın növbələrə, analitikaya və anbara çıxışını qorumaq üçün Ödənişlər bölməsində abunə olun.', tr: 'Ekibinizin vardiyalara, analitiklere ve envantere erişimini korumak için Faturalandırma bölümünden abone olun.', uk: 'Щоб зберегти доступ команди до змін, аналітики та складу, оформіть підписку в розділі «Підписка».', kk: 'Командаңыздың ауысымдарға, аналитикаға және қоймаға қол жетімділігін сақтау үшін Төлемдер бөлімінде жазылыңыз.' },
  trialCta:     { en: 'Renew access', ru: 'Продлить доступ', it: 'Rinnova accesso', fr: "Renouveler l'accès", az: 'Girişi yenilə', tr: 'Erişimi yenile', uk: 'Продовжити доступ', kk: 'Қол жетімділікті жаңарту' },
  trialWhen0:   { en: 'today', ru: 'сегодня', it: "oggi", fr: "aujourd'hui", az: 'bu gün', tr: 'bugün', uk: 'сьогодні', kk: 'бүгін' },
  trialWhen1:   { en: 'tomorrow', ru: 'завтра', it: 'domani', fr: 'demain', az: 'sabah', tr: 'yarın', uk: 'завтра', kk: 'ертең' },
  trialWhenN:   { en: 'in {n} days', ru: 'через {n} дн.', it: 'tra {n} giorni', fr: 'dans {n} jours', az: '{n} gün ərzində', tr: '{n} gün içinde', uk: 'через {n} дн.', kk: '{n} күн ішінде' },
  // payment
  paySubj:      { en: 'Mise payment received', ru: 'Оплата Mise получена', it: 'Pagamento Mise ricevuto', fr: 'Paiement Mise reçu', az: 'Mise ödənişi alındı', tr: 'Mise ödemesi alındı', uk: 'Оплату Mise отримано', kk: 'Mise төлемі қабылданды' },
  payTitle:     { en: 'Thank you for payment', ru: 'Спасибо за оплату', it: 'Grazie per il pagamento', fr: 'Merci pour votre paiement', az: 'Ödənişə görə təşəkkürlər', tr: 'Ödemeniz için teşekkürler', uk: 'Дякуємо за оплату', kk: 'Төлеміңіз үшін рахмет' },
  payBody:      { en: 'Subscription <b>{plan}</b>{amount} is active. View receipts and payment history in the Customer Portal under Billing.', ru: 'Подписка <b>{plan}</b>{amount} активна. Чек и историю платежей можно посмотреть в Customer Portal в разделе «Подписка».', it: 'L\'abbonamento <b>{plan}</b>{amount} è attivo. Visualizza ricevute e cronologia pagamenti nel Customer Portal nella sezione Fatturazione.', fr: 'L\'abonnement <b>{plan}</b>{amount} est actif. Consultez les reçus et l\'historique des paiements dans le Customer Portal, section Facturation.', az: 'Abunəliyiniz <b>{plan}</b>{amount} aktivdir. Qaimələri və ödəniş tarixçəsini Customer Portal → Ödənişlər bölməsindən baxın.', tr: '<b>{plan}</b>{amount} aboneliğiniz aktif. Makbuzları ve ödeme geçmişini Customer Portal → Faturalandırma bölümünden görüntüleyin.', uk: 'Підписка <b>{plan}</b>{amount} активна. Чеки та історію платежів можна переглянути в Customer Portal у розділі «Підписка».', kk: '<b>{plan}</b>{amount} жазылуы белсенді. Түбірткелер мен төлем тарихын Customer Portal → Төлемдер бөлімінен қараңыз.' },
  payCta:       { en: 'Manage subscription', ru: 'Управление подпиской', it: 'Gestisci abbonamento', fr: "Gérer l'abonnement", az: 'Abunəliyi idarə et', tr: 'Aboneliği yönet', uk: 'Керувати підпискою', kk: 'Жазылуды басқару' },
}

function tx(locale: Locale, key: string, vars?: Record<string, string>): string {
  const row = E[key]
  let s = row?.[locale] ?? row?.en ?? key
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k])
  return s
}

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
function shell(title: string, body: string, cta?: { label: string; href: string }, locale: Locale = 'ru'): string {
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
          ${tx(locale, 'footer')}<br>${APP_URL.replace(/^https?:\/\//, '')}
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`
}

// ── Templates ─────────────────────────────────────────────────────────────────────
export function sendWelcomeEmail(to: string, name?: string, locale: Locale = 'ru') {
  const greeting = name ? `, ${name}` : ''
  return sendEmail({
    to,
    subject: tx(locale, 'welcomeSubj'),
    html: shell(
      tx(locale, 'welcomeTitle', { name: greeting }),
      tx(locale, 'welcomeBody'),
      { label: tx(locale, 'welcomeCta'), href: `${APP_URL}/dashboard` },
      locale,
    ),
  })
}

export function sendTrialEndingEmail(to: string, daysLeft: number, locale: Locale = 'ru') {
  const when = daysLeft <= 0 ? tx(locale, 'trialWhen0') : daysLeft === 1 ? tx(locale, 'trialWhen1') : tx(locale, 'trialWhenN', { n: String(daysLeft) })
  return sendEmail({
    to,
    subject: tx(locale, 'trialSubj', { when }),
    html: shell(
      tx(locale, 'trialTitle', { when }),
      tx(locale, 'trialBody'),
      { label: tx(locale, 'trialCta'), href: `${APP_URL}/dashboard?tab=billing` },
      locale,
    ),
  })
}

export function sendPaymentReceiptEmail(to: string, plan: string, amount?: string, locale: Locale = 'ru') {
  const amountStr = amount ? ` на сумму ${amount}` : ''
  return sendEmail({
    to,
    subject: tx(locale, 'paySubj'),
    html: shell(
      tx(locale, 'payTitle'),
      tx(locale, 'payBody', { plan, amount: amountStr }),
      { label: tx(locale, 'payCta'), href: `${APP_URL}/dashboard?tab=billing` },
      locale,
    ),
  })
}
