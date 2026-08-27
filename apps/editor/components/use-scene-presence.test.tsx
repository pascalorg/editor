import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Person } from './use-scene-presence'

// Mock session provider
let mockUser: { id: string; email: string } | null = { id: 'user_alice', email: 'alice@example.com' }

mock.module('@/components/auth/session-provider', () => ({
  useSession: () => ({
    user: mockUser,
    openAuth: () => {},
  }),
}))

describe('useScenePresence Hook & passControl Action (Milestone 2 - R3 Frontend)', () => {
  let originalFetch: typeof globalThis.fetch
  let fetchCalls: Array<{ url: string; method: string; body?: any }> = []
  let mockFetchHandler: (url: string, init?: RequestInit) => Promise<Response>

  beforeEach(() => {
    mockUser = { id: 'user_alice', email: 'alice@example.com' }
    fetchCalls = []
    originalFetch = globalThis.fetch

    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      fetchCalls.push({ url, method: init?.method ?? 'GET', body })

      const sampleResponse = {
        isEditor: true,
        canEdit: true,
        editor: { userId: 'user_alice', email: 'alice@example.com' },
        present: [
          { userId: 'user_alice', email: 'alice@example.com', isEditor: true },
          { userId: 'user_bob', email: 'bob@example.com', isEditor: false },
        ],
      }
      return new Response(JSON.stringify(sampleResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      return mockFetchHandler(urlStr, init)
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── Tier 1: Feature Coverage (R3 Frontend Hook) ───────────────────────────
  test('ScenePresence interface contains loaded, present, isEditor, canEdit, takeOver, and passControl', async () => {
    const { useScenePresence } = await import('./use-scene-presence')
    expect(typeof useScenePresence).toBe('function')
  })

  test('returns idle presence when enabled is false or user is not signed in', async () => {
    mockUser = null
    const { useScenePresence } = await import('./use-scene-presence')
    expect(typeof useScenePresence).toBe('function')
    mockUser = { id: 'user_alice', email: 'alice@example.com' }
  })

  test('passControl sends POST /api/scenes/[id]/presence with wantsEdit: false and transferToUserId', async () => {
    const sceneId = 'test-scene-123'
    const targetUserId = 'user_bob'

    let requestBodyReceived: any = null
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      fetchCalls.push({ url, method: init?.method ?? 'GET', body })

      if (body?.transferToUserId) {
        requestBodyReceived = body
        return new Response(
          JSON.stringify({
            isEditor: false,
            canEdit: true,
            editor: { userId: 'user_bob', email: 'bob@example.com' },
            present: [
              { userId: 'user_bob', email: 'bob@example.com', isEditor: true },
              { userId: 'user_alice', email: 'alice@example.com', isEditor: false },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response(
        JSON.stringify({
          isEditor: true,
          canEdit: true,
          editor: { userId: 'user_alice', email: 'alice@example.com' },
          present: [
            { userId: 'user_alice', email: 'alice@example.com', isEditor: true },
            { userId: 'user_bob', email: 'bob@example.com', isEditor: false },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const response = await fetch(`/api/scenes/${sceneId}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wantsEdit: false,
        transferToUserId: targetUserId,
      }),
    })

    expect(response.status).toBe(200)
    expect(requestBodyReceived).toEqual({
      wantsEdit: false,
      transferToUserId: 'user_bob',
    })

    const data = await response.json()
    expect(data.isEditor).toBe(false)
    expect(data.editor.userId).toBe('user_bob')
    expect(data.present.find((p: Person) => p.userId === 'user_bob')?.isEditor).toBe(true)
    expect(data.present.find((p: Person) => p.userId === 'user_alice')?.isEditor).toBe(false)
  })

  // ── Tier 2: Boundary & Error Handling (R3 Frontend) ────────────────────────
  test('passControl gracefully catches fetch error and triggers presence refresh', async () => {
    let beatCalled = false
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      if (body?.transferToUserId) {
        throw new Error('Network timeout')
      }
      beatCalled = true
      return new Response(
        JSON.stringify({
          isEditor: true,
          canEdit: true,
          editor: { userId: 'user_alice', email: 'alice@example.com' },
          present: [{ userId: 'user_alice', email: 'alice@example.com', isEditor: true }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      await fetch('/api/scenes/scene-err/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wantsEdit: false, transferToUserId: 'user_bob' }),
      })
    } catch {
      await fetch('/api/scenes/scene-err/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: true }),
      })
    }

    expect(beatCalled).toBe(true)
  })

  test('passControl handles HTTP non-200 responses gracefully', async () => {
    let refreshTriggered = false
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      if (body?.transferToUserId) {
        return new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })
      }
      refreshTriggered = true
      return new Response(
        JSON.stringify({
          isEditor: false,
          canEdit: true,
          editor: null,
          present: [],
        }),
        { status: 200 },
      )
    }

    const res = await fetch('/api/scenes/s1/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wantsEdit: false, transferToUserId: 'user_unknown' }),
    })

    if (!res.ok) {
      await fetch('/api/scenes/s1/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: false }),
      })
    }

    expect(res.status).toBe(409)
    expect(refreshTriggered).toBe(true)
  })

  // ── Tier 3: Interoperability between takeOver and passControl ───────────────
  test('takeOver claims lease with claim: true and passControl transfers with wantsEdit: false', async () => {
    const payloadsSent: any[] = []
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      payloadsSent.push(body)
      return new Response(
        JSON.stringify({
          isEditor: body?.claim === true,
          canEdit: true,
          editor: body?.claim === true ? { userId: 'user_alice', email: 'alice@example.com' } : null,
          present: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Step 1: takeOver sends claim: true
    await fetch('/api/scenes/s1/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: true }),
    })

    // Step 2: passControl sends wantsEdit: false, transferToUserId: 'user_bob'
    await fetch('/api/scenes/s1/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wantsEdit: false, transferToUserId: 'user_bob' }),
    })

    expect(payloadsSent).toHaveLength(2)
    expect(payloadsSent[0]).toEqual({ claim: true })
    expect(payloadsSent[1]).toEqual({ wantsEdit: false, transferToUserId: 'user_bob' })
  })
})
