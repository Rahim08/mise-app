import { createSign } from 'crypto'
import { readFileSync } from 'fs'

const TEAM_ID   = 'J6TW52VHQQ'
const KEY_ID    = 'W6HCZSDZ6W'
const CLIENT_ID = 'com.misesuite.web'

const p8Path = process.argv[2]
if (!p8Path) {
  console.error('Укажи путь к файлу: node generate-apple-secret.mjs AuthKey_W6HCZSDZ6W.p8')
  process.exit(1)
}

const privateKey = readFileSync(p8Path, 'utf8')

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

const now = Math.floor(Date.now() / 1000)
const exp = now + 15777000

const header  = base64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }))
const payload = base64url(JSON.stringify({ iss: TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: CLIENT_ID }))
const unsigned = `${header}.${payload}`

const sign = createSign('SHA256')
sign.update(unsigned)
const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

console.log('\n✅ Вставь это в Supabase → Apple → Secret Key:\n')
console.log(`${unsigned}.${sig}`)
console.log(`\n⚠️  Истекает: ${new Date(exp * 1000).toLocaleDateString('ru-RU')}\n`)
