import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { findRepoRoot } from '@/lib/generated-assets/manifest'
import type {
  AiConversation,
  AiConversationSummary,
  AiHarnessRun,
  AiHarnessRunEvent,
  AiHarnessRunMode,
  AiHarnessRunStatus,
} from './types'

const AI_HARNESS_RUNS_DIR = path.join('apps', 'editor', '.generated', 'ai-harness-runs')
const fileLocks = new Map<string, Promise<void>>()
const WINDOWS_REPLACE_RETRY_DELAYS_MS = [20, 50, 100, 200, 400]

async function exists(filePath: string) {
  try {
    await fs.access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function aiHarnessRunsRoot() {
  return path.join(await findRepoRoot(), AI_HARNESS_RUNS_DIR)
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export async function runDir(runId: string) {
  return path.join(await aiHarnessRunsRoot(), 'runs', safeSegment(runId))
}

async function runsRoot() {
  return path.join(await aiHarnessRunsRoot(), 'runs')
}

async function conversationsRoot() {
  return path.join(await aiHarnessRunsRoot(), 'conversations')
}

async function runPath(runId: string) {
  return path.join(await runDir(runId), 'run.json')
}

async function runEventsPath(runId: string) {
  return path.join(await runDir(runId), 'events.jsonl')
}

async function conversationPath(conversationId: string) {
  return path.join(await conversationsRoot(), `${safeSegment(conversationId)}.json`)
}

async function conversationIndexPath() {
  return path.join(await aiHarnessRunsRoot(), 'conversations-index.json')
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await withFileLock(filePath, async () => {
    await writeJsonAtomicUnlocked(filePath, value)
  })
}

async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve()
  let release: () => void = () => {}
  let markReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const current = previous
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
          markReady()
        }),
    )
  fileLocks.set(filePath, current)

  await ready
  try {
    return await operation()
  } finally {
    release()
    if (fileLocks.get(filePath) === current) {
      fileLocks.delete(filePath)
    }
  }
}

async function writeJsonAtomicUnlocked(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await replaceFile(tmp, filePath)
}

function isTransientReplaceError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function replaceFile(tmp: string, filePath: string) {
  let lastError: unknown
  for (const retryDelay of [0, ...WINDOWS_REPLACE_RETRY_DELAYS_MS]) {
    if (retryDelay > 0) await delay(retryDelay)
    try {
      await fs.rename(tmp, filePath)
      return
    } catch (error) {
      lastError = error
      if (!isTransientReplaceError(error)) break
    }
  }

  try {
    await fs.copyFile(tmp, filePath)
    await fs.rm(tmp, { force: true })
    return
  } catch (copyError) {
    lastError = copyError
  }

  try {
    await fs.writeFile(filePath, await fs.readFile(tmp), 'utf8')
    await fs.rm(tmp, { force: true })
    return
  } catch (writeError) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw writeError instanceof Error ? writeError : lastError
  }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export async function createRun(input: {
  conversationId?: string
  mode: AiHarnessRunMode
  prompt: string
  articraftMode?: 'articulated' | 'static'
  params?: Record<string, unknown>
  context?: unknown
  image?: { name: string; type: string; dataUrl: string }
}) {
  const now = new Date().toISOString()
  const id = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const dir = await runDir(id)
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true })

  let image: AiHarnessRun['image']
  if (input.image) {
    const parsed = parseDataUrlImage(input.image.dataUrl)
    if (!parsed) throw new Error('Invalid reference image')
    const imagePath = path.join(path.join(dir, 'inputs'), `reference.${parsed.ext}`)
    await fs.writeFile(imagePath, parsed.buffer)
    image = { name: input.image.name, type: parsed.mime, path: imagePath }
  }

  const run: AiHarnessRun = {
    id,
    conversationId: input.conversationId || 'default',
    mode: input.mode,
    status: 'queued',
    prompt: input.prompt,
    articraftMode: input.articraftMode,
    params: input.params,
    context: input.context,
    image,
    createdAt: now,
    updatedAt: now,
  }
  await writeJsonAtomic(await runPath(id), run)
  await appendRunEvent(id, { type: 'status', message: 'queued', data: { status: 'queued' } })
  await addActiveRun(run.conversationId, id)
  return run
}

function parseDataUrlImage(dataUrl: string): { buffer: Buffer; mime: string; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match) return null
  const mime = match[1]?.toLowerCase()
  const payload = match[2]
  if (!mime || !payload) return null
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength > 10 * 1024 * 1024) return null
  return {
    buffer,
    mime,
    ext: mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg',
  }
}

