import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ImageTo3DProvider } from './types'

export type FalQueuedGenerator = {
  provider: ImageTo3DProvider
  model: string
  input: (input: GenerateImageTo3DInput) => Record<string, unknown>
  normalize: (raw: unknown) => Omit<GenerateImageTo3DResult, 'provider' | 'requestId' | 'raw'>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readJson(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { detail: text }
  }
}

function falHeaders(apiKey: string) {
  return {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function submit(input: GenerateImageTo3DInput, generator: FalQueuedGenerator) {
  if (!input.apiKey) {
    throw new Error('FAL_KEY is not configured on the server')
  }
  const res = await fetch(`https://queue.fal.run/${generator.model}`, {
    method: 'POST',
    headers: falHeaders(input.apiKey),
    body: JSON.stringify(generator.input(input)),
  })
  const data = await readJson(res)
  if (!res.ok) {
    const detail = isRecord(data) && typeof data.detail === 'string' ? data.detail : res.statusText
    throw new Error(`fal submit failed (${res.status}): ${detail}`)
  }
  if (
    !isRecord(data) ||
    typeof data.status_url !== 'string' ||
    typeof data.response_url !== 'string'
  ) {
    throw new Error('fal submit response did not include queue URLs')
  }
  return data as { request_id?: string; status_url: string; response_url: string }
}

async function waitForCompletion(
  apiKey: string,
  statusUrl: string,
  timeoutMs: number,
  pollIntervalMs: number,
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = ''
  while (Date.now() < deadline) {
    const url = statusUrl.includes('?') ? `${statusUrl}&logs=1` : `${statusUrl}?logs=1`
    const res = await fetch(url, { headers: { Authorization: `Key ${apiKey}` } })
    const data = await readJson(res)
    if (!res.ok) {
      const detail =
        isRecord(data) && typeof data.detail === 'string' ? data.detail : res.statusText
      throw new Error(`fal status failed (${res.status}): ${detail}`)
    }
    if (isRecord(data)) {
      lastStatus = typeof data.status === 'string' ? data.status : lastStatus
      if (data.status === 'COMPLETED') {
        if (typeof data.error === 'string' && data.error) throw new Error(data.error)
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error(`fal generation timed out after ${Math.round(timeoutMs / 1000)}s (${lastStatus})`)
}

async function getResult(apiKey: string, responseUrl: string) {
  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${apiKey}` } })
  const data = await readJson(res)
  if (!res.ok) {
    const detail = isRecord(data) && typeof data.detail === 'string' ? data.detail : res.statusText
    throw new Error(`fal result failed (${res.status}): ${detail}`)
  }
  return data
}

export async function generateFalQueuedImageTo3D(
  input: GenerateImageTo3DInput,
  generator: FalQueuedGenerator,
): Promise<GenerateImageTo3DResult> {
  if (!input.apiKey) {
    throw new Error('FAL_KEY is not configured on the server')
  }
  const request = await submit(input, generator)
  await waitForCompletion(
    input.apiKey,
    request.status_url,
    input.timeoutMs ?? 10 * 60 * 1000,
    input.pollIntervalMs ?? 2500,
  )
  const raw = await getResult(input.apiKey, request.response_url)
  const normalized = generator.normalize(raw)
  return {
    provider: generator.provider,
    requestId: request.request_id,
    raw,
    ...normalized,
  }
}
