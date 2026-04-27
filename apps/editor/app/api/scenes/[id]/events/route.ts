import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const POLL_MS = 250
const HEARTBEAT_MS = 15_000
const MAX_EVENTS_PER_POLL = 50

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()

  if (!operations.canListSceneEvents) {
    return sceneApiJson(request, { error: 'scene_events_unavailable' }, { status: 501 })
  }

  const scene = await operations.loadStoredScene(id)
  if (!scene) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterFromQuery = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
  const afterFromHeader = Number.parseInt(request.headers.get('Last-Event-ID') ?? '0', 10)
  let cursor = Math.max(
    0,
    Number.isFinite(afterFromQuery) ? afterFromQuery : 0,
    Number.isFinite(afterFromHeader) ? afterFromHeader : 0,
  )

  const encoder = new TextEncoder()
  let closed = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }

      const close = () => {
        if (closed) return
        closed = true
        if (pollTimer) clearTimeout(pollTimer)
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try {
          controller.close()
        } catch {
          // The client may have already closed the stream.
        }
      }

      request.signal.addEventListener('abort', close, { once: true })
      enqueue('retry: 1000\n\n')

      const poll = async () => {
        if (closed) return
        try {
          const events = await operations.listSceneEvents(id, {
            afterEventId: cursor,
            limit: MAX_EVENTS_PER_POLL,
          })
          for (const event of events) {
            cursor = event.eventId
            enqueue(`id: ${event.eventId}\n`)
            enqueue('event: scene\n')
            enqueue(`data: ${JSON.stringify(event)}\n\n`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          enqueue('event: error\n')
          enqueue(`data: ${JSON.stringify({ message })}\n\n`)
        } finally {
          if (!closed) pollTimer = setTimeout(poll, POLL_MS)
        }
      }

      heartbeatTimer = setInterval(() => enqueue(': keepalive\n\n'), HEARTBEAT_MS)
      void poll()
    },
    cancel() {
      closed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    },
  })

  return withSceneApiHeaders(
    request,
    new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    }),
  )
}
