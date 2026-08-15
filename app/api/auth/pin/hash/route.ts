import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { resolveCaller } from '@/lib/apiAuth'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller?.owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pin } = await req.json()
  if (!pin || !/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
  const hash = await bcrypt.hash(pin, 10)
  return NextResponse.json({ hash })
}
