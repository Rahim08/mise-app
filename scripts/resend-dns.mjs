// Печатает DNS-записи, которые Resend требует для домена (SPF/DKIM/DMARC).
// Запуск:  ! RESEND_API_KEY=re_твой_ключ node scripts/resend-dns.mjs
// (домен по умолчанию misesuite.com; можно переопределить DOMAIN=...)
//
// Скрипт идемпотентный: если домен в Resend уже добавлен — просто покажет записи;
// если нет — создаст (регион eu-west-1) и покажет. Ничего не удаляет.

const KEY = process.env.RESEND_API_KEY
const DOMAIN = process.env.DOMAIN || 'misesuite.com'
if (!KEY) { console.error('❌ Нет RESEND_API_KEY. Запуск: RESEND_API_KEY=re_... node scripts/resend-dns.mjs'); process.exit(1) }

const h = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const api = async (path, init) => {
  const r = await fetch('https://api.resend.com' + path, { headers: h, ...init })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`)
  return j
}

try {
  const list = await api('/domains')
  let dom = (list.data || []).find(d => d.name === DOMAIN)
  if (!dom) {
    console.log(`Домена ${DOMAIN} нет в Resend — создаю…`)
    dom = await api('/domains', { method: 'POST', body: JSON.stringify({ name: DOMAIN, region: 'eu-west-1' }) })
  }
  const d = await api('/domains/' + dom.id)
  console.log(`\n=== Resend: ${DOMAIN} ===  статус: ${d.status}\n`)
  console.log('Добавь эти записи в Cloudflare → DNS → Records (Proxy = DNS only / серое облако):\n')
  for (const r of d.records || []) {
    const name = r.name === DOMAIN ? '@' : r.name.replace('.' + DOMAIN, '')
    console.log(`• ${r.type.padEnd(5)} name: ${name}`)
    console.log(`         value: ${r.value}`)
    if (r.priority != null) console.log(`         priority: ${r.priority}`)
    console.log('')
  }
  console.log('После добавления — в Resend нажми Verify (или подожди 5–30 мин). Статус станет verified.')
} catch (e) {
  console.error('❌ Ошибка Resend API:', e.message)
  process.exit(1)
}
