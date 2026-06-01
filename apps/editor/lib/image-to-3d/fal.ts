import { generateFalQueuedImageTo3D, isRecord } from './fal-queue'
import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ProviderFile } from './types'

const FAL_SAM_3D_MODEL = 'fal-ai/sam-3/3d-objects'

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

export function normalizeFalSam3DResponse(
  raw: unknown,
): Omit<GenerateImageTo3DResult, 'provider' | 'requestId' | 'raw'> {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : raw
  if (!isRecord(data)) {
    throw new Error('fal returned an invalid response')
  }

  const model =
    extractFile(data.model_glb) ??
    firstFile(data.individual_glbs) ??
    extractFile(data.artifacts_zip)
  if (!model) {
    throw new Error('fal response did not include a GLB model URL')
  }

  const thumbnail =
    extractFile(data.thumbnail) ??
    extractFile(data.preview) ??
    firstFile(data.images) ??
    firstFile(data.previews)

  return {
    modelGlbUrl: model.url,
    thumbnailUrl: thumbnail?.url,
    metadata: data.metadata ?? {},
  }
}

export async function generateFalSam3DObjects(
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  return generateFalQueuedImageTo3D(input, {
    provider: 'fal',
    model: FAL_SAM_3D_MODEL,
    input: (request) => ({
      image_url: request.imageDataUri,
      prompt: request.prompt?.trim() || 'object',
      point_prompts: [],
      box_prompts: [],
      export_textured_glb: true,
    }),
    normalize: normalizeFalSam3DResponse,
  })
}
