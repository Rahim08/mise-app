// Shared request → caller resolution for authenticated API routes.
//
// Mirrors the logic in app/api/db/route.ts (staff PIN token or owner Supabase session),
// extracted so other routes (e.g. /api/notify) can authorize the same way.

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE, verifyAdminViewToken, ADMIN_VIEW_COOKIE_NAME } from '@/lib/staffToken'

// uid/email — владелец (Supabase-аккаунт), via — суперадмин «глазами клиента»; нужны только
// для журнала финансов (lib/financialAudit.ts), на авторизацию не влияют.
export interface Caller { rid: string; owner: boolean; apps: string[]; sid?: string; uid?: string; email?: string; via?: 'admin_view'; name?: string }

function serviceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PIN tokens establish identity only. Access and display identity come from the
// current active row, so removing module access takes effect without another login.
async function currentStaffCaller(admin: ReturnType<typeof serviceRoleClient>, staff: { rid: string; sid: string; owner: boolean }): Promise<Caller | null> {
  if (staff.sid === 'owner') return staff.owner ? { rid: staff.rid, owner: true, apps: ['manager', 'analytics', 'stash', 'people'], sid: 'owner', name: 'Owner' } : null
  const { data, error } = await admin.from('staff').select('is_active, apps, name').eq('id', staff.sid).eq('restaurant_id', staff.rid).single()
  if (error || !data || data.is_active !== true) return null
  return { rid: staff.rid, owner: false, sid: staff.sid, name: data.name || '',
    apps: Array.isArray(data.apps) ? data.apps.filter((app: unknown): app is string => typeof app === 'string') : [] }
}

export async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  // Super-admin "view as client" — unconditional priority so it works even when the
  // admin's own Supabase session (they may own a restaurant themselves) would otherwise
  // win below. Scope: full owner access to the impersonated restaurant only.
  const adminView = verifyAdminViewToken(req.cookies.get(ADMIN_VIEW_COOKIE_NAME)?.value)
  if (adminView) return { rid: adminView.rid, owner: true, apps: ['manager', 'analytics', 'stash', 'people'], via: 'admin_view' }

  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)

  // Owner может тестировать PIN-приложения в том же браузере → есть и staff-кука, и
  // Supabase-сессия. Если Supabase-куки нет — это точно сотрудник.
  const hasSbSession = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (staff && !hasSbSession) {
    const admin = serviceRoleClient()
    return currentStaffCaller(admin, staff)
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    if (!staff) return null
    const admin = serviceRoleClient()
    return currentStaffCaller(admin, staff)
  }
  const admin = serviceRoleClient()
  const { data } = await admin.from('restaurants').select('id').eq('owner_id', user.id).single()
  if (!data?.id) {
    if (!staff) return null
    return currentStaffCaller(admin, staff)
  }
  return { rid: data.id, owner: true, apps: ['manager', 'analytics', 'stash', 'people'], uid: user.id, email: user.email ?? undefined, name: 'Owner' }
}

// «Должностное лицо» — owner или staff.role в manager/admin (то же правило, что iOS
// AppModel.isOfficial). Требует запроса к staff, поэтому вызывается только там, где UI-гейта
// недостаточно (News: публикация/удаление от чужого имени, широковещательный пуш).
export async function isOfficial(admin: Pick<ReturnType<typeof serviceRoleClient>, 'from'>, caller: Caller): Promise<boolean> {
  if (caller.owner) return true
  if (!caller.sid) return false
  const { data } = await admin.from('staff').select('role').eq('id', caller.sid).eq('restaurant_id', caller.rid).single()
  return data?.role === 'manager' || data?.role === 'admin'
}
