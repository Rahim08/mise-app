// Public guest menu — assembled server-side so the browser never touches the DB with the
// anon key. Returns only published data and safe restaurant fields (no owner_pin / stripe).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: settings } = await admin
    .from('menu_settings').select('*').eq('slug', slug).eq('is_published', true).single()
  if (!settings) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [rest, cats, items] = await Promise.all([
    admin.from('restaurants').select('id, name, logo_url, currency').eq('id', settings.restaurant_id).single(),
    admin.from('menu_categories').select('*').eq('restaurant_id', settings.restaurant_id).eq('is_visible', true).order('position'),
    admin.from('menu_items').select('*').eq('restaurant_id', settings.restaurant_id).eq('is_visible', true).order('position'),
  ])

  return NextResponse.json({
    settings,
    restaurant: rest.data,
    categories: cats.data || [],
    items: items.data || [],
  })
}
