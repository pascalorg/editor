import { NextResponse } from 'next/server'
import { fetchPromptHistory, parseHistoryStatus } from '@/lib/pic-to-3d/comfyui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const promptId = new URL(request.url).searchParams.get('promptId')?.trim()
  if (!promptId) {
    return NextResponse.json({ error: 'promptId がありません。' }, { status: 400 })
  }

  try {
    const record = await fetchPromptHistory(promptId)
    if (!record) {
      return NextResponse.json({ ok: true, state: 'pending' as const })
    }

    const parsed = parseHistoryStatus(record)
    if (parsed.state === 'error') {
      return NextResponse.json({
        ok: false,
        state: 'error' as const,
        error: parsed.error ?? '生成に失敗しました',
      })
    }
    if (parsed.state === 'complete' && parsed.glb) {
      return NextResponse.json({
        ok: true,
        state: 'complete' as const,
        glb: parsed.glb,
        downloadName: parsed.glb.filename.split('/').pop() ?? 'model.glb',
      })
    }

    return NextResponse.json({ ok: true, state: 'pending' as const })
  } catch (error) {
    console.error('[pic-to-3d] status failed:', error)
    const message = error instanceof Error ? error.message : 'ステータスの取得に失敗しました'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
