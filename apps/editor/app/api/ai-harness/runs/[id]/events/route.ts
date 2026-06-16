import { ensureArticraftRunRunning } from '@/lib/ai-harness-runs/articraft-runner'
import { ensureImageTo3DRunRunning } from '@/lib/ai-harness-runs/image-to-3d-runner'
import { ensurePrimitiveRunRunning } from '@/lib/ai-harness-runs/primitive-runner'
import { isTerminalStatus, listRunEvents, loadRun } from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const POLL_MS = 500
const HEARTBEAT_MS = 15_000
const MAX_EVENTS_PER_POLL = 100

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (run.mode === 'articraft' && !isTerminalStatus(run.status)) {
    ensureArticraftRunRunning(run.id)
  } else if (run.mode === 'image-to-3d' && !isTerminalStatus(run.status)) {
    ensureImageTo3DRunRunning(run.id)
  } else if (run.mode === 'primitive' && !isTerminalStatus(run.status)) {
    ensurePrimitiveRunRunning(run.id)
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
          // Client may already be gone.
        }
      }

      request.signal.addEventListener('abort', close, { once: true })
      enqueue('retry: 1000\n\n')

      const poll = async () => {
        if (closed) return
        try {
          const events = await listRunEvents(id, { after: cursor, limit: MAX_EVENTS_PER_POLL })
          if (events.length > 0) {
          }
          for (const event of events) {
            cursor = event.id
            enqueue(`id: ${event.id}\n`)
            enqueue(`event: ${event.type}\n`)
            enqueue(`data: ${JSON.stringify(event)}\n\n`)
          }
          const current = await loadRun(id)
          if (current && isTerminalStatus(current.status) && events.length === 0) {
            close()
            return
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

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  })
}
