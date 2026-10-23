import { requireAgentApiKey } from './agent-account.js'
import { CliError } from './errors.js'

export const ARCHITECT_RESPONSES_ENDPOINT = 'https://editor.pascal.app/api/v1/responses'
export const ARCHITECT_EFFORTS = ['low', 'medium', 'high', 'pro'] as const
export type ArchitectEffort = (typeof ARCHITECT_EFFORTS)[number]

const RUN_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
] as const
export type ArchitectRunStatus = (typeof RUN_STATUSES)[number]

/** Exit code for failures worth retrying unchanged later (sysexits EX_TEMPFAIL). */
export const ARCHITECT_RETRY_EXIT_CODE = 75

const RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_BRIEF_LENGTH = 100_000
const MAX_METADATA_VALUE_LENGTH = 512
const MAX_SERVER_MESSAGE_LENGTH = 500
const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_ERROR_BYTES = 32 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

export interface ArchitectRunRequest {
  brief: string
  effort?: ArchitectEffort
  projectId?: string
  maxCredits?: number
}

export interface ArchitectRun {
  schemaVersion: 1
  id: string
  status: ArchitectRunStatus
  model: string | null
  projectId: string | null
  maxCredits: number | null
  createdAt: string | null
  outputText: string | null
  error: { code: string | null; message: string | null } | null
}

export interface ArchitectRequestOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  /** Aborting detaches from the request; a background run keeps going on Pascal. */
  signal?: AbortSignal
}

export interface ArchitectStreamOptions extends ArchitectRequestOptions {
  onStarted?: (run: ArchitectRun) => void
  onText?: (delta: string) => void
}

type ArchitectAction = 'run' | 'status' | 'cancel'

export function architectModel(effort?: ArchitectEffort): string {
  return effort ? `architect-${effort}` : 'architect'
}

export function isArchitectEffort(value: string): value is ArchitectEffort {
  return (ARCHITECT_EFFORTS as readonly string[]).includes(value)
}

export function isTerminalArchitectStatus(status: ArchitectRunStatus): boolean {
  return status !== 'queued' && status !== 'in_progress'
}

/** Queues a background run and returns as soon as Pascal accepts it. */
export async function startArchitectRun(
  apiKey: string | undefined,
  request: ArchitectRunRequest,
  options: ArchitectRequestOptions = {},
): Promise<ArchitectRun> {
  const body = runRequestBody(request, false)
  const credential = requireAgentApiKey(apiKey)
  return requestRun(credential, 'run', ARCHITECT_RESPONSES_ENDPOINT, 'POST', body, options)
}

/** Queues a background run and streams it until it reaches a terminal status. */
export async function streamArchitectRun(
  apiKey: string | undefined,
  request: ArchitectRunRequest,
  options: ArchitectStreamOptions = {},
): Promise<ArchitectRun> {
  const body = runRequestBody(request, true)
  const credential = requireAgentApiKey(apiKey)
  const { controller, headersReceived, clear } = requestController(options)
  let runId: string | undefined
  try {
    const response = await send(credential, 'run', ARCHITECT_RESPONSES_ENDPOINT, 'POST', body, {
      ...options,
      controller,
      stream: true,
    })
    headersReceived()
    if (!response.body) throw invalidResponse()

    let text = ''
    for await (const event of readServerSentEvents(response.body, controller.signal)) {
      const type = typeof event.type === 'string' ? event.type : ''
      if (type === 'error') throw streamError(event, runId)
      if (type === 'response.output_text.delta') {
        if (typeof event.delta !== 'string') continue
        const delta = sanitizeText(event.delta)
        text += delta
        options.onText?.(delta)
        continue
      }
      if (!type.startsWith('response.') || !isRecord(event.response)) continue
      const run = toArchitectRun(event.response)
      if (!run) throw invalidResponse()
      if (!runId) {
        runId = run.id
        options.onStarted?.(run)
      }
      if (isTerminalArchitectStatus(run.status)) {
        return { ...run, outputText: run.outputText ?? (text || null) }
      }
    }
    throw new CliError(
      'architect_stream_interrupted',
      runId
        ? `The stream ended before run ${runId} finished. It keeps running on Pascal; check it with "pascal architect status ${runId}".`
        : 'The stream ended before Pascal confirmed the run. Try again.',
      runId ? { id: runId } : undefined,
    )
  } catch (error) {
    if (options.signal?.aborted) throw detachedError(runId)
    if (error instanceof CliError) throw error
    if (controller.signal.aborted) throw timeoutError('run')
    throw new CliError(
      'architect_stream_interrupted',
      runId
        ? `The connection dropped while following run ${runId}. It keeps running on Pascal; check it with "pascal architect status ${runId}".`
        : 'The connection dropped before Pascal confirmed the run. Try again.',
      runId ? { id: runId } : undefined,
    )
  } finally {
    clear()
  }
}

