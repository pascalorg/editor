import fs from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createGeneratedAssetId,
  findRepoRoot,
  generatedManifestPath,
  itemRoot,
  upsertGeneratedAsset,
} from '@/lib/generated-assets/manifest'
import { generateImageTo3D, resolveImageTo3DProvider } from '@/lib/image-to-3d'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const CATALOG_CATEGORIES = new Set([
  'safety',
  'electrical',
  'hvac',
  'lighting',
  'electronics',
  'equipment',
  'structural',
  'infrastructure',
  'opening',
  'nature',
  'outdoor',
  'vehicle',
])

const FALLBACK_THUMBNAIL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAGXRFWHRTb2Z0d2FyZQBwYXNjYWwtaW1hZ2UtdG8tM2QbjmzRAAABhUlEQVR4nO3aQU7CQBBA0QfZ+18u8QbYQIoJEYlG0ifhq9OZqgQYmOm1WgAAAAAAAAAA+M9wH/d1rK3bTu9rD+fzlnW9nT5a4vLx1eF8+L4u46bQpSgJgZgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgv8FSXYKp+uXyNMAAAAASUVORK5CYII=',
  'base64',
)

function maxImageBytes() {
  const mb = Number(process.env.IMAGE_TO_3D_MAX_IMAGE_MB ?? 10)
  return Math.max(1, Math.min(50, Number.isFinite(mb) ? mb : 10)) * 1024 * 1024
}

function timeoutMs() {
  const seconds = Number(process.env.IMAGE_TO_3D_TIMEOUT_SECONDS ?? 600)
  return Math.max(60, Math.min(3600, Number.isFinite(seconds) ? seconds : 600)) * 1000
}

function imageExt(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

function readText(value: FormDataEntryValue | null, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readBool(value: FormDataEntryValue | null, fallback: boolean) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  return fallback
}

async function downloadFile(url: string, outPath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(outPath, buffer)
  return buffer.length
}

export async function replaceAssetDir(tmpDir: string, assetDir: string) {
  await fs.rm(assetDir, { force: true, recursive: true })
  try {
    await fs.rename(tmpDir, assetDir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EXDEV') throw error

    await fs.rm(assetDir, { force: true, recursive: true })
    await fs.cp(tmpDir, assetDir, { recursive: true })
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
}

function firstFiniteVec3(value: unknown): [number, number, number] | null {
  if (Array.isArray(value) && value.length >= 3) {
    const next = value.slice(0, 3).map((item) => Number(item))
    if (next.every((item) => Number.isFinite(item) && item > 0)) {
      return [next[0]!, next[1]!, next[2]!]
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstFiniteVec3(item)
      if (nested) return nested
    }
  }
  return null
}

function dimensionsFromMetadata(metadata: unknown): [number, number, number] {
  const scale = firstFiniteVec3(metadata)
  return scale
    ? [Math.max(0.05, scale[0]), Math.max(0.05, scale[1]), Math.max(0.05, scale[2])]
    : [1, 1, 1]
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const image = form.get('image')
  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'image file is required' }, { status: 400 })
  }
  if (!ACCEPTED_IMAGE_TYPES.has(image.type)) {
    return NextResponse.json(
      { error: 'Unsupported image type. Use PNG, JPEG, or WebP.' },
      { status: 400 },
    )
  }
  if (image.size > maxImageBytes()) {
    return NextResponse.json({ error: 'Image is too large' }, { status: 413 })
  }

  const provider = resolveImageTo3DProvider(
    readText(form.get('provider'), process.env.IMAGE_TO_3D_PROVIDER ?? 'fal'),
  )
  const apiKey = process.env.FAL_KEY
  if (provider === 'fal' && !apiKey) {
    return NextResponse.json({ error: 'FAL_KEY is not configured on the server' }, { status: 500 })
  }
  if (
    provider === 'hunyuan3d' &&
    (!process.env.TENCENTCLOUD_SECRET_ID || !process.env.TENCENTCLOUD_SECRET_KEY)
  ) {
    return NextResponse.json(
      {
        error:
          'TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are not configured on the server',
      },
      { status: 500 },
    )
  }
  if (provider === 'hunyuan3d' && image.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Hunyuan3D images must be 8MB or smaller' }, { status: 413 })
  }

  const prompt = readText(form.get('prompt'), 'object')
  const displayName = readText(form.get('name'), prompt || image.name || 'Image to 3D asset')
  const categoryRaw = readText(form.get('category'), 'equipment')
  const category = CATALOG_CATEGORIES.has(categoryRaw) ? categoryRaw : 'equipment'
  const shouldSave = readBool(form.get('save'), true)
  const imageBuffer = Buffer.from(await image.arrayBuffer())
  const imageDataUri = `data:${image.type};base64,${imageBuffer.toString('base64')}`

  let generated
  try {
    generated = await generateImageTo3D(provider, {
      imageDataUri,
      prompt,
      apiKey,
      timeoutMs: timeoutMs(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Image-to-3D generation failed: ${message}` },
      { status: 502 },
    )
  }

  const repoRoot = await findRepoRoot()
  const root = itemRoot(repoRoot)
  const assetId = createGeneratedAssetId('image-to-3d', displayName)
  const assetDir = path.join(root, assetId)
  const tmpDir = `${assetDir}.tmp`
  const sourceExt = imageExt(image.type)
  const sourceImagePath = path.join(tmpDir, `source-image.${sourceExt}`)
  const modelPath = path.join(tmpDir, 'model.glb')
  const thumbnailPath = path.join(tmpDir, 'thumbnail.png')
  const sourceImagePublicUrl = `/items/${assetId}/source-image.${sourceExt}`
  let thumbnailUrl = `/items/${assetId}/thumbnail.png`

  try {
    await fs.rm(tmpDir, { force: true, recursive: true })
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(sourceImagePath, imageBuffer)
    await downloadFile(generated.modelGlbUrl, modelPath)
    if (generated.thumbnailUrl) {
      await downloadFile(generated.thumbnailUrl, thumbnailPath)
    } else if (image.type === 'image/png') {
      await fs.writeFile(thumbnailPath, imageBuffer)
    } else {
      await fs.writeFile(thumbnailPath, FALLBACK_THUMBNAIL_PNG)
      thumbnailUrl = sourceImagePublicUrl
    }

    await fs.writeFile(
      path.join(tmpDir, 'image-to-3d.json'),
      `${JSON.stringify(
        {
          provider: generated.provider,
          requestId: generated.requestId,
          prompt,
          sourceImageName: image.name,
          sourceImageType: image.type,
          createdAt: new Date().toISOString(),
          metadata: generated.metadata,
          providerUrls: {
            modelGlbUrl: generated.modelGlbUrl,
            thumbnailUrl: generated.thumbnailUrl,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    await replaceAssetDir(tmpDir, assetDir)
  } catch (error) {
    await fs.rm(tmpDir, { force: true, recursive: true }).catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Failed to persist generated asset: ${message}` },
      { status: 500 },
    )
  }

  const asset: AssetInput = {
    id: assetId,
    category,
    name: displayName,
    thumbnail: thumbnailUrl,
    floorPlanUrl: thumbnailUrl,
    source: 'mine',
    src: `/items/${assetId}/model.glb`,
    dimensions: dimensionsFromMetadata(generated.metadata),
    tags: ['floor', 'generated', 'image-to-3d', generated.provider],
  }

  if (shouldSave) {
    await upsertGeneratedAsset(
      generatedManifestPath(repoRoot),
      asset as AssetInput & { id: string; source: 'mine' },
    )
  }

  return NextResponse.json({ asset, saved: shouldSave })
}
