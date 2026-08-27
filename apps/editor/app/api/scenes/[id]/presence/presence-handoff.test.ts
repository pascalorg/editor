import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WallNode } from '@pascal-app/core/schema'
import { NextRequest } from 'next/server'

const tempDir = mkdtempSync(join(tmpdir(), 'scenes-presence-handoff-test-'))
const SCENE_ID = 'presence-handoff-scene'
const OTHER_SCENE_ID = 'other-scene'

const wallA = WallNode.parse({ start: [0, 0], end: [4, 0] })
const POPULATED_GRAPH = {
  nodes: {
    [wallA.id]: wallA,
  },
  rootNodeIds: [wallA.id],
}

let POST: typeof import('./route')['POST']
let DELETE: typeof import('./route')['DELETE']
let restoreEnv: () => void

// Configurable mock session user
let currentSessionUser: { id: string; email: string; role: 'admin' | 'editor' | 'viewer' } | null = null
let mockAuthAvailable = false

beforeAll(async () => {
  const saved = {
    PASCAL_DB_PATH: process.env.PASCAL_DB_PATH,
    PASCAL_SCENE_API_TOKEN: process.env.PASCAL_SCENE_API_TOKEN,
  }
  restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  process.env.PASCAL_DB_PATH = join(tempDir, 'pascal.db')
  delete process.env.PASCAL_SCENE_API_TOKEN

  // Mock auth db and session
  mock.module('@/lib/auth/db', () => ({
    authAvailable: () => mockAuthAvailable,
  }))

  mock.module('@/lib/auth/session', () => ({
    getSessionUser: async () => currentSessionUser,
    canEdit: (user: { role: string }) => user.role !== 'viewer',
  }))

  const storeServer = await import('@/lib/scene-store-server')
  storeServer.__resetSceneStoreForTests()

  const { SqliteSceneStore } = await import(
    '../../../../../../../packages/mcp/src/storage/sqlite-scene-store'
  )
  const { createSceneOperations } = await import(
    '../../../../../../../packages/mcp/src/operations/scene-operations'
  )
  const store = new SqliteSceneStore({ env: process.env })
  const operations = createSceneOperations({ store })
  storeServer.__setSceneStoreForTests(store, operations)

  // Unowned scenes allow any authenticated editor to collaborate and edit
  await store.save({
    id: SCENE_ID,
    name: 'Presence test fixture',
    ownerId: null,
    projectId: null,
    graph: POPULATED_GRAPH as never,
  })

  await store.save({
    id: OTHER_SCENE_ID,
    name: 'Other scene',
    ownerId: null,
    projectId: null,
    graph: POPULATED_GRAPH as never,
  })

  const route = await import('./route')
  POST = route.POST
  DELETE = route.DELETE
})

afterAll(async () => {
  const storeServer = await import('@/lib/scene-store-server')
  const store = await storeServer.getSceneStore()
  ;(store as unknown as { close?: () => void }).close?.()
  storeServer.__resetSceneStoreForTests()
  restoreEnv()
  rmSync(tempDir, { recursive: true, force: true })
})

function presencePostRequest(sceneId: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}/presence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: '127.0.0.1:3000',
    },
    body: JSON.stringify(body),
  })
}

