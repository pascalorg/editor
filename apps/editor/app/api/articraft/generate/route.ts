import { type NextRequest, NextResponse } from 'next/server'
import { generateModel } from '../../../../../../packages/articraft-bridge/src/cli'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function compactLogMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim().slice(0, 700)
}

function positiveIntEnv(...names: string[]) {
  for (const name of names) {
    const value = Number.parseInt(process.env[name] ?? '', 10)
    if (Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

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
  const maxTurns = positiveIntEnv('ARTICRAFT_AI_MAX_TURNS', 'ARTICRAFT_MAX_TURNS')
  const startedAt = Date.now()
  console.log(
    `[articraft/generate] start mode=${mode} max_turns=${maxTurns ?? 'default'} prompt="${compactLogMessage(prompt).slice(0, 120)}"`,
  )

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
          maxTurns,
          onProgress: (message: string) => {
            console.log(`[articraft/generate] ${compactLogMessage(message)}`)
            enqueue({ type: 'progress', message })
          },
        })
        console.log(
          `[articraft/generate] complete record=${result.recordId} elapsed=${Date.now() - startedAt}ms`,
        )
        enqueue({ type: 'result', data: result })
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          `[articraft/generate] failed elapsed=${Date.now() - startedAt}ms ${compactLogMessage(message)}`,
        )
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
