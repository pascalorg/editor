import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ sceneId: string; fileName: string }> }

const ALLOWED_FILES = new Map([
  ['panorama.jpg', 'image/jpeg'],
  ['walkthrough.mp4', 'video/mp4'],
])

function isSafeSceneId(sceneId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(sceneId)
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { sceneId, fileName } = await params
  const contentType = ALLOWED_FILES.get(fileName)

  if (!isSafeSceneId(sceneId) || !contentType) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const root = path.resolve(process.cwd(), '..', '..', 'pascal-function-statuc')
  const filePath = path.join(root, sceneId, fileName)

  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Length': String(info.size),
        'Content-Type': contentType,
      },
    })
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
}
