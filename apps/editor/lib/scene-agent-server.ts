import { guardSceneApiRequest, sceneApiJson } from './scene-api-security'

export function isAgentManagedScene(sceneId: string): boolean {
  return Boolean(sceneId && process.env.PASCAL_AGENT_SCENE_ID === sceneId)
}

export async function forwardSceneAgentRequest(
  request: Request,
  sceneId: string,
  action: '' | 'events' | 'pause' | 'stop' | 'resume' | 'human-edit',
  body?: unknown,
): Promise<Response> {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  if (!isAgentManagedScene(sceneId)) {
    return sceneApiJson(request, { error: 'agent_not_configured' }, { status: 404 })
  }
  try {
    const url = new URL(process.env.PASCAL_AGENT_ACTIVITY_URL ?? '')
    const token = process.env.PASCAL_AGENT_ACTIVITY_TOKEN
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      !token
    )
      throw new Error('Invalid activity service configuration')
    url.pathname = `/activity${action ? `/${action}` : ''}`
    url.search = ''
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Pascal-Scene-Id': sceneId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal:
        action === 'events'
          ? request.signal
          : AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    })
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch {
    return sceneApiJson(request, { error: 'agent_control_unavailable' }, { status: 503 })
  }
}
