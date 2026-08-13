import { type NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { planConstructionPackage } from '@/workflows/construction-package'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({ sceneId: z.string().min(1).max(64) })

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/** Starts the durable, scene-wide formwork planning workflow. Returns immediately with a runId. */
export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const run = await start(planConstructionPackage, [parsed.data.sceneId])
    return NextResponse.json({ runId: run.runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return sceneApiJson(
      request,
      { error: 'workflow_start_failed', details: message },
      { status: 502 },
    )
  }
}
