import fs from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'
import {
  createGeneratedAssetId,
  findRepoRoot,
  generatedManifestPath,
  itemRoot,
  upsertGeneratedAsset,
} from '@/lib/generated-assets/manifest'
import { generateImageTo3D, resolveImageTo3DProvider } from './provider'

export const ACCEPTED_IMAGE_TO_3D_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const CATALOG_CATEGORIES = new Set([
  'electronics',
  'equipment',
  'structural',
  'nature',
  'outdoor',
  'vehicle',
])
const CATALOG_CATEGORY_ALIASES = new Map([
  ['safety', 'electronics'],
  ['lighting', 'electronics'],
  ['electrical', 'electronics'],
  ['hvac', 'electronics'],
  ['opening', 'structural'],
  ['infrastructure', 'outdoor'],
])

const FALLBACK_THUMBNAIL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAGXRFWHRTb2Z0d2FyZQBwYXNjYWwtaW1hZ2UtdG8tM2QbjmzRAAABhUlEQVR4nO3aQU7CQBBA0QfZ+18u8QbYQIoJEYlG0ifhq9OZqgQYmOm1WgAAAAAAAAAA+M9wH/d1rK3bTu9rD+fzlnW9nT5a4vLx1eF8+L4u46bQpSgJgZgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgQgv8FSXYKp+uXyNMAAAAASUVORK5CYII=',
  'base64',
)

export class ImageTo3DGenerateError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message)
    this.name = 'ImageTo3DGenerateError'
  }
}

export type GenerateImageTo3DAssetInput = {
  image: {
    name: string
    type: string
    buffer: Buffer
  }
  prompt?: string
  displayName?: string
  category?: string
  provider?: string
  save?: boolean
  onProgress?: (message: string) => void
}

export type GenerateImageTo3DAssetResult = {
  asset: AssetInput & { id: string; source: 'mine' }
  saved: boolean
}

export function maxImageTo3DImageBytes() {
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

function normalizeApiKey(value: string | undefined) {
  return value?.trim().replace(/^bearer\s+/i, '') || undefined
}

function normalizeCatalogCategory(value: string) {
  const normalized = CATALOG_CATEGORY_ALIASES.get(value) ?? value
  return CATALOG_CATEGORIES.has(normalized) ? normalized : 'equipment'
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

type Vec3 = [number, number, number]

type GlbAssetTransform = {
  dimensions: Vec3
  offset: Vec3
}

function finitePositiveDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.max(0.05, value) : null
}

async function readGlbAssetTransform(modelPath: string): Promise<GlbAssetTransform | null> {
  try {
    const [{ Box3, Vector3 }, { GLTFLoader }] = await Promise.all([
      // @ts-expect-error apps/editor does not ship app-local three declarations.
      import('three'),
      // @ts-expect-error apps/editor does not ship app-local three declarations.
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ])
    ;(globalThis as unknown as { self?: unknown }).self ??= globalThis
    const buffer = await fs.readFile(modelPath)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer
    const loader = new GLTFLoader()
    const gltf = await new Promise<{ scene: unknown }>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject)
    })
    const box = new Box3().setFromObject(gltf.scene)
    const size = new Vector3()
    box.getSize(size)
    const width = finitePositiveDimension(size.x)
    const height = finitePositiveDimension(size.y)
    const depth = finitePositiveDimension(size.z)
    if (!width || !height || !depth || !Number.isFinite(box.min.y)) return null

    return {
      dimensions: [width, height, depth],
      offset: [0, -box.min.y, 0],
    }
  } catch (error) {
    console.warn('[image-to-3d] Failed to read GLB bounds for asset placement', error)
    return null
  }
}

