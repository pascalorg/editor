import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveArticraftMaxTurns } from '@/lib/ai-harness-runs/articraft-turn-budget'
import { generateModel } from '../../../../../../packages/articraft-bridge/src/cli'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function compactLogMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim().slice(0, 700)
}

function parseReferenceImage(value: unknown): { buffer: Buffer; ext: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : ''
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match) return null
  const mime = match[1]?.toLowerCase()
  const payload = match[2]
  if (!mime || !payload) return null
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength > 8 * 1024 * 1024) return null
  return { buffer, ext: mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg' }
}

async function writeReferenceImage(value: unknown) {
  const parsed = parseReferenceImage(value)
  if (!parsed) return undefined
  const filePath = path.join(os.tmpdir(), `pascal-articraft-ref-${randomUUID()}.${parsed.ext}`)
  await fs.writeFile(filePath, parsed.buffer)
  return filePath
}

export async function POST(req: NextRequest) {
  let body: { prompt?: string; mode?: 'articulated' | 'static'; image?: unknown; maxTurns?: unknown }
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
  let imagePath: string | undefined
  try {
    imagePath = await writeReferenceImage(body.image)
  } catch {
    return NextResponse.json({ error: 'Invalid reference image' }, { status: 400 })
  }
  const maxTurns = resolveArticraftMaxTurns(prompt, body.maxTurns)
  const startedAt = Date.now()
  console.log(
    `[articraft/generate] start mode=${mode} image=${imagePath ? 'yes' : 'no'} max_turns=${maxTurns ?? 'default'} prompt="${compactLogMessage(prompt).slice(0, 120)}"`,
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
          imagePath,
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
      } finally {
        if (imagePath) {
          await fs.rm(imagePath, { force: true }).catch(() => {})
        }
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
