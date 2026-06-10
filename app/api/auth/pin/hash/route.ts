import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const { pin } = await req.json()
  if (!pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
  const hash = await bcrypt.hash(pin, 10)
  return NextResponse.json({ hash })
}
