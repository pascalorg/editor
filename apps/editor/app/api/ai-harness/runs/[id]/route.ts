import { NextResponse } from 'next/server'
import { cancelArticraftRun } from '@/lib/ai-harness-runs/articraft-runner'
import { cancelImageTo3DRun } from '@/lib/ai-harness-runs/image-to-3d-runner'
import { cancelPrimitiveRun } from '@/lib/ai-harness-runs/primitive-runner'
import { loadRun } from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

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

  if (run.mode === 'articraft') {
    await cancelArticraftRun(id)
  } else if (run.mode === 'image-to-3d') {
    await cancelImageTo3DRun(id)
  } else if (run.mode === 'primitive') {
    await cancelPrimitiveRun(id)
  }

  return NextResponse.json({ ok: true })
}
