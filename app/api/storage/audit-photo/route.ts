// Загрузка фото пункта чек-листа/аудита с iOS (клиент не обращается к Supabase Storage
// напрямую — тот же принцип, что и /api/db для данных: сервис-роль здесь, не в приложении).
// Веб-дашборд грузит фото в тот же бакет напрямую через supabase-js (см. app/people/page.tsx,
// uploadAuditPhoto) — там уже есть авторизованная сессия в браузере, для iOS так нельзя.
//
// Auth: тот же resolveCaller что и у /api/db — rid берётся из проверенной сессии, а не из
// тела запроса (клиент не может залить фото в чужой ресторан, даже прислав чужой restaurant_id).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { completion_id, item_id, data_base64 } = body || {}
  if (!completion_id || !item_id || !data_base64) {
    return NextResponse.json({ error: 'completion_id, item_id and data_base64 required' }, { status: 400 })
  }

  let bytes: Buffer
  try { bytes = Buffer.from(data_base64, 'base64') } catch { return NextResponse.json({ error: 'Bad base64' }, { status: 400 }) }
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Photo too large or empty' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const path = `audits/${caller.rid}/${completion_id}/${item_id}-${Date.now()}.jpg`
  const { error } = await admin.storage.from('restaurant-assets').upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from('restaurant-assets').getPublicUrl(path)
  return NextResponse.json({ url: publicUrl })
}
