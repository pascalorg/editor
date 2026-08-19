import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

/**
 * Integration gate for the scene-wipe class: `PUT /api/scenes/[id]` must
 * reject (409 `empty_graph_rejected`) a 0-node graph aimed at a scene that has
 * nodes, unless the caller passes `force: true`. Runs the real route handler
 * against a real SQLite store in a temp directory.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'scenes-put-guard-'))
const SCENE_ID = 'wipe-guard-scene'

// A minimal graph that passes `apiGraphSchema`: a foreign-typed node is held
// to the BaseNode envelope only, so it stays independent of builtin schemas.
const POPULATED_GRAPH = {
  nodes: {
    n1: { id: 'n1', type: 'qa:box' },
    n2: { id: 'n2', type: 'qa:box' },
  },
  rootNodeIds: ['n1'],
}
const EMPTY_GRAPH = { nodes: {}, rootNodeIds: [] }

let PUT: typeof import('../app/api/scenes/[id]/route')['PUT']
let restoreEnv: () => void

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
  delete process.env.PASCAL_SCENE_API_TOKEN // loopback requests need no token

  const storeServer = await import('./scene-store-server')
  storeServer.__resetSceneStoreForTests()

  // Seed through the raw STORE, not SceneOperations: CI's module graph can
  // resolve '@pascal-app/mcp/operations' to a build predating saveScene
  // (turbo cache), while the store's save() is the stable primitive the
  // operations layer itself delegates to.
  const store = await storeServer.getSceneStore()
  await store.save({
    id: SCENE_ID,
    name: 'Wipe guard fixture',
    projectId: null,
    graph: POPULATED_GRAPH as never,
  })

  const route = await import('../app/api/scenes/[id]/route')
  PUT = route.PUT
})

afterAll(async () => {
  const storeServer = await import('./scene-store-server')
  const store = await storeServer.getSceneStore()
  ;(store as { close?: () => void }).close?.()
  storeServer.__resetSceneStoreForTests()
  restoreEnv()
  rmSync(tempDir, { recursive: true, force: true })
})

function putRequest(body: unknown, ifMatch?: number): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${SCENE_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      host: '127.0.0.1:3000',
      ...(ifMatch === undefined ? {} : { 'If-Match': `"${ifMatch}"` }),
    },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: SCENE_ID }) }

test('rejects an empty graph over a populated scene with 409 empty_graph_rejected', async () => {
  const response = await PUT(putRequest({ graph: EMPTY_GRAPH }, 1), params)

  expect(response.status).toBe(409)
  const body = (await response.json()) as {
    error: string
    currentVersion: number
    currentNodeCount: number
  }
  expect(body.error).toBe('empty_graph_rejected')
  expect(body.currentVersion).toBe(1)
  expect(body.currentNodeCount).toBe(2)
})

test('the rejected PUT leaves the stored scene untouched', async () => {
  const storeServer = await import('./scene-store-server')
  const operations = await storeServer.getSceneOperations()
  const scene = await operations.loadStoredScene(SCENE_ID)

  expect(scene?.version).toBe(1)
  expect(Object.keys(scene?.graph.nodes ?? {})).toHaveLength(2)
})

test('a populated save still goes through', async () => {
  const graph = {
    nodes: { ...POPULATED_GRAPH.nodes, n3: { id: 'n3', type: 'qa:box' } },
    rootNodeIds: ['n1'],
  }
  const response = await PUT(putRequest({ graph }, 1), params)

  expect(response.status).toBe(200)
  const meta = (await response.json()) as { version: number; nodeCount: number }
  expect(meta.version).toBe(2)
  expect(meta.nodeCount).toBe(3)
})

test('force: true allows an intentional wipe', async () => {
  const response = await PUT(putRequest({ graph: EMPTY_GRAPH, force: true }, 2), params)

  expect(response.status).toBe(200)
  const meta = (await response.json()) as { version: number; nodeCount: number }
  expect(meta.version).toBe(3)
  expect(meta.nodeCount).toBe(0)
})

test('an empty save over an already-empty scene needs no force', async () => {
  const response = await PUT(putRequest({ graph: EMPTY_GRAPH }, 3), params)

  expect(response.status).toBe(200)
  const meta = (await response.json()) as { version: number; nodeCount: number }
  expect(meta.version).toBe(4)
  expect(meta.nodeCount).toBe(0)
})
