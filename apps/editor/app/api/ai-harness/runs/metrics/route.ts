import { NextResponse } from 'next/server'
import { listRecentRuns } from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PrimitiveRouteMetric = {
  route?: string
  fallbackReason?: string
  family?: string
  component?: string
  deterministicTool?: string
  deterministicSucceeded?: boolean
  stage2Called?: boolean
  stage2ToolCallCount?: number
  repairCallCount?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function primitiveRouteMetric(result: unknown): PrimitiveRouteMetric | undefined {
  if (!isRecord(result)) return undefined
  const metrics = result.metrics
  if (!isRecord(metrics)) return undefined
  const primitiveRoute = metrics.primitiveRoute
  return isRecord(primitiveRoute) ? (primitiveRoute as PrimitiveRouteMetric) : undefined
}

function increment(counts: Record<string, number>, key: string | undefined) {
  if (!key) return
  counts[key] = (counts[key] ?? 0) + 1
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 200, 500))
  const runs = (await listRecentRuns(limit)).filter((run) => run.mode === 'primitive')

  const byFallbackReason: Record<string, number> = {}
  const byComponent: Record<string, number> = {}
  const samples = []
  let measured = 0
  let deterministic = 0
  let stage2Fallback = 0

  for (const run of runs) {
    const metric = primitiveRouteMetric(run.result)
    if (!metric) continue
    measured += 1
    if (metric.route === 'deterministic') deterministic += 1
    if (metric.route === 'stage2_fallback') stage2Fallback += 1
    increment(byFallbackReason, metric.fallbackReason)
    increment(byComponent, metric.component)
    samples.push({
      runId: run.id,
      status: run.status,
      prompt: run.prompt,
      route: metric.route,
      fallbackReason: metric.fallbackReason,
      family: metric.family,
      component: metric.component,
      deterministicTool: metric.deterministicTool,
      stage2ToolCallCount: metric.stage2ToolCallCount ?? 0,
      repairCallCount: metric.repairCallCount ?? 0,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    })
  }

  return NextResponse.json({
    window: { requestedLimit: limit, primitiveRunsScanned: runs.length, measuredRuns: measured },
    counts: { deterministic, stage2Fallback },
    fallbackRate: measured > 0 ? stage2Fallback / measured : null,
    deterministicRate: measured > 0 ? deterministic / measured : null,
    byFallbackReason,
    byComponent,
    samples,
  })
}
