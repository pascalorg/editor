/**
 * Hand a scene to a desktop app listening on loopback (the Pascal Blender add-on
 * today). The app answers `GET /pascal/health`, accepts a GLB on
 * `POST /pascal/import`, and reports the import on `GET /pascal/import/<id>`.
 * Protocol reference: https://github.com/pascalorg/blender-addon#send-to-blender-from-the-editor
 */

export const LOCAL_APP_PORT = 27412
export const LOCAL_APP_PORT_RANGE = 5
const PROBE_TIMEOUT_MS = 1000

export type LocalAppHealth = {
  app: string
  version: string
  addon: string
  port: number
  allowed: boolean
}

export type LocalAppProbe =
  | { status: 'listening'; base: string; health: LocalAppHealth }
  | { status: 'refused'; base: string; health: LocalAppHealth }
  | { status: 'unreachable' }

export type LocalImportStatus = {
  id: string
  state: 'queued' | 'done' | 'failed'
  summary?: string
  error?: string
}

export class LocalAppError extends Error {
  constructor(
    readonly reason: 'refused' | 'rejected' | 'failed' | 'timeout',
    message: string,
  ) {
    super(message)
    this.name = 'LocalAppError'
  }
}

type FetchLike = typeof fetch

function isHealth(value: unknown): value is LocalAppHealth {
  const health = value as Partial<LocalAppHealth> | null
  return Boolean(health && typeof health.app === 'string' && typeof health.allowed === 'boolean')
}

/** Try the app's port and a few after it, one second each. */
export async function probeLocalApp(
  fetchImpl: FetchLike = fetch,
  port = LOCAL_APP_PORT,
  range = LOCAL_APP_PORT_RANGE,
): Promise<LocalAppProbe> {
  for (let candidate = port; candidate < port + range; candidate++) {
    const base = `http://127.0.0.1:${candidate}`
    try {
      const response = await fetchImpl(`${base}/pascal/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const health: unknown = await response.json()
      if (!isHealth(health)) continue
      return { status: health.allowed ? 'listening' : 'refused', base, health }
    } catch {
      // Nothing listening there; try the next port.
    }
  }
  return { status: 'unreachable' }
}

export type SendSceneMeta = {
  name?: string
  projectId?: string
  version?: string
}

/** POST the GLB; resolves with the queued import id. */
export async function sendGlbToLocalApp(
  base: string,
  blob: Blob,
  meta: SendSceneMeta = {},
  fetchImpl: FetchLike = fetch,
): Promise<LocalImportStatus> {
  const headers: Record<string, string> = { 'Content-Type': 'model/gltf-binary' }
  // Header values are Latin-1; the listener percent-decodes these.
  if (meta.name) headers['X-Pascal-Project-Name'] = encodeURIComponent(meta.name)
  if (meta.projectId) headers['X-Pascal-Project-Id'] = meta.projectId
  if (meta.version) headers['X-Pascal-Version'] = meta.version
  const response = await fetchImpl(`${base}/pascal/import`, { method: 'POST', headers, body: blob })
  if (response.status === 403) {
    throw new LocalAppError('refused', 'The app has not allowed this site to send scenes.')
  }
  if (!response.ok) {
    throw new LocalAppError('rejected', `The app rejected the scene (HTTP ${response.status}).`)
  }
  return (await response.json()) as LocalImportStatus
}

/** Poll until the app has imported (or failed to import) the queued scene. */
export async function waitForLocalImport(
  base: string,
  id: string,
  fetchImpl: FetchLike = fetch,
  { timeoutMs = 120_000, intervalMs = 500 } = {},
): Promise<LocalImportStatus> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetchImpl(`${base}/pascal/import/${id}`, { cache: 'no-store' })
    if (response.ok) {
      const status = (await response.json()) as LocalImportStatus
      if (status.state === 'done') return status
      if (status.state === 'failed') {
        throw new LocalAppError('failed', status.error ?? 'The app could not import the scene.')
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new LocalAppError('timeout', 'The app did not finish importing in time.')
}
