import { createHash, createHmac } from 'node:crypto'
import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ProviderFile } from './types'

const DEFAULT_BASE_URL = 'https://hunyuan.intl.tencentcloudapi.com'
const DEFAULT_CLOUD_BASE_URL = 'https://api.ai3d.cloud.tencent.com'
const DEFAULT_CLOUD_SUBMIT_PATH = '/v1/ai3d/submit'
const DEFAULT_CLOUD_QUERY_PATH = '/v1/ai3d/query'
const DEFAULT_GLOBAL_SERVICE = 'hunyuan'
const DEFAULT_GLOBAL_VERSION = '2023-09-01'
const DEFAULT_CN_SERVICE = 'ai3d'
const DEFAULT_CN_VERSION = '2025-05-13'

type TencentHunyuanCredentials = {
  secretId: string
  secretKey: string
}

type HunyuanCloudCredentials = {
  apiKey: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function hmacHex(key: Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

function getTencentCredentials(): TencentHunyuanCredentials {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY
  if (!secretId || !secretKey) {
    throw new Error(
      'TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are not configured on the server',
    )
  }
  return { secretId, secretKey }
}

function normalizeUrl(raw: string) {
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
}

function tencentEndpoint() {
  return normalizeUrl(
    process.env.HUNYUAN3D_TENCENT_BASE_URL || process.env.HUNYUAN3D_BASE_URL || DEFAULT_BASE_URL,
  )
}

function cloudBaseUrl() {
  return normalizeUrl(process.env.HUNYUAN3D_BASE_URL || DEFAULT_CLOUD_BASE_URL)
}

function cloudSubmitUrl() {
  return new URL(
    process.env.HUNYUAN3D_SUBMIT_PATH || DEFAULT_CLOUD_SUBMIT_PATH,
    cloudBaseUrl(),
  ).toString()
}

function cloudQueryUrl() {
  return new URL(
    process.env.HUNYUAN3D_QUERY_PATH || DEFAULT_CLOUD_QUERY_PATH,
    cloudBaseUrl(),
  ).toString()
}

function normalizeApiKey(value: string | undefined) {
  return value?.trim().replace(/^bearer\s+/i, '') || undefined
}

function getCloudCredentials(): HunyuanCloudCredentials | null {
  const apiKey = normalizeApiKey(process.env.HUNYUAN3D_API_KEY)
  return apiKey ? { apiKey } : null
}

function shouldUseCloudApi() {
  return Boolean(getCloudCredentials())
}

function isChinaAi3DEndpoint(url: URL) {
  return url.hostname === 'ai3d.tencentcloudapi.com'
}

function region() {
  return process.env.HUNYUAN3D_REGION || 'ap-guangzhou'
}

function service(url: URL) {
  return (
    process.env.HUNYUAN3D_SERVICE ||
    (isChinaAi3DEndpoint(url) ? DEFAULT_CN_SERVICE : DEFAULT_GLOBAL_SERVICE)
  )
}

function version(url: URL) {
  return (
    process.env.HUNYUAN3D_VERSION ||
    (isChinaAi3DEndpoint(url) ? DEFAULT_CN_VERSION : DEFAULT_GLOBAL_VERSION)
  )
}

function model() {
  return process.env.HUNYUAN3D_MODEL || '3.1'
}

function faceCount() {
  const value = Number(process.env.HUNYUAN3D_FACE_COUNT ?? 50000)
  if (!Number.isFinite(value)) return 50000
  return Math.max(3000, Math.min(1500000, Math.trunc(value)))
}

function enablePbr() {
  return process.env.HUNYUAN3D_ENABLE_PBR === '1' || process.env.HUNYUAN3D_ENABLE_PBR === 'true'
}

function generateType() {
  const value = process.env.HUNYUAN3D_GENERATE_TYPE
  if (value === 'Geometry' || value === 'LowPoly' || value === 'Sketch') return value
  return 'Normal'
}

function authorization(
  credentials: TencentHunyuanCredentials,
  host: string,
  payload: string,
  timestamp: number,
  requestService: string,
) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host'
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`
  const credentialScope = `${date}/${requestService}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(
    canonicalRequest,
  )}`
  const secretDate = hmac(`TC3${credentials.secretKey}`, date)
  const secretService = hmac(secretDate, requestService)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmacHex(secretSigning, stringToSign)
  return `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

async function readJson(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { Response: { Error: { Message: text } } }
  }
}