export async function loadRun(runId: string) {
  return readJson<AiHarnessRun | null>(await runPath(runId), null)
}

export async function updateRun(runId: string, patch: Partial<AiHarnessRun>) {
  const filePath = await runPath(runId)
  const next = await withFileLock(filePath, async () => {
    const current = await readJson<AiHarnessRun | null>(filePath, null)
    if (!current) throw new Error(`Run not found: ${runId}`)
    if (isTerminalStatus(current.status) && patch.status && patch.status !== current.status) {
      return current
    }
    const updated: AiHarnessRun = { ...current, ...patch, updatedAt: new Date().toISOString() }
    await writeJsonAtomicUnlocked(filePath, updated)
    return updated
  })
  if (next.status === 'succeeded' || next.status === 'failed' || next.status === 'cancelled') {
    await removeActiveRun(next.conversationId, runId)
  }
  return next
}

export async function appendRunEvent(
  runId: string,
  input: Omit<AiHarnessRunEvent, 'id' | 'runId' | 'createdAt'>,
) {
  const filePath = await runEventsPath(runId)
  return withFileLock(filePath, async () => {
    const existing = await listRunEvents(runId, { after: 0, limit: Number.MAX_SAFE_INTEGER })
    const event: AiHarnessRunEvent = {
      id: (existing.at(-1)?.id ?? 0) + 1,
      runId,
      createdAt: new Date().toISOString(),
      ...input,
    }
    await fs.mkdir(await runDir(runId), { recursive: true })
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
    return event
  })
}

export async function listRunEvents(
  runId: string,
  options: { after?: number; limit?: number } = {},
) {
  const filePath = await runEventsPath(runId)
  if (!(await exists(filePath))) return []
  const after = Math.max(0, options.after ?? 0)
  const limit = Math.max(1, options.limit ?? 100)
  const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)
  const events: AiHarnessRunEvent[] = []
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as AiHarnessRunEvent
      if (event.id > after) events.push(event)
    } catch {
      // Ignore malformed partial lines.
    }
  }
  return events.slice(0, limit)
}

export async function loadConversation(conversationId: string) {
  const now = new Date().toISOString()
  return readJson<AiConversation>(await conversationPath(conversationId), {
    id: conversationId,
    messages: [],
    activeRunIds: [],
    createdAt: now,
    updatedAt: now,
  })
}

export async function saveConversation(conversation: AiConversation) {
  const filePath = await conversationPath(conversation.id)
  let saved: AiConversation | null = null
  await withFileLock(filePath, async () => {
    const existing = await readJson<AiConversation | null>(filePath, null)
    const title = resolveConversationTitle(conversation.title, conversation.messages)
    saved = {
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...conversation,
      activeRunIds: Array.from(new Set(conversation.activeRunIds)),
      title,
      updatedAt: new Date().toISOString(),
    }
    await writeJsonAtomicUnlocked(filePath, saved)
  })
  if (saved) await upsertConversationSummary(saved)
}

type AiConversationIndex = {
  version?: number
  conversations: AiConversationSummary[]
}

const DEFAULT_CONVERSATION_TITLES = new Set([
  '\u65b0\u4f1a\u8bdd',
  '\u65b0\u5bf9\u8bdd',
  '\u672a\u547d\u540d',
])
const CONVERSATION_TITLE_MAX_LENGTH = 48
const CONVERSATION_INDEX_VERSION = 1
const DEFAULT_CONVERSATION_LIST_LIMIT = 15

function resolveConversationTitle(title: string | undefined, messages: unknown[]) {
  const trimmed = title?.trim()
  if (trimmed && !DEFAULT_CONVERSATION_TITLES.has(trimmed)) return trimmed
  return inferConversationTitle(messages)
}

function inferConversationTitle(messages: unknown[]) {
  const firstUserMessage = messages.find((message) => {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return false
    const record = message as Record<string, unknown>
    return record.role === 'user' && typeof record.content === 'string' && record.content.trim()
  }) as Record<string, unknown> | undefined
  const content =
    typeof firstUserMessage?.content === 'string'
      ? firstUserMessage.content.replace(/\s+/g, ' ').trim()
      : ''
  if (!content) return '新会话'
  return content.length > CONVERSATION_TITLE_MAX_LENGTH
    ? `${content.slice(0, CONVERSATION_TITLE_MAX_LENGTH)}…`
    : content
}

