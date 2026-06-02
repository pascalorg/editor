export type ImageTo3DProvider = 'fal' | 'hunyuan3d' | 'tripo'

export type ProviderFile = {
  url: string
  content_type?: string
  file_name?: string
  file_size?: number
}

export type GenerateImageTo3DInput = {
  imageDataUri: string
  prompt?: string
  apiKey?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

export type GenerateImageTo3DResult = {
  provider: ImageTo3DProvider
  requestId?: string
  modelGlbUrl: string
  thumbnailUrl?: string
  metadata: unknown
  raw: unknown
}
