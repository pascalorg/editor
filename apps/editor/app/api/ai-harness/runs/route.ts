import { NextResponse } from 'next/server'
import { ensureArticraftRunRunning } from '@/lib/ai-harness-runs/articraft-runner'
import { ensureImageTo3DRunRunning } from '@/lib/ai-harness-runs/image-to-3d-runner'
import { ensurePrimitiveRunRunning } from '@/lib/ai-harness-runs/primitive-runner'
import { createRun, listRecentRuns } from '@/lib/ai-harness-runs/run-store'
import type { AiHarnessRunMode } from '@/lib/ai-harness-runs/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const mode = body.mode
  if (!(mode === 'articraft' || mode === 'image-to-3d' || mode === 'primitive')) {
    return NextResponse.json({ error: 'Unsupported run mode' }, { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt && mode !== 'image-to-3d') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const image = isRecord(body.image)
    ? {
        name: typeof body.image.name === 'string' ? body.image.name : 'reference',
        type: typeof body.image.type === 'string' ? body.image.type : 'image/png',
        dataUrl: typeof body.image.dataUrl === 'string' ? body.image.dataUrl : '',
      }
    : undefined

  try {
    const run = await createRun({
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : 'default',
      mode: mode as AiHarnessRunMode,
      prompt: prompt || 'Generate a 3D model from the reference image',
      articraftMode: body.articraftMode === 'static' ? 'static' : 'articulated',
      params: isRecord(body.params) ? body.params : undefined,
      context: body.context,
      image,
    })

    if (run.mode === 'articraft') {
      ensureArticraftRunRunning(run.id)
    } else if (run.mode === 'image-to-3d') {
      ensureImageTo3DRunRunning(run.id)
    } else if (run.mode === 'primitive') {
      ensurePrimitiveRunRunning(run.id)
    }

    return NextResponse.json({ runId: run.id, conversationId: run.conversationId, run })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ runs: await listRecentRuns() })
}
