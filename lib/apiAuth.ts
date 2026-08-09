// Shared request → caller resolution for authenticated API routes.
//
// Mirrors the logic in app/api/db/route.ts (staff PIN token or owner Supabase session),
// extracted so other routes (e.g. /api/notify) can authorize the same way.

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE, verifyAdminViewToken, ADMIN_VIEW_COOKIE_NAME } from '@/lib/staffToken'

export interface Caller { rid: string; owner: boolean; apps: string[]; sid?: string }

export async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  // Super-admin "view as client" — unconditional priority so it works even when the
  // admin's own Supabase session (they may own a restaurant themselves) would otherwise
  // win below. Scope: full owner access to the impersonated restaurant only.
  const adminView = verifyAdminViewToken(req.cookies.get(ADMIN_VIEW_COOKIE_NAME)?.value)
  if (adminView) return { rid: adminView.rid, owner: true, apps: ['manager', 'analytics', 'stash', 'people'] }

  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)

  // Owner может тестировать PIN-приложения в том же браузере → есть и staff-кука, и
  // Supabase-сессия. Если Supabase-куки нет — это точно сотрудник.
  const hasSbSession = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (staff && !hasSbSession) return { rid: staff.rid, owner: staff.owner, apps: staff.apps || [], sid: staff.sid }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [], sid: staff.sid } : null
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('restaurants').select('id').eq('owner_id', user.id).single()
  if (!data?.id) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [], sid: staff.sid } : null
  return { rid: data.id, owner: true, apps: ['manager', 'analytics', 'stash', 'people'] }
}

// «Должностное лицо» — owner или staff.role в manager/admin (то же правило, что iOS
// AppModel.isOfficial). Требует запроса к staff, поэтому вызывается только там, где UI-гейта
// недостаточно (News: публикация/удаление от чужого имени, широковещательный пуш).
export async function isOfficial(admin: any, caller: Caller): Promise<boolean> {
  if (caller.owner) return true
  if (!caller.sid) return false
  const { data } = await admin.from('staff').select('role').eq('id', caller.sid).eq('restaurant_id', caller.rid).single()
  return data?.role === 'manager' || data?.role === 'admin'
}
