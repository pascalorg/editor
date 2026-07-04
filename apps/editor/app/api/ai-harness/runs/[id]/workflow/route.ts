import { NextResponse } from 'next/server'
import { listRunEvents, loadRun } from '@/lib/ai-harness-runs/run-store'
import { buildAiWorkflowGraph } from '@/lib/ai-harness-runs/workflow-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const events = await listRunEvents(id, { limit: 500 })
  return NextResponse.json({ workflowGraph: buildAiWorkflowGraph({ run, events }) })
}
