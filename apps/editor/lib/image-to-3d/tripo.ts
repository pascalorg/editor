import type { GenerateImageTo3DInput, GenerateImageTo3DResult } from './types'

const DEFAULT_TRIPO_BASE_URL = 'https://api.tripo3d.ai/v2/openapi'
const FINAL_STATUSES = new Set(['success', 'failed', 'banned', 'expired', 'cancelled', 'unknown'])
const ORIENTATION_VALUES = new Set(['default', 'align_image'])
const TEXTURE_ALIGNMENT_VALUES = new Set(['original_image', 'geometry'])
const TEXTURE_QUALITY_VALUES = new Set(['standard', 'detailed'])
const GEOMETRY_QUALITY_VALUES = new Set(['standard', 'detailed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function baseUrl() {
  return (process.env.TRIPO3D_BASE_URL || DEFAULT_TRIPO_BASE_URL).replace(/\/+$/, '')
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

function integerEnv(name: string, min: number, max: number) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function enumEnv(name: string, values: Set<string>, fallback: string) {
  const value = process.env[name]?.trim()
  return value && values.has(value) ? value : fallback
}

async function readJson(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { message: text }
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (!isRecord(data)) return fallback
  return (
    (typeof data.message === 'string' && data.message) ||
    (typeof data.suggestion === 'string' && data.suggestion) ||
    fallback
  )
}

function imageFromDataUri(dataUri: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri)
  if (!match) throw new Error('Tripo requires a base64 data URI image')
  const contentType = match[1]!
  const bytes = Buffer.from(match[2]!, 'base64')
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  return { bytes, contentType, fileName: `source-image.${ext}` }
}

function authHeaders(apiKey: string) {
  const key = apiKey.trim().replace(/^bearer\s+/i, '')
  return { Authorization: `Bearer ${key}` }
}

async function uploadImage(apiKey: string, dataUri: string) {
  const image = imageFromDataUri(dataUri)
  const form = new FormData()
  form.set('file', new File([image.bytes], image.fileName, { type: image.contentType }))

  const paths = Array.from(new Set([process.env.TRIPO3D_UPLOAD_PATH || '/upload', '/upload/sts']))
  let lastError = ''
  for (const uploadPath of paths) {
    const res = await fetch(`${baseUrl()}${uploadPath}`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: form,
    })
    const data = await readJson(res)
    if (!res.ok) {
      lastError = `Tripo upload failed (${res.status}): ${errorMessage(data, res.statusText)}`
      continue
    }
    if (isRecord(data) && data.code !== 0) {
      lastError = `Tripo upload failed: ${errorMessage(data, String(data.code))}`
      continue
    }
    const payload = isRecord(data) && isRecord(data.data) ? data.data : data
    if (isRecord(payload) && typeof payload.image_token === 'string' && payload.image_token) {
      return payload.image_token
    }
    if (isRecord(payload) && typeof payload.file_token === 'string' && payload.file_token) {
      return payload.file_token
    }
    lastError = 'Tripo upload response did not include image_token'
  }
  throw new Error(lastError || 'Tripo upload failed')
}