export async function getArchitectRun(
  apiKey: string | undefined,
  id: string,
  options: ArchitectRequestOptions = {},
): Promise<ArchitectRun> {
  const runId = requireRunId(id)
  const credential = requireAgentApiKey(apiKey)
  return requestRun(credential, 'status', runUrl(runId), 'GET', undefined, options)
}

export async function cancelArchitectRun(
  apiKey: string | undefined,
  id: string,
  options: ArchitectRequestOptions = {},
): Promise<ArchitectRun> {
  const runId = requireRunId(id)
  const credential = requireAgentApiKey(apiKey)
  return requestRun(credential, 'cancel', `${runUrl(runId)}/cancel`, 'POST', undefined, options)
}

function runRequestBody(request: ArchitectRunRequest, stream: boolean): string {
  const brief = request.brief.trim()
  if (!brief)
    throw invalidOption(
      'Describe what the architect should design: pascal architect run "<brief>".',
    )
  if (brief.length > MAX_BRIEF_LENGTH) {
    throw invalidOption(`The brief must be at most ${MAX_BRIEF_LENGTH} characters.`)
  }
  if (request.effort !== undefined && !isArchitectEffort(request.effort)) {
    throw invalidOption(`--effort must be one of ${ARCHITECT_EFFORTS.join(', ')}.`)
  }
  const metadata: Record<string, string> = {}
  if (request.projectId !== undefined) {
    const projectId = request.projectId.trim()
    if (!projectId || projectId.length > MAX_METADATA_VALUE_LENGTH) {
      throw invalidOption(`--project must be 1 to ${MAX_METADATA_VALUE_LENGTH} characters.`)
    }
    metadata.project_id = projectId
  }
  if (request.maxCredits !== undefined) {
    if (!Number.isSafeInteger(request.maxCredits) || request.maxCredits < 1) {
      throw invalidOption('--max-credits must be a positive integer.')
    }
    metadata.pascal_max_credits = String(request.maxCredits)
  }
  return JSON.stringify({
    model: architectModel(request.effort),
    input: brief,
    background: true,
    store: true,
    stream,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  })
}

function requireRunId(id: string): string {
  const runId = id.trim()
  if (!RESPONSE_ID_PATTERN.test(runId)) {
    throw invalidOption('Pass the run ID printed by "pascal architect run".')
  }
  return runId
}

function runUrl(id: string): string {
  return `${ARCHITECT_RESPONSES_ENDPOINT}/${encodeURIComponent(id)}`
}

async function requestRun(
  credential: string,
  action: ArchitectAction,
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  options: ArchitectRequestOptions,
): Promise<ArchitectRun> {
  const { controller, clear } = requestController(options)
  try {
    const response = await send(credential, action, url, method, body, { ...options, controller })
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBoundedText(response, MAX_JSON_BYTES))
    } catch (error) {
      if (options.signal?.aborted) throw detachedError(undefined)
      if (controller.signal.aborted) throw timeoutError(action)
      if (error instanceof CliError) throw error
      throw invalidResponse()
    }
    const run = isRecord(parsed) ? toArchitectRun(parsed) : undefined
    if (!run) throw invalidResponse()
    return run
  } finally {
    clear()
  }
}

