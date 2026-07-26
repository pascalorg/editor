import { getRun } from 'workflow/api'
import { type NextRequest, NextResponse } from 'next/server'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/** Polls a construction-plan workflow run: status, and its return value once complete. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { runId } = await params
  try {
    const run = getRun(runId)
    const status = await run.status
    if (status === 'completed') {
      return NextResponse.json({ status, result: await run.returnValue })
    }
    return NextResponse.json({ status })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return sceneApiJson(request, { error: 'run_not_found', details: message }, { status: 404 })
  }
}
