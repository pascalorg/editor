import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

type SavedAsset = {
  id: string
  category: string
  name: string
  thumbnail: string
  floorPlanUrl: string
  source: 'mine'
  src: string
  dimensions: [number, number, number]
  tags: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findRepoRoot() {
  let current = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    const hasRootShape =
      (await exists(path.join(current, 'package.json'))) &&
      (await exists(path.join(current, 'apps', 'editor', 'public')))
    if (hasRootShape) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

function sanitizeSegment(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  return normalized || fallback
}

function positiveDimensions(value: unknown): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    const next = value.slice(0, 3).map((item) => Number(item))
    if (next.every((item) => Number.isFinite(item) && item > 0)) {
      return [
        Math.max(0.05, Number(next[0])),
        Math.max(0.05, Number(next[1])),
        Math.max(0.05, Number(next[2])),
      ]
    }
  }
  return [1, 1, 1]
}

async function readManifest(manifestPath: string): Promise<SavedAsset[]> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed.filter(isRecord) as SavedAsset[]) : []
  } catch {
    return []
  }
}

async function writeManifest(manifestPath: string, assets: SavedAsset[]) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  const tmp = `${manifestPath}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(assets, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, manifestPath)
}

async function exportModelGlb(
  repoRoot: string,
  recordId: string,
  outputPath: string,
  thumbnailPath: string,
  floorPlanPath: string,
) {
  const articraftRoot = path.join(repoRoot, 'articraft')
  const exportScript = path.join(articraftRoot, 'python', 'export_pascal_asset.py')
  if (!(await exists(exportScript))) {
    throw new Error(
      `Articraft checkout not found at ${articraftRoot}. Clone or link it locally before saving generated assets.`,
    )
  }
  const { stdout, stderr } = await execFileAsync(
    process.platform === 'win32' ? 'uv.cmd' : 'uv',
    [
      'run',
      'python',
      'python/export_pascal_asset.py',
      recordId,
      outputPath,
      '--repo-root',
      articraftRoot,
      '--thumbnail-path',
      thumbnailPath,
      '--floor-plan-path',
      floorPlanPath,
    ],
    {
      cwd: articraftRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true,
    },
  )
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!lastLine) {
    throw new Error(stderr.trim() || 'Articraft export produced no output')
  }
  return JSON.parse(lastLine) as Record<string, unknown>
}

export async function GET() {
  const repoRoot = await findRepoRoot()
  const manifestPath = path.join(
    repoRoot,
    'apps',
    'editor',
    'public',
    'items',
    'articraft-assets.json',
  )
  const assets = await readManifest(manifestPath)
  return NextResponse.json({ assets })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const recordId = typeof body.recordId === 'string' ? body.recordId.trim() : ''
  if (!/^rec_[A-Za-z0-9._-]+$/.test(recordId)) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 })
  }

  const repoRoot = await findRepoRoot()
  const assetId = sanitizeSegment(`articraft-${recordId}`, `articraft-${Date.now()}`)
  const itemRoot = path.join(repoRoot, 'apps', 'editor', 'public', 'items')
  const assetDir = path.join(itemRoot, assetId)
  const manifestPath = path.join(itemRoot, 'articraft-assets.json')
  const modelPath = path.join(assetDir, 'model.glb')
  const thumbnailPath = path.join(assetDir, 'thumbnail.png')
  const floorPlanPath = path.join(assetDir, 'floor-plan.png')

  await fs.mkdir(assetDir, { recursive: true })

  let exportInfo: Record<string, unknown>
  try {
    exportInfo = await exportModelGlb(repoRoot, recordId, modelPath, thumbnailPath, floorPlanPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Failed to export Articraft model: ${message}` },
      { status: 500 },
    )
  }

  const createdAt = new Date().toISOString()
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : sanitizeSegment(recordId.replace(/^rec_/, ''), 'Articraft asset')
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const recordPath = typeof body.recordPath === 'string' ? body.recordPath : ''
  const joints = Array.isArray(body.joints) ? body.joints : []

  await fs.writeFile(
    path.join(assetDir, 'articraft.json'),
    `${JSON.stringify({ recordId, recordPath, prompt, joints, createdAt }, null, 2)}\n`,
    'utf8',
  )

  const asset: SavedAsset = {
    id: assetId,
    category: 'equipment',
    name,
    thumbnail: `/items/${assetId}/thumbnail.png`,
    floorPlanUrl: `/items/${assetId}/floor-plan.png`,
    source: 'mine',
    src: `/items/${assetId}/model.glb`,
    dimensions: positiveDimensions(exportInfo.dimensions),
    tags: ['floor', 'articraft', 'generated'],
  }

  const manifest = await readManifest(manifestPath)
  const nextManifest = [asset, ...manifest.filter((item) => item.id !== assetId)]
  await writeManifest(manifestPath, nextManifest)

  return NextResponse.json({ asset, assetDir })
}
