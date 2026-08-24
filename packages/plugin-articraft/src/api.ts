import type {
  ArticraftCatalogItem,
  ArticraftCatalogResponse,
  ArticraftCategory,
  ArticraftGeneration,
  ArticraftGenerationConfiguration,
  ArticraftGenerationProvider,
  ArticraftProjectImage,
  ArticraftReferenceProvider,
  ArticraftReferenceRender,
} from './types'

export const ARTICRAFT_API_BASE = '/api/plugins/articraft'

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isCatalogItem(value: unknown): value is ArticraftCatalogItem {
  const item = object(value)
  const artifact = object(item?.artifact)
  const attribution = object(item?.attribution)
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      (item.source === 'articraft-10k' || item.source === 'generated') &&
      artifact &&
      (artifact.format === 'urdf' || artifact.format === 'usdz') &&
      typeof artifact.url === 'string' &&
      Array.isArray(item.dimensions) &&
      item.dimensions.length === 3 &&
      Array.isArray(item.parts) &&
      Array.isArray(item.joints) &&
      object(item.defaultJointValues) &&
      attribution &&
      typeof attribution.creator === 'string' &&
      typeof attribution.license === 'string' &&
      typeof attribution.sourceUrl === 'string',
  )
}

export function parseCatalogResponse(value: unknown): ArticraftCatalogResponse {
  const response = object(value)
  if (
    !(
      response &&
      Array.isArray(response.categories) &&
      Array.isArray(response.items) &&
      response.items.every(isCatalogItem)
    ) ||
    typeof response.page !== 'number' ||
    typeof response.pageSize !== 'number' ||
    typeof response.total !== 'number'
  ) {
    throw new Error('The Articraft catalog returned an invalid response.')
  }
  return response as ArticraftCatalogResponse
}

export async function fetchCatalog(input: {
  category?: ArticraftCategory
  query?: string
  page?: number
  pageSize?: number
  signal?: AbortSignal
}): Promise<ArticraftCatalogResponse> {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 24),
  })
  if (input.category) params.set('category', input.category)
  if (input.query?.trim()) params.set('q', input.query.trim())
  const response = await fetch(`${ARTICRAFT_API_BASE}/catalog?${params}`, {
    signal: input.signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = object(payload)?.detail
    throw new Error(
      typeof detail === 'string' ? detail : `Catalog request failed (${response.status}).`,
    )
  }
  return parseCatalogResponse(payload)
}

export async function fetchProjectImages(
  projectId: string,
  signal?: AbortSignal,
): Promise<ArticraftProjectImage[]> {
  const response = await fetch(
    `${ARTICRAFT_API_BASE}/files?projectId=${encodeURIComponent(projectId)}`,
    { cache: 'no-store', signal },
  )
  const payload = await response.json().catch(() => null)
  const record = object(payload)
  if (!response.ok) throw new Error(responseError(record, response.status, 'Files request failed'))
  if (!Array.isArray(record?.items)) throw new Error('Pascal Files returned an invalid response.')
  return record.items.flatMap((value) => {
    const item = object(value)
    return item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.url === 'string'
      ? [{ id: item.id, name: item.name, url: item.url }]
      : []
  })
}

