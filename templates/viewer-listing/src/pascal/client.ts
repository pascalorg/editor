import {
  type Bake,
  ErrorBodySchema,
  type Lod,
  type SceneResponse,
  SceneResponseSchema,
} from './contract'

export type PascalErrorCode =
  /** The project does not exist or is not public (Pascal does not tell them apart). */
  | 'not_found'
  /** The project exists but has never been published. */
  | 'not_published'
  /** A credential was sent and rejected. */
  | 'unauthorized'
  /** The request never got an answer (offline, DNS, CORS). */
  | 'network'
  /** The answer does not match the contract this client understands. */
  | 'invalid_response'
  /** The 3D file is not ready, or none of its levels could be fetched. */
  | 'no_3d_file'
  /** Any other non-OK answer. */
  | 'http'

export class PascalError extends Error {
  readonly code: PascalErrorCode
  readonly status: number | null

  constructor(code: PascalErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'PascalError'
    this.code = code
    this.status = status
  }
}

export type RequestOptions = {
  signal?: AbortSignal
  /** Inject a fetch, e.g. a server-side one that adds credentials. Defaults to the global fetch. */
  fetch?: typeof fetch
}

/**
 * Reads a project's published revision: its projected scene graph and its baked
 * 3D file. Anonymous: the browser sends no cookies or credentials, so only public
 * projects are readable here. Never add a Pascal API key to a browser request.
 */
export async function getScene(
  baseUrl: string,
  projectId: string,
  { signal, fetch: fetchImpl = fetch }: RequestOptions = {},
): Promise<SceneResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/scene`
  let response: Response
  try {
    response = await fetchImpl(url, {
      signal,
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new PascalError('network', `Could not reach ${baseUrl}`)
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const code = ErrorBodySchema.safeParse(body).data?.error
    if (response.status === 404 && code === 'not_published') {
      throw new PascalError('not_published', 'This project is not published', 404)
    }
    if (response.status === 404) throw new PascalError('not_found', 'Project not found', 404)
    if (response.status === 401) {
      throw new PascalError('unauthorized', 'The credential was rejected', 401)
    }
    throw new PascalError('http', `Pascal answered ${response.status}`, response.status)
  }

  const parsed = SceneResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new PascalError('invalid_response', `Unexpected response: ${parsed.error.message}`)
  }
  return parsed.data
}

/** The most detailed level available: lod0 when present. */
export function pickLod(bake: Bake): Lod | null {
  if (bake.status !== 'ready' || bake.lods.length === 0) return null
  return bake.lods.reduce((best, lod) => (lod.level < best.level ? lod : best))
}

/** Signed URLs live ~10 minutes; treat one as stale a minute early so a slow start still lands. */
export function isExpiring(lod: Lod, now = Date.now(), marginMs = 60_000): boolean {
  return Date.parse(lod.expiresAt) - now < marginMs
}

export type LoadedGlb = {
  bytes: ArrayBuffer
  lod: Lod
  /** The scene the URL came from: a fresher copy when the URL had to be renewed. */
  scene: SceneResponse
}

/**
 * Downloads the scene's best GLB. Renews the signed URL by reading the scene again
 * when it is about to expire, or once when storage rejects it (400/403 = expired
 * or invalid signature).
 */
export async function fetchGlb(
  baseUrl: string,
  projectId: string,
  scene: SceneResponse,
  {
    signal,
    fetch: fetchImpl = fetch,
    onProgress,
  }: RequestOptions & { onProgress?: (loaded: number, total: number | null) => void } = {},
): Promise<LoadedGlb> {
  let current = scene
  let lod = pickLod(current.bake)
  let renewed = false

  const renew = async () => {
    current = await getScene(baseUrl, projectId, { signal, fetch: fetchImpl })
    lod = pickLod(current.bake)
    renewed = true
  }

  if (lod && isExpiring(lod)) await renew()

  for (;;) {
    if (!lod) throw new PascalError('no_3d_file', 'No 3D file is available')
    let response: Response
    try {
      response = await fetchImpl(lod.url, { signal, credentials: 'omit' })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new PascalError('network', 'Could not download the 3D file')
    }
    if ((response.status === 400 || response.status === 403) && !renewed) {
      await renew()
      continue
    }
    if (!response.ok) {
      throw new PascalError('http', `3D file download answered ${response.status}`, response.status)
    }
    const bytes = await readWithProgress(response, lod.bytes, onProgress)
    return { bytes, lod, scene: current }
  }
}

async function readWithProgress(
  response: Response,
  expectedBytes: number | null,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const header = Number(response.headers.get('content-length'))
  const total = header > 0 ? header : expectedBytes
  if (!(response.body && onProgress)) return response.arrayBuffer()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, total)
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}
