import { type NextRequest, NextResponse } from 'next/server'
import { generateModel } from '../../../../../../packages/articraft-bridge/src/cli'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { prompt?: string; mode?: 'articulated' | 'static' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const mode = body.mode === 'static' ? 'static' : 'articulated'

  // SSE streaming response
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const result = await generateModel({
          prompt,
          mode,
          onProgress: (message: string) => {
            enqueue({ type: 'progress', message })
          },
        })
        enqueue({ type: 'result', data: result })
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        enqueue({ type: 'error', message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
