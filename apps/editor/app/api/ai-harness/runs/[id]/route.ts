import { NextResponse } from 'next/server'
import { loadRun } from '@/lib/ai-harness-runs/run-store'
import type { AiHarnessRun } from '@/lib/ai-harness-runs/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

async function cancelRun(run: AiHarnessRun) {
  if (run.mode === 'articraft') {
    const { cancelArticraftRun } = await import('@/lib/ai-harness-runs/articraft-runner')
    await cancelArticraftRun(run.id)
  } else if (run.mode === 'image-to-3d') {
    const { cancelImageTo3DRun } = await import('@/lib/ai-harness-runs/image-to-3d-runner')
    await cancelImageTo3DRun(run.id)
  } else if (run.mode === 'primitive') {
    const { cancelPrimitiveRun } = await import('@/lib/ai-harness-runs/primitive-runner')
    await cancelPrimitiveRun(run.id)
  } else if (run.mode === 'factory') {
    const { cancelFactoryRun } = await import('@/lib/ai-harness-runs/factory-runner')
    await cancelFactoryRun(run.id)
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ run })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await cancelRun(run)

  return NextResponse.json({ ok: true })
}
