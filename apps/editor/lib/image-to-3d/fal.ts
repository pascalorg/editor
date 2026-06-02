import { generateFalQueuedImageTo3D, isRecord } from './fal-queue'
import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ProviderFile } from './types'

const DEFAULT_FAL_IMAGE_TO_3D_MODEL = 'tripo3d/tripo/v2.5/image-to-3d'
const TEXTURE_VALUES = new Set(['no', 'standard', 'HD'])
const TEXTURE_ALIGNMENT_VALUES = new Set(['original_image', 'geometry'])
const ORIENTATION_VALUES = new Set(['default', 'align_image'])

function model() {
  return process.env.FAL_IMAGE_TO_3D_MODEL || DEFAULT_FAL_IMAGE_TO_3D_MODEL
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

function integerEnv(name: string) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return undefined
  return Math.max(1000, Math.min(500_000, Math.trunc(value)))
}

function enumEnv(name: string, values: Set<string>, fallback: string) {
  const value = process.env[name]?.trim()
  return value && values.has(value) ? value : fallback
}

function extractFile(value: unknown): ProviderFile | null {
  if (typeof value === 'string' && value) return { url: value }
  if (!isRecord(value) || typeof value.url !== 'string' || !value.url) return null
  return {
    url: value.url,
    content_type: typeof value.content_type === 'string' ? value.content_type : undefined,
    file_name: typeof value.file_name === 'string' ? value.file_name : undefined,
    file_size: typeof value.file_size === 'number' ? value.file_size : undefined,
  }
}

function firstFile(value: unknown): ProviderFile | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const file = extractFile(entry)
      if (file) return file
    }
  }
  return extractFile(value)
}

function firstGlbFile(...values: unknown[]): ProviderFile | null {
  const files = values.map(firstFile).filter((file): file is ProviderFile => Boolean(file))
  return (
    files.find((file) => {
      const url = file.url.toLowerCase()
      const contentType = file.content_type?.toLowerCase() ?? ''
      const name = file.file_name?.toLowerCase() ?? ''
      return url.includes('.glb') || name.endsWith('.glb') || contentType.includes('gltf')
    }) ??
    files[0] ??
    null
  )
}

export function normalizeFalImageTo3DResponse(
  raw: unknown,
): Omit<GenerateImageTo3DResult, 'provider' | 'requestId' | 'raw'> {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : raw
  if (!isRecord(data)) {
    throw new Error('fal returned an invalid response')
  }

  const model =
    firstGlbFile(data.pbr_model, data.model_mesh, data.base_model) ??
    extractFile(data.model_glb) ??
    firstFile(data.individual_glbs) ??
    extractFile(data.artifacts_zip)
  if (!model) {
    throw new Error('fal response did not include a GLB model URL')
  }

  const thumbnail =
    extractFile(data.rendered_image) ??
    extractFile(data.thumbnail) ??
    extractFile(data.preview) ??
    firstFile(data.images) ??
    firstFile(data.previews)

  return {
    modelGlbUrl: model.url,
    thumbnailUrl: thumbnail?.url,
    metadata: {
      ...(isRecord(data.metadata) ? data.metadata : {}),
      taskId: typeof data.task_id === 'string' ? data.task_id : undefined,
      modelFileSize: model.file_size,
    },
  }
}

export const normalizeFalSam3DResponse = normalizeFalImageTo3DResponse

function tripoInput(request: GenerateImageTo3DInput) {
  const payload: Record<string, unknown> = {
    image_url: request.imageDataUri,
    face_limit: integerEnv('FAL_IMAGE_TO_3D_FACE_LIMIT') ?? 50_000,
    pbr: booleanEnv('FAL_IMAGE_TO_3D_PBR', true),
    texture: enumEnv('FAL_IMAGE_TO_3D_TEXTURE', TEXTURE_VALUES, 'standard'),
    auto_size: booleanEnv('FAL_IMAGE_TO_3D_AUTO_SIZE', true),
    quad: booleanEnv('FAL_IMAGE_TO_3D_QUAD', false),
    texture_alignment: enumEnv(
      'FAL_IMAGE_TO_3D_TEXTURE_ALIGNMENT',
      TEXTURE_ALIGNMENT_VALUES,
      'original_image',
    ),
    orientation: enumEnv('FAL_IMAGE_TO_3D_ORIENTATION', ORIENTATION_VALUES, 'default'),
  }

  const seed = integerEnv('FAL_IMAGE_TO_3D_SEED')
  if (seed !== undefined) payload.seed = seed
  const textureSeed = integerEnv('FAL_IMAGE_TO_3D_TEXTURE_SEED')
  if (textureSeed !== undefined) payload.texture_seed = textureSeed

  return payload
}

export async function generateFalImageTo3D(
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  return generateFalQueuedImageTo3D(input, {
    provider: 'fal',
    model: model(),
    input: tripoInput,
    normalize: normalizeFalImageTo3DResponse,
  })
}

export const generateFalSam3DObjects = generateFalImageTo3D