function toConversationSummary(conversation: AiConversation): AiConversationSummary {
  return {
    id: conversation.id,
    title: resolveConversationTitle(conversation.title, conversation.messages),
    messageCount: conversation.messages.length,
    activeRunCount: conversation.activeRunIds.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }
}

function normalizeConversationSummaries(summaries: AiConversationSummary[]) {
  const byId = new Map<string, AiConversationSummary>()
  for (const summary of summaries) {
    if (!summary.id) continue
    byId.set(summary.id, summary)
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function readConversationIndex() {
  const filePath = await conversationIndexPath()
  const index = await readJson<AiConversationIndex | null>(filePath, null)
  if (!index || index.version !== CONVERSATION_INDEX_VERSION || !Array.isArray(index.conversations))
    return null
  return normalizeConversationSummaries(index.conversations)
}

async function writeConversationIndex(conversations: AiConversationSummary[]) {
  await writeJsonAtomic(await conversationIndexPath(), {
    version: CONVERSATION_INDEX_VERSION,
    conversations: normalizeConversationSummaries(conversations),
  } satisfies AiConversationIndex)
}

async function upsertConversationSummary(conversation: AiConversation) {
  const filePath = await conversationIndexPath()
  await withFileLock(filePath, async () => {
    const index = await readJson<AiConversationIndex | null>(filePath, null)
    const conversations = normalizeConversationSummaries(index?.conversations ?? [])
    const summary = toConversationSummary(conversation)
    await writeJsonAtomicUnlocked(filePath, {
      version: CONVERSATION_INDEX_VERSION,
      conversations: normalizeConversationSummaries([
        summary,
        ...conversations.filter((item) => item.id !== summary.id),
      ]),
    } satisfies AiConversationIndex)
  })
}

async function removeConversationSummary(conversationId: string) {
  const filePath = await conversationIndexPath()
  await withFileLock(filePath, async () => {
    const index = await readJson<AiConversationIndex | null>(filePath, null)
    await writeJsonAtomicUnlocked(filePath, {
      version: CONVERSATION_INDEX_VERSION,
      conversations: normalizeConversationSummaries(
        (index?.conversations ?? []).filter((conversation) => conversation.id !== conversationId),
      ),
    } satisfies AiConversationIndex)
  })
}

async function rebuildConversationIndex() {
  const root = await conversationsRoot()
  const entries = await fs.readdir(root, { withFileTypes: true })
  const conversations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => loadConversation(entry.name.replace(/\.json$/, ''))),
  )
  const summaries = normalizeConversationSummaries(conversations.map(toConversationSummary))
  await writeConversationIndex(summaries)
  return summaries
}

export async function listConversations(
  limit = DEFAULT_CONVERSATION_LIST_LIMIT,
  cursor = 0,
): Promise<AiConversationSummary[]> {
  try {
    const summaries = (await readConversationIndex()) ?? (await rebuildConversationIndex())
    const safeLimit = Math.min(100, Math.max(1, limit))
    const offset = Math.max(0, cursor)
    return summaries.slice(offset, offset + safeLimit)
  } catch {
    return []
  }
}

export async function deleteConversation(conversationId: string) {
  await fs.rm(await conversationPath(conversationId), { force: true })
  await removeConversationSummary(conversationId)
}

async function addActiveRun(conversationId: string, runId: string) {
  const conversation = await loadConversation(conversationId)
  await saveConversation({
    ...conversation,
    activeRunIds: Array.from(new Set([...conversation.activeRunIds, runId])),
  })
}

async function removeActiveRun(conversationId: string, runId: string) {
  const conversation = await loadConversation(conversationId)
  await saveConversation({
    ...conversation,
    activeRunIds: conversation.activeRunIds.filter((id) => id !== runId),
  })
}

export async function listActiveRuns(conversationId: string) {
  const conversation = await loadConversation(conversationId)
  const runs = await Promise.all(conversation.activeRunIds.map((id) => loadRun(id)))
  return runs.filter((run): run is AiHarnessRun => Boolean(run))
}

export async function listRecentRuns(limit = 20) {
  const root = await runsRoot()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const runs = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => loadRun(entry.name)),
    )
    return runs
      .filter((run): run is AiHarnessRun => Boolean(run))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
  } catch {
    return []
  }
}

export function isTerminalStatus(status: AiHarnessRunStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
