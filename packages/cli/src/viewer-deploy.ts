import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CliError } from './errors.js'

export const VIEWER_DEPLOY_MAX_FILES = 2000
export const VIEWER_DEPLOY_MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const VIEWER_DEPLOY_MAX_FILE_BYTES = 25 * 1024 * 1024
export const VIEWER_DEPLOY_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  wasm: 'application/wasm',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  txt: 'text/plain',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  ktx2: 'image/ktx2',
  hdr: 'image/vnd.radiance',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export function isValidViewerDeployPath(path: string): boolean {
  if (!path || path.length > 512 || /[^\x21-\x7e]|[\\%?#:]/.test(path)) return false
  const parts = path.split('/')
  return parts.every(
    (part, i) =>
      !!part &&
      part !== '..' &&
      part !== '.' &&
      (!part.startsWith('.') || (i === 0 && part === '.well-known' && parts.length > 1)),
  )
}

export interface ViewerBuildFile {
  path: string
  absolutePath: string
  size: number
  sha256: string
  contentType: string
}

export interface ViewerBuild {
  files: ViewerBuildFile[]
  totalBytes: number
  skipped: string[]
}

export interface ViewerBuildLimits {
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
}

export function requireViewerId(viewerId: string): string {
  if (!/^viewer_[A-Za-z0-9_-]{1,128}$/.test(viewerId)) {
    throw new CliError(
      'invalid_option',
      'Use "pascal viewer deploy <dir> --viewer <id>" with the ID under Settings → Viewers.',
      undefined,
      2,
    )
  }
  return viewerId
}

export async function scanViewerBuild(
  directory: string,
  limits: ViewerBuildLimits = {},
): Promise<ViewerBuild> {
  const root = resolve(directory)
  const files: ViewerBuildFile[] = []
  const skipped: string[] = []
  const offenders: string[] = []
  const maxFileBytes = limits.maxFileBytes ?? VIEWER_DEPLOY_MAX_FILE_BYTES
  const maxFiles = limits.maxFiles ?? VIEWER_DEPLOY_MAX_FILES
  const maxTotalBytes = limits.maxTotalBytes ?? VIEWER_DEPLOY_MAX_TOTAL_BYTES
  let totalBytes = 0
  let readingPath = ''
  try {
    const stat = await lstat(root)
    if (stat.isSymbolicLink()) throw buildError('Symlink refused: build directory.')
    if (!stat.isDirectory()) throw buildError('The build directory must be a directory.')
    async function walk(relative = ''): Promise<void> {
      readingPath = relative
      const entries = await readdir(resolve(root, relative), { withFileTypes: true })
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        const path = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.name.startsWith('.') && !(path === '.well-known' && entry.isDirectory())) {
          skipped.push(safeLine(`${path}${entry.isDirectory() ? '/' : ''}`))
          continue
        }
        readingPath = path
        if (entry.isSymbolicLink()) throw buildError(`Symlink refused: ${safeLine(path)}.`)
        if (entry.isDirectory()) {
          await walk(path)
          continue
        }
        if (!entry.isFile()) throw buildError(`Non-regular file refused: ${safeLine(path)}.`)
        const extension = path.split('.').at(-1) ?? ''
        const contentType = Object.hasOwn(VIEWER_DEPLOY_CONTENT_TYPES, extension)
          ? VIEWER_DEPLOY_CONTENT_TYPES[extension]
          : undefined
        if (!isValidViewerDeployPath(path) || !contentType) {
          offenders.push(safeLine(path))
          continue
        }
        const absolutePath = resolve(root, path)
        const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const stat = await handle.stat()
          if (!stat.isFile()) throw buildError(`Non-regular file refused: ${path}.`)
          if (stat.size > maxFileBytes)
            throw buildError(`${path} exceeds the per-file limit (${maxFileBytes} bytes).`)
          totalBytes += stat.size
          if (files.length >= maxFiles)
            throw buildError(`Build exceeds the ${maxFiles}-file limit.`)
          if (totalBytes > maxTotalBytes)
            throw buildError(`Build exceeds the total-size limit (${maxTotalBytes} bytes).`)
          const hash = createHash('sha256')
          let bytes = 0
          for await (const chunk of handle.createReadStream({ autoClose: false })) {
            bytes += chunk.length
            if (bytes > stat.size) throw changedFile(path)
            hash.update(chunk)
          }
          if (bytes !== stat.size) throw changedFile(path)
          files.push({
            path,
            absolutePath,
            size: stat.size,
            sha256: hash.digest('hex'),
            contentType,
          })
        } finally {
          await handle.close()
        }
      }
    }
    await walk()
  } catch (error) {
    if (error instanceof CliError) throw error
    if (readingPath) throw readFailure(readingPath, error)
    throw buildError('Cannot read the build directory. Check that it exists and is readable.')
  }
  if (offenders.length) {
    throw buildError(
      `Invalid build paths or unsupported extensions: ${offenders.slice(0, 10).join(', ')}${offenders.length > 10 ? `, and ${offenders.length - 10} more` : ''}. See https://editor.pascal.app/docs/developers/api.`,
    )
  }
  if (!files.some((file) => file.path === 'index.html')) {
    throw buildError(
      `No index.html at the top of ${safeLine(directory)}. Pass the build output directory.`,
    )
  }
  return { files, totalBytes, skipped }
}

