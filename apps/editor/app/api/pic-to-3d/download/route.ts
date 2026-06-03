import { NextResponse } from 'next/server'
import { downloadGlbFromComfy, type GlbOutputRef } from '@/lib/pic-to-3d/comfyui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const filename = params.get('filename')?.trim()
  if (!filename) {
    return NextResponse.json({ error: 'filename がありません。' }, { status: 400 })
  }

  const ref: GlbOutputRef = {
    filename,
    subfolder: params.get('subfolder')?.trim() ?? '',
    type: params.get('type')?.trim() || 'output',
  }

  try {
    const buffer = await downloadGlbFromComfy(ref)
    const downloadName =
      params.get('downloadName')?.trim() ||
      filename.split('/').pop() ||
      'pic2three_output.glb'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[pic-to-3d] download failed:', error)
    const message = error instanceof Error ? error.message : 'ダウンロードに失敗しました'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
