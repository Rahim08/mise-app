// Tiny lookup used only by AuthGate: is the current browser in super-admin "view as
// client" mode? Bypasses /api/db entirely because AuthGate's own owner_id filter would
// otherwise combine with the server-forced restaurant scope and always return empty
// (see app/api/admin/route.ts "impersonate" + lib/apiAuth.ts for how the cookie is set).
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminViewToken, ADMIN_VIEW_COOKIE_NAME } from '@/lib/staffToken'

export async function GET(req: NextRequest) {
  const payload = verifyAdminViewToken(req.cookies.get(ADMIN_VIEW_COOKIE_NAME)?.value)
  if (!payload) return NextResponse.json({ restaurantId: null }, { status: 404 })
  return NextResponse.json({ restaurantId: payload.rid })
}
