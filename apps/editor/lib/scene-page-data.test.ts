import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { SceneMeta, SceneStore, SceneWithGraph } from '@pascal-app/mcp/storage'

/**
 * Repro for editor#878. The server-rendered scene pages used to `fetch()` the
 * app's own `/api/scenes` through a base URL built from `NEXT_PUBLIC_APP_URL`
 * or the forwarded Host header. Behind a reverse proxy that self-request came
 * back non-loopback with neither `Origin` nor `Authorization`, so the API
 * answered 503 and `/scenes` rendered empty — and setting
 * `PASCAL_SCENE_API_TOKEN` only turned the 503 into a 401, because the pages
 * have no way to send a token to themselves.
 *
 * Both env vars are set to a reverse-proxied shape here: page reads must
 * resolve through the scene store and must not depend on the deployment
 * reaching itself or on the scene API's caller auth. The store is a stub so
 * this file is independent of the order bun runs it in (`scene-store-server`
 * `mock.module`s the '@pascal-app/mcp/*' subpaths process-wide).
 */

const FIXTURE: SceneWithGraph = {
  id: 'page-data-scene',
  name: 'Page data fixture',
  projectId: null,
  thumbnailUrl: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ownerId: null,
  sizeBytes: 128,
  nodeCount: 2,
  graph: {
    nodes: { n1: { id: 'n1', type: 'qa:box' }, n2: { id: 'n2', type: 'qa:box' } },
    rootNodeIds: ['n1'],
  },
} as SceneWithGraph

const listCalls: unknown[] = []

let listScenesForPage: typeof import('./scene-page-data')['listScenesForPage']
let loadSceneForPage: typeof import('./scene-page-data')['loadSceneForPage']
let restoreEnv: () => void

beforeAll(async () => {
  const saved = {
    PASCAL_SCENE_API_TOKEN: process.env.PASCAL_SCENE_API_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }
  restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  // A reverse-proxied deployment, plus a token the pages cannot send themselves.
  process.env.NEXT_PUBLIC_APP_URL = 'https://pascal.example.com'
  process.env.PASCAL_SCENE_API_TOKEN = 'a-configured-token'

  const operations = {
    listScenes: async (options?: unknown): Promise<SceneMeta[]> => {
      listCalls.push(options)
      const { graph: _graph, ...meta } = FIXTURE
      return [meta]
    },
    loadStoredScene: async (id: string): Promise<SceneWithGraph | null> =>
      id === FIXTURE.id ? FIXTURE : null,
  }

  const storeServer = await import('./scene-store-server')
  storeServer.__resetSceneStoreForTests()
  storeServer.__setSceneStoreForTests({} as SceneStore, operations as never)

  const pageData = await import('./scene-page-data')
  listScenesForPage = pageData.listScenesForPage
  loadSceneForPage = pageData.loadSceneForPage
})

afterAll(async () => {
  const storeServer = await import('./scene-store-server')
  storeServer.__resetSceneStoreForTests()
  restoreEnv()
})

test('the scene list resolves through the store on a non-loopback deployment', async () => {
  const scenes = await listScenesForPage()

  expect(scenes).toHaveLength(1)
  expect(scenes[0]?.id).toBe('page-data-scene')
  expect(scenes[0]?.nodeCount).toBe(2)
  expect(listCalls.at(-1)).toEqual({ limit: 50 })
})

test('a scene page resolves its graph on a non-loopback deployment', async () => {
  const scene = await loadSceneForPage('page-data-scene')

  expect(scene?.name).toBe('Page data fixture')
  expect(Object.keys(scene?.graph.nodes ?? {})).toHaveLength(2)
})

test('an unknown id resolves to null so the page can render its 404', async () => {
  expect(await loadSceneForPage('no-such-scene')).toBeNull()
})