export async function createReferenceRender(input: {
  image?: File
  projectId: string
  prompt: string
  provider: ArticraftReferenceProvider
  signal?: AbortSignal
}): Promise<ArticraftReferenceRender> {
  const body = new FormData()
  body.set('projectId', input.projectId)
  body.set('prompt', input.prompt)
  body.set('provider', input.provider)
  if (input.image) body.set('image', input.image)
  const response = await fetch(`${ARTICRAFT_API_BASE}/references`, {
    method: 'POST',
    body,
    signal: input.signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(responseError(object(payload), response.status, 'Reference generation failed'))
  }
  return parseReferenceRender(payload)
}

export async function fetchGenerationConfiguration(
  signal?: AbortSignal,
): Promise<ArticraftGenerationConfiguration> {
  const response = await fetch(`${ARTICRAFT_API_BASE}/configuration`, {
    cache: 'no-store',
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(responseError(object(payload), response.status, 'Engine status failed'))
  }
  return parseGenerationConfiguration(payload)
}

export async function createGeneration(form: FormData): Promise<ArticraftGeneration> {
  const response = await fetch(`${ARTICRAFT_API_BASE}/generations`, {
    method: 'POST',
    body: form,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = object(payload)?.detail
    throw new Error(
      typeof detail === 'string' ? detail : `Generation request failed (${response.status}).`,
    )
  }
  return parseGeneration(payload)
}

export async function fetchGeneration(id: string): Promise<ArticraftGeneration> {
  const response = await fetch(`${ARTICRAFT_API_BASE}/generations/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = object(payload)?.detail
    throw new Error(
      typeof detail === 'string' ? detail : `Generation status failed (${response.status}).`,
    )
  }
  return parseGeneration(payload)
}

export async function cancelGeneration(id: string): Promise<ArticraftGeneration> {
  const response = await fetch(
    `${ARTICRAFT_API_BASE}/generations/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = object(payload)?.detail
    throw new Error(
      typeof detail === 'string' ? detail : `Generation cancel failed (${response.status}).`,
    )
  }
  return parseGeneration(payload)
}

function parseGeneration(value: unknown): ArticraftGeneration {
  const generation = object(value)
  if (
    !generation ||
    typeof generation.id !== 'string' ||
    !['queued', 'running', 'succeeded', 'failed', 'canceled'].includes(String(generation.status)) ||
    (generation.item !== undefined && !isCatalogItem(generation.item))
  ) {
    throw new Error('The Articraft worker returned an invalid response.')
  }
  return generation as ArticraftGeneration
}

export function parseReferenceRender(value: unknown): ArticraftReferenceRender {
  const render = object(value)
  if (
    !render ||
    typeof render.id !== 'string' ||
    render.status !== 'completed' ||
    typeof render.image_url !== 'string' ||
    typeof render.provider !== 'string' ||
    !['azure-openai', 'google'].includes(render.provider) ||
    typeof render.model !== 'string'
  ) {
    throw new Error('The reference provider returned an invalid response.')
  }
  const projectImage = object(render.project_image)
  if (
    !projectImage ||
    typeof projectImage.id !== 'string' ||
    typeof projectImage.name !== 'string' ||
    typeof projectImage.url !== 'string'
  ) {
    throw new Error('The reference provider did not save a valid project file.')
  }
  return {
    id: render.id,
    status: 'completed',
    imageUrl: render.image_url,
    provider: render.provider as ArticraftReferenceProvider,
    model: render.model,
    projectImage: projectImage as ArticraftProjectImage,
  }
}

export function parseGenerationConfiguration(value: unknown): ArticraftGenerationConfiguration {
  const configuration = object(object(value)?.generation)
  const models = Array.isArray(configuration?.models)
    ? configuration.models.flatMap((value) => {
        const model = object(value)
        return model &&
          typeof model.label === 'string' &&
          typeof model.model === 'string' &&
          ['openai', 'anthropic', 'gemini', 'openrouter'].includes(String(model.provider))
          ? [
              {
                label: model.label,
                model: model.model,
                provider: model.provider as ArticraftGenerationProvider,
              },
            ]
          : []
      })
    : []
  if (
    !configuration ||
    typeof configuration.ready !== 'boolean' ||
    !['openai', 'anthropic', 'gemini', 'openrouter'].includes(String(configuration.provider)) ||
    typeof configuration.model !== 'string' ||
    models.length === 0
  ) {
    throw new Error('The Articraft host returned an invalid engine configuration.')
  }
  return {
    model: configuration.model,
    models,
    provider: configuration.provider as ArticraftGenerationProvider,
    ready: configuration.ready,
  }
}

function responseError(
  value: Record<string, unknown> | null,
  status: number,
  fallback: string,
): string {
  const detail = value?.detail ?? value?.error
  return typeof detail === 'string' ? detail : `${fallback} (${status}).`
}
