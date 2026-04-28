import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const LOG_PATH = path.resolve(process.cwd(), '../../.codex/runtime-logs/room-groups-debug.jsonl')

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as unknown
    await mkdir(path.dirname(LOG_PATH), { recursive: true })
    await appendFile(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), payload })}\n`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    await mkdir(path.dirname(LOG_PATH), { recursive: true }).catch(() => {})
    await appendFile(
      LOG_PATH,
      `${JSON.stringify({
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    ).catch(() => {})
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
