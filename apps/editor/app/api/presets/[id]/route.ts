import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

// PUT /api/presets/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const { name } = body

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('presets')
    .select('user_id, is_community')
    .eq('id', id)
    .single()

  if (!existing || existing.user_id !== session.user.id || existing.is_community) {
    return NextResponse.json({ error: 'Not found or forbidden' }, { status: 403 })
  }

  const { data: preset, error } = await supabaseAdmin
    .from('presets')
    .update({ name })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ preset })
}

// DELETE /api/presets/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data: existing } = await supabaseAdmin
    .from('presets')
    .select('user_id, is_community, thumbnail_url')
    .eq('id', id)
    .single()

  if (!existing || existing.user_id !== session.user.id || existing.is_community) {
    return NextResponse.json({ error: 'Not found or forbidden' }, { status: 403 })
  }

  // Delete thumbnail from storage if present
  if (existing.thumbnail_url) {
    const url = existing.thumbnail_url as string
    const match = url.match(/preset-thumbnails\/(.+)$/)
    if (match?.[1]) {
      await supabaseAdmin.storage.from('preset-thumbnails').remove([match[1]])
    }
  }

  const { error } = await supabaseAdmin.from('presets').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
