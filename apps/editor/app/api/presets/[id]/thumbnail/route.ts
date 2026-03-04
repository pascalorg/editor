import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

// POST /api/presets/[id]/thumbnail
// Accepts a raw PNG blob, uploads to preset-thumbnails bucket, updates thumbnail_url
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const existingResult = await supabaseAdmin
    .from('presets')
    .select('user_id')
    .eq('id', id)
    .single()
  const existing = existingResult.data as { user_id: string | null } | null

  if (!existing || existing.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not found or forbidden' }, { status: 403 })
  }

  const blob = await req.blob()

  const filename = `${id}/thumbnail.png`
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from('preset-thumbnails')
    .upload(filename, blob, {
      contentType: 'image/png',
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('preset-thumbnails')
    .getPublicUrl(uploadData.path)

  const thumbnailUrl = `${urlData.publicUrl}?t=${Date.now()}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabaseAdmin as any)
    .from('presets')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ thumbnail_url: thumbnailUrl })
}
