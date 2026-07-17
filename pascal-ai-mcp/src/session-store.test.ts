import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from './session-store'
import type { WorkflowSession } from './types'

function sessionFixture(sessionId: string): WorkflowSession {
  return { sessionId, phase: 'idle', messages: [] } as unknown as WorkflowSession
}

describe('SessionStore.flushAll', () => {
  test('resolves once queued writes are on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-store-'))
    const filePath = join(dir, 'sessions.json')
    try {
      const store = new SessionStore(filePath)
      store.set('s1', sessionFixture('s1'))
      store.set('s2', sessionFixture('s2'))
      await store.flushAll()
      expect(existsSync(filePath)).toBe(true)
      const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
        sessions: Record<string, unknown>
      }
      expect(Object.keys(persisted.sessions).sort()).toEqual(['s1', 's2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Shutdown must not report a clean exit when the final write was lost —
  // steady-state writes swallow flush errors, flushAll must surface them.
  test('rejects when the final write failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-store-'))
    const filePath = join(dir, 'sessions.json')
    try {
      const store = new SessionStore(filePath)
      // Block the write after construction: rename(tmp, filePath) fails
      // because the target is now a directory.
      mkdirSync(filePath)
      store.set('s1', sessionFixture('s1'))
      await expect(store.flushAll()).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a later successful write clears the failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-store-'))
    const filePath = join(dir, 'sessions.json')
    try {
      const store = new SessionStore(filePath)
      mkdirSync(filePath)
      store.set('s1', sessionFixture('s1'))
      await expect(store.flushAll()).rejects.toThrow()
      // Unblock the target and write again: flushAll should recover.
      rmSync(filePath, { recursive: true, force: true })
      store.set('s2', sessionFixture('s2'))
      await store.flushAll()
      const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
        sessions: Record<string, unknown>
      }
      expect(Object.keys(persisted.sessions).sort()).toEqual(['s1', 's2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
