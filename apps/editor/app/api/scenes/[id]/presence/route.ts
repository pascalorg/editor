import { z } from 'zod'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getScenePresenceHub } from '@/lib/scene-presence-server'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const presenceSchema = z.object({
  actorId: z.string().min(1).max(128),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  cursor: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .nullable(),
  name: z.string().min(1).max(80),
  selectedIds: z.array(z.string().min(1)).max(256),
})

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = await guardSceneApiRequest(request, { skipRateLimit: true })
  if (guard) return guard
  const { id } = await params
  const scene = await (await getSceneOperations()).loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const encoder = new TextEncoder()
  let stop = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        stop()
        if (heartbeat) clearInterval(heartbeat)
        try {
          controller.close()
        } catch {}
      }
      request.signal.addEventListener('abort', close, { once: true })
      controller.enqueue(encoder.encode('retry: 1000\n\n'))
      stop = getScenePresenceHub().subscribe(id, (participants) => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`event: presence\ndata: ${JSON.stringify({ participants })}\n\n`),
          )
        }
      })
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'))
      }, 15_000)
    },
    cancel() {
      stop()
      if (heartbeat) clearInterval(heartbeat)
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

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await guardSceneApiRequest(request, { skipRateLimit: true })
  if (guard) return guard
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = presenceSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const { id } = await params
  const hub = getScenePresenceHub()
  if (!hub.hasRoom(id)) {
    const scene = await (await getSceneOperations()).loadStoredScene(id)
    if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  const participants = hub.upsert(id, parsed.data)
  return sceneApiJson(request, { participants })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const guard = await guardSceneApiRequest(request, { skipRateLimit: true })
  if (guard) return guard
  const actorId = new URL(request.url).searchParams.get('actorId')
  if (!actorId) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  const { id } = await params
  getScenePresenceHub().remove(id, actorId)
  return withSceneApiHeaders(request, new Response(null, { status: 204 }))
}
