// Shared request → caller resolution for authenticated API routes.
//
// Mirrors the logic in app/api/db/route.ts (staff PIN token or owner Supabase session),
// extracted so other routes (e.g. /api/notify) can authorize the same way.

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'

export interface Caller { rid: string; owner: boolean; apps: string[] }

export async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)

  // Owner может тестировать PIN-приложения в том же браузере → есть и staff-кука, и
  // Supabase-сессия. Если Supabase-куки нет — это точно сотрудник.
  const hasSbSession = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (staff && !hasSbSession) return { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] } : null
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('restaurants').select('id').eq('owner_id', user.id).single()
  if (!data?.id) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] } : null
  return { rid: data.id, owner: true, apps: ['manager', 'analytics', 'stash', 'people'] }
}