function presenceDeleteRequest(sceneId: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}/presence`, {
    method: 'DELETE',
    headers: {
      host: '127.0.0.1:3000',
    },
  })
}

function paramsFor(sceneId: string) {
  return { params: Promise.resolve({ id: sceneId }) }
}

describe('POST & DELETE /api/scenes/[id]/presence (Presence & Role Handoff)', () => {
  beforeEach(async () => {
    mockAuthAvailable = false
    currentSessionUser = null

    // Reset presence for clean test isolation
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    if (operations.canTrackPresence) {
      await operations.releaseScenePresence(SCENE_ID, 'user_alice')
      await operations.releaseScenePresence(SCENE_ID, 'user_bob')
      await operations.releaseScenePresence(SCENE_ID, 'user_charlie')
      await operations.releaseScenePresence(SCENE_ID, 'user_dave')
    }
  })

  // ── Tier 1: Feature Coverage (R3 API) ──────────────────────────────────────
  test('returns default active editor when auth is off (SQLite dev mode fallback)', async () => {
    mockAuthAvailable = false
    const res = await POST(presencePostRequest(SCENE_ID, { claim: true }), paramsFor(SCENE_ID))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { isEditor: boolean; canEdit: boolean; present: unknown[] }
    expect(data.isEditor).toBe(true)
    expect(data.canEdit).toBe(true)
    expect(data.present).toEqual([])
  })

  test('DELETE returns ok when auth is off', async () => {
    mockAuthAvailable = false
    const res = await DELETE(presenceDeleteRequest(SCENE_ID), paramsFor(SCENE_ID))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  test('accepts wantsEdit flag as alias for claim in request payload', async () => {
    mockAuthAvailable = true
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }

    const res = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { isEditor: boolean; canEdit: boolean; editor: { userId: string } | null }
    expect(data.isEditor).toBe(true)
    expect(data.canEdit).toBe(true)
    expect(data.editor?.userId).toBe('user_alice')
  })

  test('active editor transfers role to viewer via transferToUserId', async () => {
    mockAuthAvailable = true

    // Step 1: Alice claims editor lease
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // Step 2: Bob joins as viewer
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // Step 3: Alice sends transferToUserId: 'user_bob'
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    const transferRes = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_bob' }),
      paramsFor(SCENE_ID),
    )
    expect(transferRes.status).toBe(200)
    const transferData = (await transferRes.json()) as {
      isEditor: boolean
      editor: { userId: string; email: string | null } | null
      present: Array<{ userId: string; isEditor: boolean }>
    }

    // Alice is now a viewer, Bob is the editor
    expect(transferData.isEditor).toBe(false)
    expect(transferData.editor?.userId).toBe('user_bob')
    expect(transferData.editor?.email).toBe('bob@example.com')

    const bobInList = transferData.present.find((p) => p.userId === 'user_bob')
    const aliceInList = transferData.present.find((p) => p.userId === 'user_alice')
    expect(bobInList?.isEditor).toBe(true)
    expect(aliceInList?.isEditor).toBe(false)
  })

  test('promoted viewer sees isEditor: true on subsequent heartbeat', async () => {
    mockAuthAvailable = true

    // Setup Alice as editor, Bob as viewer, then handoff
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { transferToUserId: 'user_bob' }), paramsFor(SCENE_ID))

    // Bob heartbeats
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const bobHeartbeat = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const bobData = (await bobHeartbeat.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(bobData.isEditor).toBe(true)
    expect(bobData.editor.userId).toBe('user_bob')
  })

  // ── Tier 2: Boundary & Error Handling (R3 API) ─────────────────────────────
  test('returns 401 auth_required when authenticated session is missing', async () => {
    mockAuthAvailable = true
    currentSessionUser = null

    const res = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    expect(res.status).toBe(401)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('auth_required')
  })

  test('returns 404 not_found when scene does not exist in store', async () => {
    mockAuthAvailable = true
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }

    const res = await POST(
      presencePostRequest('non-existent-scene-999', { wantsEdit: true }),
      paramsFor('non-existent-scene-999'),
    )
    expect(res.status).toBe(404)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('not_found')
  })

  test('rejects transfer attempt by a non-editor viewer', async () => {
    mockAuthAvailable = true

    // Alice is editor
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // Bob and Charlie are viewers
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_charlie', email: 'charlie@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // Bob tries to transfer to Charlie
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const res = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_charlie' }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { isEditor: boolean; editor: { userId: string } }
    // Bob remains non-editor and Alice remains the editor
    expect(data.isEditor).toBe(false)
    expect(data.editor.userId).toBe('user_alice')
  })

  test('transferToUserId with non-existent target leaves current editor in place', async () => {
    mockAuthAvailable = true
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    const res = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'phantom_user_xyz' }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(data.isEditor).toBe(true)
    expect(data.editor.userId).toBe('user_alice')
  })

  test('viewer sending bare or malformed request body remains a viewer', async () => {
    mockAuthAvailable = true
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const req = new NextRequest(`http://127.0.0.1:3000/api/scenes/${SCENE_ID}/presence`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3000' },
      body: 'invalid-json{{{',
    })
    const res = await POST(req, paramsFor(SCENE_ID))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { isEditor: boolean }
    // Bob didn't claim, so isEditor is false
    expect(data.isEditor).toBe(false)
  })

  // ── Tier 3: Cross-Feature Combinations (R3 API) ────────────────────────────
  test('DELETE removes caller presence and allows other participant to claim lease', async () => {
    mockAuthAvailable = true

    // Alice claims editor
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // Bob joins as viewer wanting edit
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const bob1 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    expect(((await bob1.json()) as { isEditor: boolean }).isEditor).toBe(false)

    // Alice leaves
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await DELETE(presenceDeleteRequest(SCENE_ID), paramsFor(SCENE_ID))

    // Bob heartbeats claiming editor
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const bob2 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const bob2Data = (await bob2.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(bob2Data.isEditor).toBe(true)
    expect(bob2Data.editor.userId).toBe('user_bob')
  })

  test('multiple viewers present during handoff only promotes targeted user', async () => {
    mockAuthAvailable = true

    // Alice is editor
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // Bob, Charlie, Dave join
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_charlie', email: 'charlie@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    currentSessionUser = { id: 'user_dave', email: 'dave@example.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // Alice transfers to Charlie
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    const res = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_charlie' }),
      paramsFor(SCENE_ID),
    )
    const data = (await res.json()) as {
      present: Array<{ userId: string; isEditor: boolean }>
    }

    expect(data.present.find((p) => p.userId === 'user_charlie')?.isEditor).toBe(true)
    expect(data.present.find((p) => p.userId === 'user_alice')?.isEditor).toBe(false)
    expect(data.present.find((p) => p.userId === 'user_bob')?.isEditor).toBe(false)
    expect(data.present.find((p) => p.userId === 'user_dave')?.isEditor).toBe(false)
  })

  // ── Tier 4: Scenarios (R3 API) ─────────────────────────────────────────────
  test('end-to-end multi-turn role handoff and editing takeover sequence', async () => {
    mockAuthAvailable = true

    // Turn 1: Alice opens scene, auto-claims edit lease
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    const t1 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    expect(((await t1.json()) as { isEditor: boolean }).isEditor).toBe(true)

    // Turn 2: Bob opens scene, told Alice is editing
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const t2 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const t2Data = (await t2.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(t2Data.isEditor).toBe(false)
    expect(t2Data.editor.userId).toBe('user_alice')

    // Turn 3: Alice passes control to Bob
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    const t3 = await POST(presencePostRequest(SCENE_ID, { transferToUserId: 'user_bob' }), paramsFor(SCENE_ID))
    const t3Data = (await t3.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(t3Data.isEditor).toBe(false)
    expect(t3Data.editor.userId).toBe('user_bob')

    // Turn 4: Bob receives heartbeat as new Editor
    currentSessionUser = { id: 'user_bob', email: 'bob@example.com', role: 'editor' }
    const t4 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const t4Data = (await t4.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(t4Data.isEditor).toBe(true)
    expect(t4Data.editor.userId).toBe('user_bob')

    // Turn 5: Alice heartbeats and is now in viewer mode
    currentSessionUser = { id: 'user_alice', email: 'alice@example.com', role: 'editor' }
    const t5 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const t5Data = (await t5.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(t5Data.isEditor).toBe(false)
    expect(t5Data.editor.userId).toBe('user_bob')
  })
})
