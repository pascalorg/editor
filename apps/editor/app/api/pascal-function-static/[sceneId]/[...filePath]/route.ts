import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ sceneId: string; filePath: string[] }> }

const ALLOWED_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
])

function isSafeSceneId(sceneId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(sceneId)
}

function isSafeFilePath(filePath: string[]): boolean {
  return (
    filePath.length > 0 &&
    filePath.every((part) => part.length > 0 && part !== '.' && part !== '..' && path.basename(part) === part)
  )
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { sceneId, filePath } = await params
  const contentType = ALLOWED_EXTENSIONS.get(path.extname(filePath.at(-1) ?? '').toLowerCase())

  if (!isSafeSceneId(sceneId) || !isSafeFilePath(filePath) || !contentType) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const root = path.resolve(process.cwd(), '..', '..', 'pascal-function-statuc')
  const sceneRoot = path.join(root, sceneId)
  const resolvedFilePath = path.resolve(sceneRoot, ...filePath)

  if (!resolvedFilePath.startsWith(`${sceneRoot}${path.sep}`)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const info = await stat(resolvedFilePath)
    if (!info.isFile()) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const stream = Readable.toWeb(createReadStream(resolvedFilePath)) as ReadableStream<Uint8Array>
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