function buildTaskInput(imageToken: string) {
  const modelVersion = process.env.TRIPO3D_MODEL_VERSION || 'Turbo-v1.0-20250506'
  const payload: Record<string, unknown> = {
    type: 'image_to_model',
    model_version: modelVersion,
    file: {
      type: 'image',
      file_token: imageToken,
    },
    face_limit: integerEnv('TRIPO3D_FACE_LIMIT', 48, 50_000) ?? 50_000,
    texture: booleanEnv('TRIPO3D_TEXTURE', true),
    pbr: booleanEnv('TRIPO3D_PBR', true),
    texture_quality: enumEnv('TRIPO3D_TEXTURE_QUALITY', TEXTURE_QUALITY_VALUES, 'standard'),
    auto_size: booleanEnv('TRIPO3D_AUTO_SIZE', true),
    quad: booleanEnv('TRIPO3D_QUAD', false),
    orientation: enumEnv('TRIPO3D_ORIENTATION', ORIENTATION_VALUES, 'default'),
    texture_alignment: enumEnv(
      'TRIPO3D_TEXTURE_ALIGNMENT',
      TEXTURE_ALIGNMENT_VALUES,
      'original_image',
    ),
    enable_image_autofix: booleanEnv('TRIPO3D_ENABLE_IMAGE_AUTOFIX', false),
  }

  if (modelVersion.startsWith('v3.')) {
    payload.geometry_quality = enumEnv(
      'TRIPO3D_GEOMETRY_QUALITY',
      GEOMETRY_QUALITY_VALUES,
      'standard',
    )
    payload.smart_low_poly = booleanEnv('TRIPO3D_SMART_LOW_POLY', false)
    payload.generate_parts = booleanEnv('TRIPO3D_GENERATE_PARTS', false)
  }

  const modelSeed = integerEnv('TRIPO3D_MODEL_SEED', 0, Number.MAX_SAFE_INTEGER)
  if (modelSeed !== undefined) payload.model_seed = modelSeed
  const textureSeed = integerEnv('TRIPO3D_TEXTURE_SEED', 0, Number.MAX_SAFE_INTEGER)
  if (textureSeed !== undefined) payload.texture_seed = textureSeed

  return payload
}

async function submitTask(apiKey: string, imageToken: string) {
  const res = await fetch(`${baseUrl()}/task`, {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildTaskInput(imageToken)),
  })
  const data = await readJson(res)
  if (!res.ok || (isRecord(data) && data.code !== 0)) {
    throw new Error(`Tripo submit failed (${res.status}): ${errorMessage(data, res.statusText)}`)
  }
  const payload = isRecord(data) && isRecord(data.data) ? data.data : data
  if (!isRecord(payload) || typeof payload.task_id !== 'string' || !payload.task_id) {
    throw new Error('Tripo submit response did not include task_id')
  }
  return payload.task_id
}

async function getTask(apiKey: string, taskId: string) {
  const res = await fetch(`${baseUrl()}/task/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(apiKey),
  })
  const data = await readJson(res)
  if (!res.ok || (isRecord(data) && data.code !== 0)) {
    throw new Error(`Tripo status failed (${res.status}): ${errorMessage(data, res.statusText)}`)
  }
  const payload = isRecord(data) && isRecord(data.data) ? data.data : data
  if (!isRecord(payload)) throw new Error('Tripo status response was invalid')
  return payload
}

async function waitForCompletion(
  apiKey: string,
  taskId: string,
  timeoutMs: number,
  pollIntervalMs: number,
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = ''
  while (Date.now() < deadline) {
    const task = await getTask(apiKey, taskId)
    lastStatus = typeof task.status === 'string' ? task.status : lastStatus
    if (lastStatus === 'success') return task
    if (FINAL_STATUSES.has(lastStatus)) {
      throw new Error(`Tripo task ${taskId} ended with status "${lastStatus}"`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error(
    `Tripo generation timed out after ${Math.round(timeoutMs / 1000)}s (${lastStatus})`,
  )
}

function firstUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value) return value
    if (isRecord(value) && typeof value.url === 'string' && value.url) return value.url
  }
}

export async function generateTripo3D(
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  if (!input.apiKey) {
    throw new Error('TRIPO3D_API_KEY is not configured on the server')
  }
  const imageToken = await uploadImage(input.apiKey, input.imageDataUri)
  const taskId = await submitTask(input.apiKey, imageToken)
  const task = await waitForCompletion(
    input.apiKey,
    taskId,
    input.timeoutMs ?? 10 * 60 * 1000,
    input.pollIntervalMs ?? 3000,
  )
  const output = isRecord(task.output) ? task.output : {}
  const modelUrl = firstUrl(output.pbr_model, output.model, output.base_model)
  if (!modelUrl) throw new Error('Tripo response did not include a model URL')

  return {
    provider: 'tripo',
    requestId: taskId,
    modelGlbUrl: modelUrl,
    thumbnailUrl: firstUrl(output.rendered_image, output.generated_image),
    metadata: {
      taskId,
      consumedCredit: task.consumed_credit,
      progress: task.progress,
      modelVersion: process.env.TRIPO3D_MODEL_VERSION || 'Turbo-v1.0-20250506',
    },
    raw: task,
  }
}
