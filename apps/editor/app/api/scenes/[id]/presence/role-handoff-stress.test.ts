import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WallNode } from '@pascal-app/core/schema'
import { NextRequest } from 'next/server'

const tempDir = mkdtempSync(join(tmpdir(), 'api-presence-stress-test-'))
const SCENE_ID = 'api-stress-handoff-scene'

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

let currentSessionUser: { id: string; email: string; role: 'admin' | 'editor' | 'viewer' } | null = null
let mockAuthAvailable = true

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

  await store.save({
    id: SCENE_ID,
    name: 'API Stress Scene',
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

describe('API Route Empirical Stress Testing — Role Handoff (R3 API)', () => {
  beforeEach(async () => {
    mockAuthAvailable = true
    currentSessionUser = null

    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    if (operations.canTrackPresence) {
      for (const uid of ['user_a', 'user_b', 'user_c', 'user_d', 'user_e', 'user_f']) {
        await operations.releaseScenePresence(SCENE_ID, uid)
      }
    }
  })

  // ── 1. Sequential Loop via API ─────────────────────────────────────────────
  test('stress api 1: sequential handoff loop A -> B -> C -> A across API routes', async () => {
    const users = [
      { id: 'user_a', email: 'a@api.com', role: 'editor' as const },
      { id: 'user_b', email: 'b@api.com', role: 'editor' as const },
      { id: 'user_c', email: 'c@api.com', role: 'editor' as const },
    ]

    // Step 1: User A joins and claims editor lease
    currentSessionUser = users[0]!
    const r1 = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    expect(((await r1.json()) as { isEditor: boolean }).isEditor).toBe(true)

    // Step 2: Users B and C join as viewers
    currentSessionUser = users[1]!
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))
    currentSessionUser = users[2]!
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // Perform 10 full loops (30 handoffs)
    let currentEditorIdx = 0
    for (let loop = 0; loop < 10; loop++) {
      for (let step = 0; step < users.length; step++) {
        const nextEditorIdx = (currentEditorIdx + 1) % users.length
        const fromUser = users[currentEditorIdx]!
        const toUser = users[nextEditorIdx]!

        // Handoff call
        currentSessionUser = fromUser
        const transferRes = await POST(
          presencePostRequest(SCENE_ID, { transferToUserId: toUser.id }),
          paramsFor(SCENE_ID),
        )
        expect(transferRes.status).toBe(200)
        const transferData = (await transferRes.json()) as {
          isEditor: boolean
          editor: { userId: string }
          present: Array<{ userId: string; isEditor: boolean }>
        }

        expect(transferData.isEditor).toBe(false)
        expect(transferData.editor.userId).toBe(toUser.id)

        // Verify presence list consistency
        const editorsInList = transferData.present.filter((p) => p.isEditor)
        expect(editorsInList).toHaveLength(1)
        expect(editorsInList[0]!.userId).toBe(toUser.id)

        // Target user heartbeats and confirms isEditor = true
        currentSessionUser = toUser
        const hbRes = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
        const hbData = (await hbRes.json()) as { isEditor: boolean; editor: { userId: string } }
        expect(hbData.isEditor).toBe(true)
        expect(hbData.editor.userId).toBe(toUser.id)

        currentEditorIdx = nextEditorIdx
      }
    }
  })

  // ── 2. Unauthorized Transfers via API ──────────────────────────────────────
  test('stress api 2: unauthorized viewers and read-only users cannot transfer role', async () => {
    // User A is editor
    currentSessionUser = { id: 'user_a', email: 'a@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // User B is viewer with role 'editor'
    currentSessionUser = { id: 'user_b', email: 'b@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // User C is viewer with role 'viewer' (read-only)
    currentSessionUser = { id: 'user_c', email: 'c@api.com', role: 'viewer' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // User B tries to transfer to C
    currentSessionUser = { id: 'user_b', email: 'b@api.com', role: 'editor' }
    const resB = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_c' }),
      paramsFor(SCENE_ID),
    )
    const dataB = (await resB.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(dataB.isEditor).toBe(false)
    expect(dataB.editor.userId).toBe('user_a')

    // User C (read-only) tries to transfer to B
    currentSessionUser = { id: 'user_c', email: 'c@api.com', role: 'viewer' }
    const resC = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_b' }),
      paramsFor(SCENE_ID),
    )
    const dataC = (await resC.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(dataC.isEditor).toBe(false)
    expect(dataC.editor.userId).toBe('user_a')
  })

  // ── 3. Invalid Target Handling via API ─────────────────────────────────────
  test('stress api 3: invalid transfer targets retain current editor status', async () => {
    currentSessionUser = { id: 'user_a', email: 'a@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    const badTargets = ['phantom-user-404', 'invalid#user!id', 'user_not_here']
    for (const target of badTargets) {
      const res = await POST(
        presencePostRequest(SCENE_ID, { transferToUserId: target }),
        paramsFor(SCENE_ID),
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as { isEditor: boolean; editor: { userId: string } }
      expect(data.isEditor).toBe(true)
      expect(data.editor.userId).toBe('user_a')
    }
  })

  // ── 4. Self-Transfer via API ───────────────────────────────────────────────
  test('stress api 4: self-transfer behaves as a valid no-op retention', async () => {
    currentSessionUser = { id: 'user_a', email: 'a@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    const res = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_a' }),
      paramsFor(SCENE_ID),
    )
    const data = (await res.json()) as { isEditor: boolean; editor: { userId: string } }
    expect(data.isEditor).toBe(true)
    expect(data.editor.userId).toBe('user_a')
  })

  // ── 6. Disconnection via DELETE route ──────────────────────────────────────
  test('stress api 6: role handoff followed by DELETE route and subsequent takeover', async () => {
    // User A claims editor
    currentSessionUser = { id: 'user_a', email: 'a@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))

    // User B joins as viewer
    currentSessionUser = { id: 'user_b', email: 'b@api.com', role: 'editor' }
    await POST(presencePostRequest(SCENE_ID, { wantsEdit: false }), paramsFor(SCENE_ID))

    // User A transfers to User B
    currentSessionUser = { id: 'user_a', email: 'a@api.com', role: 'editor' }
    const transferRes = await POST(
      presencePostRequest(SCENE_ID, { transferToUserId: 'user_b' }),
      paramsFor(SCENE_ID),
    )
    expect(((await transferRes.json()) as { isEditor: boolean }).isEditor).toBe(false)

    // User A leaves via DELETE
    const delRes = await DELETE(presenceDeleteRequest(SCENE_ID), paramsFor(SCENE_ID))
    expect(delRes.status).toBe(200)

    // User B heartbeats and confirms editor
    currentSessionUser = { id: 'user_b', email: 'b@api.com', role: 'editor' }
    const bHb = await POST(presencePostRequest(SCENE_ID, { wantsEdit: true }), paramsFor(SCENE_ID))
    const bData = (await bHb.json()) as {
      isEditor: boolean
      editor: { userId: string }
      present: Array<{ userId: string }>
    }
    expect(bData.isEditor).toBe(true)
    expect(bData.editor.userId).toBe('user_b')
    expect(bData.present.find((p) => p.userId === 'user_a')).toBeUndefined()
  })
})
