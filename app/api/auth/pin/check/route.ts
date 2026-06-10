import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { restaurantId, pin } = await req.json()
  if (!restaurantId || !pin) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  // Check owner PIN
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('owner_pin')
    .eq('id', restaurantId)
    .single()

  if (restaurant?.owner_pin) {
    const ownerMatch = await bcrypt.compare(pin, restaurant.owner_pin)
    if (ownerMatch) {
      return NextResponse.json({ match: true, is_owner: true, apps: ['manager', 'analytics', 'stash'] })
    }
  }

  // Check staff PIN
  const { data: staffList } = await supabase
    .from('staff')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)

  for (const staff of staffList || []) {
    if (!staff.pin_hash) continue
    const match = await bcrypt.compare(pin, staff.pin_hash)
    if (match) {
      return NextResponse.json({ match: true, is_owner: false, staff })
    }
  }

  return NextResponse.json({ match: false })
}
