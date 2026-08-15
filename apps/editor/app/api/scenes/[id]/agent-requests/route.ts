import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

/**
 * The editor's half of the agent prompt channel.
 *
 * MCP is client-driven, so the editor cannot message a connected agent. It
 * leaves the prompt here instead; the agent's `await_editor_request` tool
 * claims it out of the same database the live-sync events already flow through.
 * `GET` is how the editor learns the prompt was picked up and answered.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const MAX_PROMPT_LENGTH = 4000

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canServeAgentRequests) {
    return sceneApiJson(request, { error: 'agent_requests_unavailable' }, { status: 501 })
  }

  const url = new URL(request.url)
  const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
  const requests = await operations.listAgentRequests(id, {
    afterRequestId: Number.isFinite(after) && after > 0 ? after : 0,
  })

  return sceneApiJson(request, { requests })
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canServeAgentRequests) {
    return sceneApiJson(request, { error: 'agent_requests_unavailable' }, { status: 501 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_json' }, { status: 400 })
  }

  const prompt = (body as { prompt?: unknown } | null)?.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return sceneApiJson(request, { error: 'prompt_required' }, { status: 400 })
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sceneApiJson(request, { error: 'prompt_too_long' }, { status: 413 })
  }

  const scene = await operations.loadStoredScene(id)
  if (!scene) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const created = await operations.createAgentRequest({ sceneId: id, prompt })
  if (!created) {
    return sceneApiJson(request, { error: 'agent_requests_unavailable' }, { status: 501 })
  }

  return sceneApiJson(request, { request: created }, { status: 201 })
}
