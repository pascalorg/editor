import { NextResponse } from 'next/server'
import { createRun, loadRun } from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const sourceRun = await loadRun(id)
  if (!sourceRun) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (sourceRun.mode !== 'factory') {
    return NextResponse.json({ error: 'source_run_not_factory' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const stageId = stringValue(isRecord(body) ? body.stageId : undefined) ?? 'equipment-compiler'
  const stationId = stringValue(isRecord(body) ? body.stationId : undefined)
  if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 })

  const sourceParams = isRecord(sourceRun.params) ? sourceRun.params : {}
  const run = await createRun({
    conversationId: sourceRun.conversationId,
    mode: 'factory',
    prompt: `Re-run ${stageId} for station ${stationId}`,
    params: {
      ...sourceParams,
      workflowRerun: {
        sourceRunId: sourceRun.id,
        stageId,
        stationId,
      },
    },
    context: sourceRun.context,
    intentRoute: sourceRun.intentRoute,
  })

  const { ensureFactoryRunRunning } = await import('@/lib/ai-harness-runs/factory-runner')
  ensureFactoryRunRunning(run.id)

  return NextResponse.json({ runId: run.id, conversationId: run.conversationId, run })
}