function resolveProviderConfig(providerRaw: string | undefined) {
  const provider = resolveImageTo3DProvider(
    providerRaw || process.env.IMAGE_TO_3D_PROVIDER || 'fal',
  )
  const tripoApiKey = normalizeApiKey(process.env.TRIPO3D_API_KEY ?? process.env.APIKEY)
  const apiKey =
    provider === 'tripo' ? tripoApiKey : provider === 'fal' ? process.env.FAL_KEY : undefined

  if (provider === 'fal' && !process.env.FAL_KEY) {
    throw new ImageTo3DGenerateError('FAL_KEY is not configured on the server', 500)
  }
  if (provider === 'tripo') {
    if (!tripoApiKey) {
      throw new ImageTo3DGenerateError('TRIPO3D_API_KEY is not configured on the server', 500)
    }
    if (tripoApiKey.startsWith('tcli_')) {
      throw new ImageTo3DGenerateError(
        'TRIPO3D_API_KEY must be the Tripo secret key from API Keys, usually starting with tsk_. Do not use the tcli_ client id.',
        500,
      )
    }
  }
  if (
    provider === 'hunyuan3d' &&
    (!process.env.TENCENTCLOUD_SECRET_ID || !process.env.TENCENTCLOUD_SECRET_KEY)
  ) {
    throw new ImageTo3DGenerateError(
      'TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are not configured on the server',
      500,
    )
  }
  if (provider === 'hunyuan3d' && providerRaw && providerRaw.length > 0) {
    // providerRaw is intentionally consumed above; validation stays in generateImageTo3DAsset.
  }
  return { provider, apiKey }
}

export async function generateImageTo3DAsset({
  image,
  prompt: promptInput,
  displayName: displayNameInput,
  category: categoryInput,
  provider: providerInput,
  save = true,
  onProgress,
}: GenerateImageTo3DAssetInput): Promise<GenerateImageTo3DAssetResult> {
  if (!ACCEPTED_IMAGE_TO_3D_IMAGE_TYPES.has(image.type)) {
    throw new ImageTo3DGenerateError('Unsupported image type. Use PNG, JPEG, or WebP.', 400)
  }
  if (image.buffer.byteLength > maxImageTo3DImageBytes()) {
    throw new ImageTo3DGenerateError('Image is too large', 413)
  }

  const { provider, apiKey } = resolveProviderConfig(providerInput)
  if (provider === 'hunyuan3d' && image.buffer.byteLength > 8 * 1024 * 1024) {
    throw new ImageTo3DGenerateError('Hunyuan3D images must be 8MB or smaller', 413)
  }

  const prompt = promptInput?.trim() || 'object'
  const displayName = displayNameInput?.trim() || prompt || image.name || 'Image to 3D asset'
  const category = normalizeCatalogCategory(categoryInput?.trim() || 'equipment')
  const imageDataUri = `data:${image.type};base64,${image.buffer.toString('base64')}`

  onProgress?.(`Calling ${provider} image-to-3D provider...`)
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
    throw new ImageTo3DGenerateError(`Image-to-3D generation failed: ${message}`, 502)
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
  let glbAssetTransform: GlbAssetTransform | null = null

  try {
    onProgress?.('Persisting generated model asset...')
    await fs.rm(tmpDir, { force: true, recursive: true })
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(sourceImagePath, image.buffer)
    await downloadFile(generated.modelGlbUrl, modelPath)
    glbAssetTransform = await readGlbAssetTransform(modelPath)
    if (generated.thumbnailUrl) {
      await downloadFile(generated.thumbnailUrl, thumbnailPath)
    } else if (image.type === 'image/png') {
      await fs.writeFile(thumbnailPath, image.buffer)
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
          assetTransform: glbAssetTransform,
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
    throw new ImageTo3DGenerateError(`Failed to persist generated asset: ${message}`, 500)
  }

  const asset: AssetInput & { id: string; source: 'mine' } = {
    id: assetId,
    category,
    name: displayName,
    thumbnail: thumbnailUrl,
    floorPlanUrl: thumbnailUrl,
    source: 'mine',
    src: `/items/${assetId}/model.glb`,
    dimensions: glbAssetTransform?.dimensions ?? dimensionsFromMetadata(generated.metadata),
    offset: glbAssetTransform?.offset ?? [0, 0, 0],
    tags: ['floor', 'generated', 'image-to-3d', generated.provider],
  }

  if (save) {
    onProgress?.('Updating generated asset manifest...')
    await upsertGeneratedAsset(generatedManifestPath(repoRoot), asset)
  }

  return { asset, saved: save }
}
