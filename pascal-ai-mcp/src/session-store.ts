import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ChatMessage } from './types'

type SessionDb = {
  sessions: Record<string, ChatMessage[]>
}

export class SessionStore {
  private db: SessionDb

  constructor(private readonly filePath: string) {
    this.db = this.read()
  }

  get(sessionId: string): ChatMessage[] {
    return [...(this.db.sessions[sessionId] ?? [])]
  }

  set(sessionId: string, messages: ChatMessage[]): void {
    this.db.sessions[sessionId] = messages
    this.write()
  }

  delete(sessionId: string): boolean {
    const existed = sessionId in this.db.sessions
    delete this.db.sessions[sessionId]
    this.write()
    return existed
  }

  private read(): SessionDb {
    if (!existsSync(this.filePath)) return { sessions: {} }
    const raw = readFileSync(this.filePath, 'utf8')
    if (!raw.trim()) return { sessions: {} }
    return JSON.parse(raw) as SessionDb
  }

  private write(): void {
    writeFileSync(this.filePath, `${JSON.stringify(this.db, null, 2)}\n`)
  }
}