async function callTencent(action: string, body: Record<string, unknown>) {
  const credentials = getTencentCredentials()
  const url = new URL(tencentEndpoint())
  const payload = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const requestService = service(url)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: authorization(credentials, url.host, payload, timestamp, requestService),
      'Content-Type': 'application/json; charset=utf-8',
      Host: url.host,
      'X-TC-Action': action,
      'X-TC-Region': region(),
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version(url),
    },
    body: payload,
  })
  const raw = await readJson(res)
  const response = isRecord(raw) && isRecord(raw.Response) ? raw.Response : raw
  if (!res.ok || (isRecord(response) && isRecord(response.Error))) {
    const error = isRecord(response) && isRecord(response.Error) ? response.Error : {}
    const message =
      (typeof error.Message === 'string' && error.Message) ||
      (typeof error.Code === 'string' && error.Code) ||
      res.statusText
    throw new Error(`Tencent Hunyuan3D ${action} failed (${res.status}): ${message}`)
  }
  return response
}

function imageBase64FromDataUri(dataUri: string) {
  const marker = ';base64,'
  const index = dataUri.indexOf(marker)
  return index >= 0 ? dataUri.slice(index + marker.length) : dataUri
}

function buildCloudSubmitBody(input: GenerateImageTo3DInput) {
  const type = generateType()
  const body: Record<string, unknown> = {
    Model: model(),
    ImageBase64: imageBase64FromDataUri(input.imageDataUri),
    EnablePBR: enablePbr(),
    FaceCount: faceCount(),
    GenerateType: type,
  }
  if (type === 'Sketch' && input.prompt?.trim()) {
    body.Prompt = input.prompt.trim()
  }
  return body
}

function buildTencentSubmitBody(input: GenerateImageTo3DInput) {
  const body: Record<string, unknown> = {
    Model: model(),
    ImageBase64: imageBase64FromDataUri(input.imageDataUri),
    EnablePBR: enablePbr(),
    FaceCount: faceCount(),
    GenerateType: generateType(),
  }
  if (generateType() === 'Sketch' && input.prompt?.trim()) {
    body.Prompt = input.prompt.trim()
  }
  return body
}

function responseData(raw: unknown) {
  return isRecord(raw) && isRecord(raw.Response) ? raw.Response : raw
}

async function callCloud(url: string, body: Record<string, unknown>) {
  const credentials = getCloudCredentials()
  if (!credentials) throw new Error('HUNYUAN3D_API_KEY is not configured on the server')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: credentials.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const raw = await readJson(res)
  const data = responseData(raw)
  if (!res.ok || (isRecord(data) && isRecord(data.Error))) {
    const error = isRecord(data) && isRecord(data.Error) ? data.Error : data
    const message =
      (isRecord(error) && typeof error.Message === 'string' && error.Message) ||
      (isRecord(error) && typeof error.message === 'string' && error.message) ||
      (isRecord(error) && typeof error.Code === 'string' && error.Code) ||
      res.statusText
    throw new Error(`Tencent Hunyuan3D cloud request failed (${res.status}): ${message}`)
  }
  return data
}

function extractJobId(response: unknown) {
  if (!isRecord(response)) return null
  if (typeof response.JobId === 'string' && response.JobId) return response.JobId
  if (typeof response.job_id === 'string' && response.job_id) return response.job_id
  if (typeof response.task_id === 'string' && response.task_id) return response.task_id
  return null
}

