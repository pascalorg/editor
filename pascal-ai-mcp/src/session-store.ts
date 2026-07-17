import { existsSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import type { WorkflowSession } from './types'

type SessionDb = {
  sessions: Record<string, WorkflowSession>
}

export class SessionStore {
  private db: SessionDb
  // Serializes disk writes so they never interleave, without making callers
  // await them. In-memory state (this.db) is updated synchronously in
  // set()/delete(), so get() always reflects the latest data even while a
  // previous write is still flushing to disk.
  private writeQueue: Promise<void> = Promise.resolve()
  // Most recent flush failure. Steady-state writes only log it (a later write
  // usually supersedes the lost one), but shutdown must surface it — exiting
  // "cleanly" after a swallowed failure would silently drop the final state.
  private lastFlushError: unknown = null

  constructor(private readonly filePath: string) {
    this.db = this.read()
  }

  // Snapshot of every persisted session — used by the startup stuck-state
  // sweep (agent constructor). Cloned like get() so callers can't mutate the
  // store through the returned objects.
  allSessions(): WorkflowSession[] {
    return Object.values(this.db.sessions).map(session => structuredClone(session))
  }

  get(sessionId: string): WorkflowSession | undefined {
    const value = this.db.sessions[sessionId]
    return value ? structuredClone(value) : undefined
  }

  set(sessionId: string, session: WorkflowSession): void {
    this.db.sessions[sessionId] = structuredClone(session)
    this.scheduleWrite()
  }

  delete(sessionId: string): boolean {
    const existed = sessionId in this.db.sessions
    delete this.db.sessions[sessionId]
    this.scheduleWrite()
    return existed
  }

  private read(): SessionDb {
    if (!existsSync(this.filePath)) return { sessions: {} }
    const raw = readFileSync(this.filePath, 'utf8')
    if (!raw.trim()) return { sessions: {} }
    const parsed = JSON.parse(raw) as { sessions?: Record<string, unknown> }
    const sessions = Object.fromEntries(
      Object.entries(parsed.sessions ?? {}).filter(
        (entry): entry is [string, WorkflowSession] => isWorkflowSession(entry[1]),
      ),
    )
    return { sessions }
  }

  // Every chat turn used to synchronously serialize and write the *entire*
  // session DB to disk, blocking the single-threaded event loop (and every
  // other in-flight request) for the duration. This snapshots synchronously
  // (cheap, in-memory) but performs the actual disk write asynchronously.
  private scheduleWrite(): void {
    const snapshot = `${JSON.stringify(this.db, null, 2)}\n`
    this.writeQueue = this.writeQueue.catch(() => undefined).then(() => this.flush(snapshot))
  }

  // Waits for every queued write to hit disk. Throws if the final state is
  // not persisted, so shutdown can exit non-zero instead of losing data
  // silently (ARCHITECTURE_TASKS.md T0.4).
  async flushAll(): Promise<void> {
    await this.writeQueue
    if (this.lastFlushError !== null) {
      throw this.lastFlushError instanceof Error
        ? this.lastFlushError
        : new Error(String(this.lastFlushError))
    }
  }

  private async flush(snapshot: string): Promise<void> {
    const temporary = `${this.filePath}.tmp`
    try {
      await writeFile(temporary, snapshot)
      await rename(temporary, this.filePath)
      this.lastFlushError = null
    } catch (error) {
      this.lastFlushError = error
      console.error(`Failed to persist session store to ${this.filePath}:`, error)
    }
  }
}

function isWorkflowSession(value: unknown): value is WorkflowSession {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'phase' in value
}
