import { NextResponse } from 'next/server'
import { createRun, listRecentRuns } from '@/lib/ai-harness-runs/run-store'
import type { AiHarnessRun, AiHarnessRunMode } from '@/lib/ai-harness-runs/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function ensureRunRunning(run: AiHarnessRun) {
  if (run.mode === 'articraft') {
    const { ensureArticraftRunRunning } = await import('@/lib/ai-harness-runs/articraft-runner')
    ensureArticraftRunRunning(run.id)
  } else if (run.mode === 'image-to-3d') {
    const { ensureImageTo3DRunRunning } = await import('@/lib/ai-harness-runs/image-to-3d-runner')
    ensureImageTo3DRunRunning(run.id)
  } else if (run.mode === 'primitive') {
    const { ensurePrimitiveRunRunning } = await import('@/lib/ai-harness-runs/primitive-runner')
    ensurePrimitiveRunRunning(run.id)
  } else if (run.mode === 'factory') {
    const { ensureFactoryRunRunning } = await import('@/lib/ai-harness-runs/factory-runner')
    ensureFactoryRunRunning(run.id)
  }
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
  if (!(mode === 'articraft' || mode === 'image-to-3d' || mode === 'primitive' || mode === 'factory')) {
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

    await ensureRunRunning(run)

    return NextResponse.json({ runId: run.id, conversationId: run.conversationId, run })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ runs: await listRecentRuns() })
}