async function send(
  credential: string,
  action: ArchitectAction,
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  options: ArchitectRequestOptions & { controller: AbortController; stream?: boolean },
): Promise<Response> {
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, {
      method,
      headers: {
        Accept: options.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${credential}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      redirect: 'error',
      signal: options.controller.signal,
    })
  } catch {
    if (options.signal?.aborted) throw detachedError(undefined)
    if (options.controller.signal.aborted) throw timeoutError(action)
    throw new CliError(
      'architect_unreachable',
      'Pascal could not be reached. Check the network connection and try again.',
    )
  }
  if (!response.ok) throw httpError(action, response.status, await readErrorCode(response))
  return response
}

function requestController(options: ArchitectRequestOptions) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) controller.abort()
  return {
    controller,
    headersReceived: () => clearTimeout(timeout),
    clear: () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => {})
    throw invalidResponse()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxBytes) {
      void reader.cancel().catch(() => {})
      throw invalidResponse()
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = JSON.parse(await readBoundedText(response, MAX_ERROR_BYTES)) as unknown
    if (!isRecord(body)) return undefined
    const code = isRecord(body.error) ? body.error.code : (body.code ?? body.error)
    return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const abort = () => void reader.cancel().catch(() => {})
  signal.addEventListener('abort', abort, { once: true })
  let buffer = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (signal.aborted) throw signal.reason
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = chunk.done ? '' : (blocks.pop() ?? '')
      if (buffer.length > MAX_JSON_BYTES) throw invalidResponse()
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
          .join('\n')
        if (!data || data === '[DONE]') continue
        let event: unknown
        try {
          event = JSON.parse(data)
        } catch {
          throw invalidResponse()
        }
        if (isRecord(event)) yield event
      }
      if (chunk.done) return
    }
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

function toArchitectRun(value: Record<string, unknown>): ArchitectRun | undefined {
  if (typeof value.id !== 'string' || !RESPONSE_ID_PATTERN.test(value.id)) return undefined
  const status = value.status
  if (typeof status !== 'string' || !(RUN_STATUSES as readonly string[]).includes(status)) {
    return undefined
  }
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const maxCredits = Number(metadata.pascal_max_credits)
  return {
    schemaVersion: 1,
    id: value.id,
    status: status as ArchitectRunStatus,
    model: typeof value.model === 'string' ? sanitizeLine(value.model) : null,
    projectId: typeof metadata.project_id === 'string' ? sanitizeLine(metadata.project_id) : null,
    maxCredits: Number.isSafeInteger(maxCredits) && maxCredits > 0 ? maxCredits : null,
    createdAt:
      typeof value.created_at === 'number' && Number.isFinite(value.created_at)
        ? new Date(value.created_at * 1000).toISOString()
        : null,
    outputText: outputText(value),
    error: runError(value),
  }
}

function outputText(value: Record<string, unknown>): string | null {
  if (typeof value.output_text === 'string') return sanitizeText(value.output_text)
  if (!Array.isArray(value.output)) return null
  const parts: string[] = []
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
  }
  return parts.length > 0 ? sanitizeText(parts.join('')) : null
}

function runError(value: Record<string, unknown>): ArchitectRun['error'] {
  const error = isRecord(value.error) ? value.error : undefined
  const incomplete = isRecord(value.incomplete_details) ? value.incomplete_details : undefined
  if (!error && !incomplete) return null
  const code = error?.code
  const message = error?.message ?? incomplete?.reason
  return {
    code: typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : null,
    message:
      typeof message === 'string'
        ? sanitizeLine(message).slice(0, MAX_SERVER_MESSAGE_LENGTH)
        : null,
  }
}

/** Server text reaches a terminal, so it keeps line breaks and tabs but no control sequences. */
function sanitizeText(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}