export interface ViewerDeployProgress {
  phase: 'checking' | 'uploading' | 'activating'
  uploaded: number
  total: number
}

export interface ViewerDeployOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  /** Override the size-based per-file deadline; the upload window still caps it. */
  uploadTimeoutMs?: number
  /** Shorten the server's upload window for programmatic tests. */
  uploadWindowMs?: number
  finalizeTimeoutMs?: number
  onProgress?: (progress: ViewerDeployProgress) => void
  /** Programmatic override; HTTP is accepted only on loopback hosts. */
  apiOrigin?: string
}

export interface ViewerDeployResult {
  schemaVersion: 1
  viewerId: string
  deploymentId: string
  status: 'active'
  fileCount: number
  totalBytes: number
  skipped: string[]
  url: string | null
}

type Upload = { path: string; url: string; headers: Record<string, string> }
const DEPLOYMENT_ID = /^viewerdeploy_[A-Za-z0-9_-]{1,128}$/

export async function deployViewer(
  apiKey: string | undefined,
  request: { viewerId: string; directory: string },
  options: ViewerDeployOptions = {},
): Promise<ViewerDeployResult> {
  const viewerId = requireViewerId(request.viewerId)
  const credential = apiKey?.trim()
  if (!credential) {
    throw new CliError(
      'agent_api_key_missing',
      "Set PASCAL_API_KEY to an API key that can manage the viewer's workspace and try again.",
    )
  }
  const origin = safeUrl(options.apiOrigin ?? 'https://editor.pascal.app')
  if (origin?.pathname !== '/' || origin.search || origin.hash) {
    throw new CliError(
      'invalid_option',
      'The API origin must use HTTPS (or HTTP on loopback).',
      undefined,
      2,
    )
  }
  options.onProgress?.({ phase: 'checking', uploaded: 0, total: 0 })
  const build = await scanViewerBuild(request.directory)
  const total = build.files.length
  const progress = (phase: ViewerDeployProgress['phase'], uploaded = 0) =>
    options.onProgress?.({ phase, uploaded, total })
  progress('checking')
  const endpoint = `${origin.origin}/api/viewers/${viewerId}/deployments`
  const apiHeaders = { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }
  const created = await send(
    endpoint,
    {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({ files: build.files.map(manifestFile) }),
    },
    options,
    credential,
  )
  if (
    created.status !== 201 ||
    !isRecord(created.body) ||
    typeof created.body.deploymentId !== 'string' ||
    !DEPLOYMENT_ID.test(created.body.deploymentId) ||
    !Number.isSafeInteger(created.body.expiresIn) ||
    Number(created.body.expiresIn) <= 0 ||
    !Array.isArray(created.body.uploads) ||
    created.body.uploads.length !== total
  )
    throw unexpectedResponse()
  const deploymentId = created.body.deploymentId
  const expiresAt =
    created.receivedAt +
    Math.min(Number(created.body.expiresIn) * 1000 - 5000, options.uploadWindowMs ?? Infinity)
  const paths = new Set(build.files.map((file) => file.path))
  const uploads: Upload[] = []
  for (const value of created.body.uploads) {
    if (
      !isRecord(value) ||
      typeof value.path !== 'string' ||
      !paths.delete(value.path) ||
      typeof value.url !== 'string' ||
      !safeUrl(value.url, origin.protocol !== 'http:') ||
      !validHeaders(value.headers)
    )
      throw unexpectedResponse()
    uploads.push({ path: value.path, url: value.url, headers: value.headers })
  }
  const byPath = new Map(build.files.map((file) => [file.path, file]))
  let next = 0
  let uploaded = 0
  let failure: unknown
  progress('uploading')
  await Promise.all(
    Array.from({ length: Math.min(8, total) }, async () => {
      while (!failure && next < uploads.length) {
        const upload = uploads[next++]!
        try {
          await uploadFile(byPath.get(upload.path)!, upload, options, credential, expiresAt)
          progress('uploading', ++uploaded)
        } catch (error) {
          failure ??= error
        }
      }
    }),
  )
  if (failure) throw failure
  progress('activating', uploaded)
  let finalized: Awaited<ReturnType<typeof send>> | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      finalized = await send(
        `${endpoint}/${deploymentId}/finalize`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${credential}` },
        },
        { ...options, timeoutMs: options.finalizeTimeoutMs ?? 120_000 },
        credential,
      )
      break
    } catch (error) {
      if (attempt || !retryable(error, [502, 503, 504])) throw error
      await backoff(attempt)
    }
  }
  const active = finalized?.body
  if (!isRecord(active) || active.deploymentId !== deploymentId || active.status !== 'active')
    throw unexpectedResponse()
  const liveUrl = typeof active.url === 'string' ? safeUrl(active.url, true) : undefined
  return {
    schemaVersion: 1,
    viewerId,
    deploymentId,
    status: 'active',
    fileCount: total,
    totalBytes: build.totalBytes,
    skipped: build.skipped,
    url: liveUrl?.href ?? null,
  }
}

export function manifestFile({ path, size, sha256, contentType }: ViewerBuildFile) {
  return { path, size, sha256, contentType }
}

async function uploadFile(
  file: ViewerBuildFile,
  upload: Upload,
  options: ViewerDeployOptions,
  credential: string,
  expiresAt: number,
) {
  const deadline = Math.min(
    performance.now() + (options.uploadTimeoutMs ?? 60_000 + (file.size / (32 * 1024)) * 1000),
    expiresAt,
  )
  if (performance.now() >= deadline) throw uploadTimeout(file.path)
  let bytes: Buffer
  try {
    const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw readFailure(file.path, { code: 'EISDIR' })
      if (stat.size !== file.size) throw changedFile(file.path)
      // Read at most the manifest size plus one, even if a build process grows the file.
      bytes = Buffer.alloc(file.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length !== file.size) throw changedFile(file.path)
      bytes = bytes.subarray(0, length)
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
        throw changedFile(file.path)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(fileErrorCode(error))) throw changedFile(file.path)
    throw readFailure(file.path, error)
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw uploadTimeout(file.path)
    try {
      const response = await send(
        upload.url,
        {
          method: 'PUT',
          headers: upload.headers,
          body: bytes,
          credentials: 'omit',
        },
        { ...options, timeoutMs: remaining },
        credential,
        true,
      )
      if (response.status === 412 && attempt > 0) return
      if (response.status === 412 || response.status === 403) {
        throw new CliError(
          'viewer_upload_expired',
          `Upload refused for ${file.path}. Rerun the command to create a fresh deployment.`,
          { status: response.status },
        )
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CliError(
          'viewer_upload_failed',
          `Upload failed for ${file.path} (HTTP ${response.status}). Rerun the command.`,
          { status: response.status },
        )
      }
      return
    } catch (error) {
      if (error instanceof CliError && error.code === 'viewer_timeout')
        throw uploadTimeout(file.path)
      if (attempt === 2 || !retryable(error, [408, 429], true)) throw error
      await backoff(attempt)
    }
  }
}

async function send(
  url: string,
  init: RequestInit,
  options: ViewerDeployOptions,
  credential: string,
  upload = false,
): Promise<{ status: number; body: unknown; receivedAt: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  try {
    const response = await (options.fetch ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    const receivedAt = performance.now()
    let text: string
    try {
      text = await readBounded(
        response,
        upload || !response.ok ? 32 * 1024 : 8 * 1024 * 1024,
        controller.signal,
      )
    } catch (error) {
      if (
        !(error instanceof CliError) ||
        error.code !== 'viewer_invalid_response' ||
        (!upload && response.ok)
      )
        throw error
      // An untrusted error body must not hide an actionable HTTP status.
      text = ''
    }
    if (upload) return { status: response.status, body: null, receivedAt }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      if (response.ok) throw unexpectedResponse()
    }
    if (!response.ok) throw httpError(response, body, credential)
    return { status: response.status, body, receivedAt }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      controller.signal.aborted ? 'viewer_timeout' : 'viewer_unreachable',
      controller.signal.aborted
        ? 'The deploy request timed out. Rerun the command.'
        : 'The deploy service could not be reached. Check the network connection and rerun the command.',
      undefined,
      75,
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw unexpectedResponse()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const abort = () => void reader.cancel().catch(() => {})
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw signal.reason
      if (done) break
      size += value.length
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw unexpectedResponse()
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

function httpError(response: Response, body: unknown, credential: string): CliError {
  const status = response.status
  const reason =
    isRecord(body) && typeof body.error === 'string'
      ? safeLine(body.error)
          .replaceAll(credential, '[redacted]')
          .replace(/https?:\/\/\S+/gi, '[redacted URL]')
          .replace(/(?:X-Amz-[A-Za-z-]+|signature)=[^\s]*/gi, '[redacted query]')
          .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, '[redacted]')
          .slice(0, 500)
      : ''
  const details = { status }
  switch (status) {
    case 400:
      return new CliError(
        'viewer_invalid_manifest',
        `Pascal rejected the manifest${reason ? `: ${reason}` : '.'}`,
        details,
      )
    case 401:
      return new CliError(
        'viewer_unauthorized',
        'PASCAL_API_KEY is invalid, revoked, or an agent key that has not been claimed yet. Check it with "pascal agent status" or claim it with "pascal agent claim".',
        details,
      )
    case 403:
      return new CliError(
        'viewer_forbidden',
        "PASCAL_API_KEY cannot manage this viewer's workspace.",
        details,
      )
    case 404:
      if (reason === 'deployment_not_found')
        return new CliError(
          'viewer_deployment_not_found',
          'The deployment was not found; it may have been cleaned up. Rerun the command to create a fresh deployment.',
          details,
        )
      return new CliError(
        'viewer_not_found',
        "No hosted viewer with that ID for this key. Check the ID under Settings → Viewers, and that the key belongs to the viewer's workspace.",
        details,
      )
    case 409: {
      const messages: Record<string, string> = {
        viewer_unavailable:
          'The viewer is not hosted on Pascal, or is disabled or suspended. Check it under Settings → Viewers (Host on Pascal).',
        deployment_not_ready:
          'The deployment is not ready for activation. Rerun the command to create a fresh deployment.',
        uploads_incomplete:
          'Some build files have not finished uploading. Rerun the command to create a fresh deployment.',
        upload_mismatch:
          'The uploaded files do not match the build manifest. Rerun the command to create a fresh deployment.',
      }
      return new CliError(
        'viewer_conflict',
        Object.hasOwn(messages, reason)
          ? messages[reason]!
          : `Pascal rejected the viewer deployment${reason ? `: ${reason}` : '. Check that the viewer is enabled and available.'}`,
        details,
      )
    }
    case 413:
      return new CliError(
        'viewer_body_too_large',
        'The deployment manifest exceeds the API body limit.',
        details,
      )
    case 429: {
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter && /^\d{1,10}$/.test(retryAfter) ? Number(retryAfter) : undefined
      return new CliError(
        'viewer_rate_limited',
        `Too many viewer deployments. ${seconds !== undefined ? `Retry after ${seconds} seconds.` : 'Wait and try again.'}`,
        details,
        75,
      )
    }
    case 502:
    case 503:
    case 504:
      return new CliError(
        'viewer_unavailable',
        'Viewer hosting is temporarily unavailable. Try again shortly.',
        details,
        75,
      )
    default:
      return new CliError(
        'viewer_failed',
        `Pascal could not deploy the viewer (HTTP ${status}).`,
        details,
      )
  }
}

function retryable(error: unknown, statuses: number[], serverErrors = false): boolean {
  if (!(error instanceof CliError)) return false
  const status = (error.details as { status?: number } | undefined)?.status
  return (
    ['viewer_unreachable', 'viewer_timeout'].includes(error.code) ||
    (status !== undefined &&
      (statuses.includes(status) || (serverErrors && status >= 500 && status <= 599)))
  )
}

function backoff(attempt: number) {
  return new Promise((done) => setTimeout(done, 100 * 2 ** attempt))
}

function safeUrl(value: string, httpsOnly = false): URL | undefined {
  try {
    if (value.length > 16_384 || /\s/.test(value)) return undefined
    const url = new URL(value)
    if (url.username || url.password || url.hash) return undefined
    if (
      url.protocol === 'https:' ||
      (!httpsOnly &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      return url
  } catch {}
  return undefined
}

function validHeaders(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 16) return false
  return Object.entries(value).every(
    ([name, header]) =>
      /^[A-Za-z0-9-]{1,100}$/.test(name) &&
      !['authorization', 'cookie', 'cookie2', 'proxy-authorization'].includes(name.toLowerCase()) &&
      typeof header === 'string' &&
      header.length <= 8192 &&
      !/[\r\n]/.test(header),
  )
}

function safeLine(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output must not contain controls
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  return clean.replace(/\s+/g, ' ').trim()
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function unexpectedResponse() {
  return new CliError(
    'viewer_invalid_response',
    'Pascal returned an unexpected response to the viewer deploy request. Rerun the command.',
  )
}
function buildError(message: string) {
  return new CliError('viewer_invalid_build', message)
}
function changedFile(path: string) {
  return new CliError(
    'viewer_build_changed',
    `${path} changed during the deploy; rebuild and rerun.`,
  )
}

function fileErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

function readFailure(path: string, error: unknown): CliError {
  const causes: Record<string, string> = {
    ENOENT: 'missing',
    EACCES: 'permission denied',
    EPERM: 'permission denied',
    EMFILE: 'too many open files',
    ENFILE: 'too many open files in the system',
    EIO: 'input/output error',
    ENOTDIR: 'not a directory',
    EISDIR: 'not a regular file',
    ELOOP: 'symlink refused',
  }
  const code = fileErrorCode(error)
  const cause = Object.hasOwn(causes, code) ? causes[code] : 'filesystem error'
  return new CliError('viewer_read_failed', `Cannot read ${safeLine(path)} (${cause}).`)
}

function uploadTimeout(path: string): CliError {
  return new CliError(
    'viewer_upload_timeout',
    `Upload timed out for ${path}. The connection may be too slow or the upload window (15 minutes) ran out. Rerun the command to start a fresh deployment.`,
  )
}
