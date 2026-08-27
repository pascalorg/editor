import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SceneBridge } from '../bridge/scene-bridge'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import { createSceneOperations } from './scene-operations'

function makeGraph(): SceneGraph {
  return {
    nodes: {
      site_abc: {
        object: 'node',
        id: 'site_abc',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
  }
}

describe('SceneOperationsFacade scene events', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-scene-ops-test-'))
    store = new SqliteSceneStore({ databasePath: path.join(rootDir, 'pascal.db') })
  })

  afterEach(async () => {
    store.close()
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  // Regression: appendSceneEvent/listSceneEvents were detached from the store
  // before invocation, so `this` was undefined inside store methods that rely
  // on it (e.g. SqliteSceneStore.withWriteTransaction).
  test('appendSceneEvent and listSceneEvents preserve the store receiver', async () => {
    const operations = createSceneOperations({ store })
    const graph = makeGraph()
    const meta = await store.save({ id: 'live', name: 'Live', graph })

    const appended = await operations.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'save_scene',
      graph,
    })
    expect(appended?.sceneId).toBe(meta.id)

    const events = await operations.listSceneEvents(meta.id)
    expect(events.map((event) => event.kind)).toEqual(['save_scene'])
  })

  test('appendSceneEvent returns null and listSceneEvents throws when the store lacks scene events', async () => {
    const operations = createSceneOperations({
      store: {
        ...store,
        backend: 'sqlite',
        appendSceneEvent: undefined,
        listSceneEvents: undefined,
      } as never,
    })

    expect(
      await operations.appendSceneEvent({
        sceneId: 'live',
        version: 1,
        kind: 'save_scene',
        graph: makeGraph(),
      }),
    ).toBeNull()
    await expect(operations.listSceneEvents('live')).rejects.toThrow('scene_events_unavailable')
  })
})

// `exportSceneGraph` hand-copies fields off `exportJSON`, so a field it omits
// is dropped from everything that persists through it — `save_scene`,
// `publishLiveSceneSnapshot`, and variant generation.
describe('SceneOperationsFacade exportSceneGraph', () => {
  test('carries the material palette off the bridge', () => {
    const bridge = new SceneBridge()
    const materials = { mat_1: { id: 'mat_1', name: 'Oak', material: { preset: 'wood' } } }
    bridge.loadJSON({ ...makeGraph(), materials } as never)
    const operations = createSceneOperations({ bridge })

    expect(operations.exportSceneGraph().materials).toEqual(materials)
  })
})

describe('SceneOperationsFacade presence operations', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-scene-ops-presence-'))
    store = new SqliteSceneStore({ databasePath: path.join(rootDir, 'pascal.db') })
  })

  afterEach(async () => {
    store.close()
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  test('delegates touchScenePresence, transferPresenceEditor, and listScenePresence to store', async () => {
    const operations = createSceneOperations({ store })
    const graph = makeGraph()
    await store.save({ id: 'room-1', name: 'Room 1', graph })

    const claim1 = await operations.touchScenePresence('room-1', 'alice', 'alice@test.com', {
      claimEditor: true,
    })
    expect(claim1.isEditor).toBe(true)

    const claim2 = await operations.touchScenePresence('room-1', 'bob', 'bob@test.com', {
      claimEditor: false,
    })
    expect(claim2.isEditor).toBe(false)

    const transferClaim = await operations.transferPresenceEditor('room-1', 'alice', 'bob')
    expect(transferClaim.isEditor).toBe(false)
    expect(transferClaim.editorUserId).toBe('bob')

    const present = await operations.listScenePresence('room-1')
    expect(present[0]!.userId).toBe('bob')
    expect(present[0]!.isEditor).toBe(true)
  })
})
