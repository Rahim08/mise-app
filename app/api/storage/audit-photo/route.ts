// Загрузка фото пункта чек-листа/аудита — клиент не обращается к Supabase Storage напрямую,
// тот же принцип, что и /api/db для данных: сервис-роль здесь, не в приложении.
//
// MISE-012 (аудит 2026-08-28): веб раньше грузил фото в тот же бакет напрямую через
// supabase-js anon-key (app/people/audits.tsx, uploadAuditPhoto) — комментарий обосновывал
// это «в браузере уже есть авторизованная сессия», но это верно только для owner
// (Supabase Auth сессия); PIN-сотрудник на вебе такой сессии не имеет вообще, только
// mise_staff_token — прямой путь для него зависел от того, разрешает ли Storage-policy
// бакета анонимную запись в этот путь (не проверяемо из репозитория). Теперь оба клиента
// идут через один и тот же серверный путь — не зависит от Storage-policy вообще.
//
// Auth: тот же resolveCaller что и у /api/db — rid берётся из проверенной сессии, а не из
// тела запроса (клиент не может залить фото в чужой ресторан, даже прислав чужой restaurant_id).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// First bytes of the image formats this endpoint accepts — reject anything else instead
// of trusting the client-declared content type (audit 2026-08-15, block-G #6).
// webp added 2026-08-28 (MISE-012): web now routes ALL uploads here, including desktop file
// pickers (not just camera capture), where a wider range of image types is realistic.
function sniffImageContentType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

// Folder-based path (web: task/violation photos, no completion/item UUIDs to key by —
// audits.tsx uploadAuditPhoto). Sanitized to a safe path segment; not user-facing text.
const FOLDER_RE = /^[a-zA-Z0-9_-]{1,64}$/

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rlKey = rateLimitKey(req, `audit-photo:${caller.rid}`)
  if (!await checkRateLimit(rlKey, 10, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { completion_id, item_id, folder, data_base64 } = body || {}
  if (!data_base64) return NextResponse.json({ error: 'data_base64 required' }, { status: 400 })

  let pathSegment: string
  if (completion_id || item_id) {
    if (!completion_id || !item_id) {
      return NextResponse.json({ error: 'completion_id and item_id required together' }, { status: 400 })
    }
    if (!UUID_RE.test(completion_id) || !UUID_RE.test(item_id)) {
      return NextResponse.json({ error: 'completion_id and item_id must be UUIDs' }, { status: 400 })
    }
    pathSegment = `${completion_id}/${item_id}`
  } else {
    if (!folder || typeof folder !== 'string' || !FOLDER_RE.test(folder)) {
      return NextResponse.json({ error: 'folder must match ' + FOLDER_RE.source }, { status: 400 })
    }
    pathSegment = folder
  }

  let bytes: Buffer
  try { bytes = Buffer.from(data_base64, 'base64') } catch { return NextResponse.json({ error: 'Bad base64' }, { status: 400 }) }
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Photo too large or empty' }, { status: 400 })
  }
  const contentType = sniffImageContentType(bytes)
  if (!contentType) return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const path = `audits/${caller.rid}/${pathSegment}-${Date.now()}.${ext}`
  const { error } = await admin.storage.from('restaurant-assets').upload(path, bytes, { contentType, upsert: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from('restaurant-assets').getPublicUrl(path)
  return NextResponse.json({ url: publicUrl })
}
