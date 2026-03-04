import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { createId } from '@pascal-app/db'

// GET /api/presets?type=door|window&tab=community|mine
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')
  const tab = searchParams.get('tab') ?? 'community'

  if (!type || (type !== 'door' && type !== 'window')) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  if (tab === 'mine') {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('presets')
      .select('*')
      .eq('type', type)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ presets: data })
  }

  // community tab
  const { data, error } = await supabaseAdmin
    .from('presets')
    .select('*')
    .eq('type', type)
    .eq('is_community', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ presets: data })
}

// POST /api/presets
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { type, name, data, thumbnailUrl } = body

  if (!type || !name || !data) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (type !== 'door' && type !== 'window') {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: preset, error } = await (supabaseAdmin as any)
    .from('presets')
    .insert({
      id: createId('preset'),
      type,
      name,
      data,
      thumbnail_url: thumbnailUrl ?? null,
      user_id: session.user.id,
      is_community: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ preset }, { status: 201 })
}
