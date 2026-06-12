// Проверка, что вызывающий — владелец ресторана (Supabase-сессия из cookies).
// Используется биллинговыми роутами: без неё любой, узнав restaurantId, мог
// создать checkout или отменить чужую подписку.
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export async function verifyOwner(req: NextRequest, restaurantId: string): Promise<{ ok: boolean; userId?: string; email?: string }> {
  if (!restaurantId) return { ok: false }
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('restaurants').select('owner_id').eq('id', restaurantId).single()
  if (!data || data.owner_id !== user.id) return { ok: false }
  return { ok: true, userId: user.id, email: user.email ?? undefined }
}