function sanitizeLine(value: string): string {
  return sanitizeText(value).replace(/\s+/g, ' ').trim()
}

function streamError(event: Record<string, unknown>, runId: string | undefined): CliError {
  const nested = isRecord(event.error) ? event.error : event
  const code =
    typeof nested.code === 'string' && ERROR_CODE_PATTERN.test(nested.code)
      ? nested.code
      : undefined
  if (code === 'executor_unavailable') return executorUnavailable('run', undefined)
  return new CliError(
    'architect_run_error',
    runId
      ? `Pascal reported an error while streaming run ${runId}. Check it with "pascal architect status ${runId}".`
      : 'Pascal reported an error before the run started. Try again.',
    { ...(runId ? { id: runId } : {}), ...(code ? { code } : {}) },
  )
}

function httpError(action: ArchitectAction, status: number, code: string | undefined): CliError {
  const details = { status, ...(code ? { code } : {}) }
  if (code === 'executor_unavailable') return executorUnavailable(action, status)
  switch (status) {
    case 400:
      return new CliError(
        'architect_invalid_request',
        `Pascal rejected the architect request${code ? ` (${code})` : ''}. Check the brief and options.`,
        details,
      )
    case 401:
      return new CliError(
        'architect_unauthorized',
        'PASCAL_API_KEY is invalid or revoked. Check it with "pascal agent status".',
        details,
      )
    case 402:
      return new CliError(
        'architect_insufficient_credits',
        'The account behind PASCAL_API_KEY does not have enough Pascal credits for this run.',
        details,
      )
    case 403:
      return new CliError(
        'architect_forbidden',
        'PASCAL_API_KEY is not allowed to use the Pascal architect. Check it with "pascal agent status".',
        details,
      )
    case 404:
      if (action !== 'run') {
        return new CliError(
          'architect_run_not_found',
          'No architect run with that ID is visible to this PASCAL_API_KEY.',
          details,
        )
      }
      break
    case 429:
      return new CliError(
        'architect_rate_limited',
        'Too many architect requests. Wait and try again.',
        details,
        ARCHITECT_RETRY_EXIT_CODE,
      )
    case 503:
      return new CliError(
        'architect_unavailable',
        'The Pascal architect is temporarily unavailable. Try again shortly.',
        details,
        ARCHITECT_RETRY_EXIT_CODE,
      )
  }
  return new CliError(
    'architect_failed',
    `Pascal could not ${action === 'run' ? 'start the architect run' : action === 'status' ? 'read the architect run' : 'cancel the architect run'} (HTTP ${status}).`,
    details,
  )
}

function executorUnavailable(action: ArchitectAction, status: number | undefined): CliError {
  return new CliError(
    'architect_executor_unavailable',
    action === 'run'
      ? 'No Pascal architect executor is available right now, so the run was not started. Try again in a few minutes.'
      : 'No Pascal architect executor is available right now. Try again in a few minutes.',
    { ...(status ? { status } : {}), code: 'executor_unavailable' },
    ARCHITECT_RETRY_EXIT_CODE,
  )
}

function detachedError(runId: string | undefined): CliError {
  return new CliError(
    'architect_detached',
    runId
      ? `Detached from run ${runId}; it keeps running on Pascal. Check it with "pascal architect status ${runId}" or stop it with "pascal architect cancel ${runId}".`
      : 'Stopped before Pascal confirmed the run.',
    runId ? { id: runId } : undefined,
    130,
  )
}

function timeoutError(action: ArchitectAction): CliError {
  return new CliError(
    'architect_timeout',
    action === 'run'
      ? 'Pascal did not respond while starting the architect run. Try again.'
      : 'Pascal did not respond. Try again.',
  )
}

function invalidResponse(): CliError {
  return new CliError(
    'architect_invalid_response',
    'Pascal returned an invalid architect response. Try again.',
  )
}

function invalidOption(message: string): CliError {
  return new CliError('invalid_option', message, undefined, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