async function submit(input: GenerateImageTo3DInput) {
  const response = shouldUseCloudApi()
    ? await callCloud(cloudSubmitUrl(), buildCloudSubmitBody(input))
    : await callTencent('SubmitHunyuanTo3DProJob', buildTencentSubmitBody(input))
  const jobId = extractJobId(response)
  if (!jobId) {
    throw new Error('Tencent Hunyuan3D submit response did not include JobId')
  }
  return {
    jobId,
    requestId:
      isRecord(response) && typeof response.RequestId === 'string' ? response.RequestId : undefined,
    raw: response,
  }
}

function extractFile(value: unknown): ProviderFile | null {
  if (!isRecord(value) || typeof value.Url !== 'string' || !value.Url) return null
  return {
    url: value.Url,
    content_type: typeof value.Type === 'string' ? value.Type : undefined,
    file_name: typeof value.Type === 'string' ? `model.${value.Type.toLowerCase()}` : undefined,
  }
}

function firstModelFile(files: unknown): ProviderFile | null {
  if (!Array.isArray(files)) return null
  return (
    files
      .map(extractFile)
      .find(
        (file): file is ProviderFile =>
          file !== null &&
          file.url.length > 0 &&
          (file.url.toLowerCase().includes('.glb') || file.content_type?.toLowerCase() === 'glb'),
      ) ??
    files.map(extractFile).find((file): file is ProviderFile => Boolean(file?.url)) ??
    null
  )
}

function firstPreview(files: unknown) {
  if (!Array.isArray(files)) return undefined
  for (const item of files) {
    if (isRecord(item) && typeof item.PreviewImageUrl === 'string' && item.PreviewImageUrl) {
      return item.PreviewImageUrl
    }
  }
}

export function normalizeHunyuan3DResponse(
  raw: unknown,
): Omit<GenerateImageTo3DResult, 'provider' | 'requestId' | 'raw'> {
  const data = responseData(raw)
  if (!isRecord(data)) {
    throw new Error('Tencent Hunyuan3D returned an invalid response')
  }
  const modelFile = firstModelFile(data.ResultFile3Ds)
  if (!modelFile) {
    throw new Error('Tencent Hunyuan3D response did not include a model URL')
  }
  return {
    modelGlbUrl: modelFile.url,
    thumbnailUrl: firstPreview(data.ResultFile3Ds),
    metadata: {
      jobId: data.JobId,
      status: data.Status,
      resultFile3Ds: data.ResultFile3Ds,
    },
  }
}

async function waitForCompletion(jobId: string, timeoutMs: number, pollIntervalMs: number) {
  const deadline = Date.now() + timeoutMs
  let lastResponse: unknown
  while (Date.now() < deadline) {
    const response = shouldUseCloudApi()
      ? await callCloud(cloudQueryUrl(), { JobId: jobId })
      : await callTencent('QueryHunyuanTo3DProJob', { JobId: jobId })
    lastResponse = response
    if (isRecord(response)) {
      if (response.Status === 'DONE') return response
      if (response.Status === 'FAIL') {
        const message =
          (typeof response.ErrorMessage === 'string' && response.ErrorMessage) ||
          (typeof response.ErrorCode === 'string' && response.ErrorCode) ||
          'generation failed'
        throw new Error(`Tencent Hunyuan3D generation failed: ${message}`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  const lastStatus =
    isRecord(lastResponse) && typeof lastResponse.Status === 'string'
      ? lastResponse.Status
      : 'unknown'
  throw new Error(
    `Tencent Hunyuan3D generation timed out after ${Math.round(timeoutMs / 1000)}s (${lastStatus})`,
  )
}

export async function generateHunyuan3D(
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  const request = await submit(input)
  const raw = await waitForCompletion(
    request.jobId,
    input.timeoutMs ?? 10 * 60 * 1000,
    input.pollIntervalMs ?? 2500,
  )
  const normalized = normalizeHunyuan3DResponse(raw)
  return {
    provider: 'hunyuan3d',
    requestId: request.requestId ?? request.jobId,
    raw,
    ...normalized,
  }
}
