/**
 * The `SceneStore` contract, as executable behaviour.
 *
 * Two backends implement this interface and the editor cannot tell them apart —
 * which only holds if something checks. These cases are the single source of
 * truth for what "a scene store" means; a backend-specific test file covers
 * what is genuinely specific to it (a file path, a driver quirk, a corrupt row
 * written behind the store's back).
 *
 * Call `runSceneStoreContract` from the backend's own test file.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { SceneStore } from './types'
import { SceneInvalidError, SceneTooLargeError, SceneVersionConflictError } from './types'

export type ContractStoreOptions = { maxSceneBytes?: number }

export type SceneStoreContractHarness = {
  /** Name of the backend under test, for the describe block. */
  name: string
  /**
   * A store over the *same* underlying data every time it is called. Reopening
   * is how the contract distinguishes "wrote it down" from "kept it in memory".
   */
  create(options?: ContractStoreOptions): Promise<SceneStore> | SceneStore
  /** Wipe the data between cases. */
  reset(): Promise<void> | void
  /** Release the connection a `create()` handed out. */
  release?(store: SceneStore): Promise<void> | void
  /** Tear down whatever `reset` cannot. */
  cleanup?(): Promise<void> | void
}

export function makeContractGraph(overrides: Partial<SceneGraph> = {}): SceneGraph {
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
      building_def: {
        object: 'node',
        id: 'building_def',
        type: 'building',
        parentId: 'site_abc',
        visible: true,
        metadata: {},
      },
    } as unknown as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
    ...overrides,
  }
}

/** Timestamps are ISO strings at millisecond resolution; two saves can share one. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

export function runSceneStoreContract(harness: SceneStoreContractHarness): void {
  describe(`SceneStore contract — ${harness.name}`, () => {
    let store: SceneStore
    const opened: SceneStore[] = []

    const open = async (options?: ContractStoreOptions) => {
      const next = await harness.create(options)
      opened.push(next)
      return next
    }

    beforeEach(async () => {
      await harness.reset()
      opened.length = 0
      store = await open()
    })

    afterEach(async () => {
      for (const instance of opened) await harness.release?.(instance)
      await harness.cleanup?.()
    })

    test('round-trips a saved scene through a fresh connection', async () => {
      const graph = makeContractGraph()
      const saved = await store.save({ id: 'kitchen', name: 'Kitchen', graph })

      expect(saved.id).toBe('kitchen')
      expect(saved.version).toBe(1)
      expect(saved.nodeCount).toBe(2)
      expect(saved.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(graph), 'utf8'))

      const reopened = await open()
      const loaded = await reopened.load('kitchen')
      expect(loaded).not.toBeNull()
      expect(loaded?.graph).toEqual(graph)
      expect(loaded?.name).toBe('Kitchen')
    })

    // Anything the editor persists that is not a node has to survive the trip.
    // A read schema that strips an unnamed key drops it silently, and the save
    // still looks like it worked.
    test('round-trips every scene-side bag the editor persists', async () => {
      const graph = makeContractGraph({
        collections: {
          collection_1: { id: 'collection_1', name: 'Refs', nodeIds: ['site_abc'] },
        } as SceneGraph['collections'],
        savedViews: {
          'saved-view_1': {
            id: 'saved-view_1',
            name: 'Entry',
            order: 0,
            camera: { position: [1, 1, 1], target: [0, 0, 0], projection: 'perspective' },
          },
        } as unknown as SceneGraph['savedViews'],
        comments: {
          comment_1: {
            id: 'comment_1',
            anchor: { position: [1, 0, 2] },
            author: { name: 'Ada' },
            body: 'too thin',
            createdAt: '2026-08-01T09:00:00.000Z',
            replies: [],
          },
        } as unknown as SceneGraph['comments'],
        definitions: {
          definition_1: {
            id: 'definition_1',
            name: 'Building component',
            rootNodeId: 'building_def',
            thumbnail: '/component.png',
          },
        } as SceneGraph['definitions'],
        materials: {
          mat_1: { id: 'mat_1', name: 'Oak', material: { preset: 'wood' } },
        } as SceneGraph['materials'],
        installedPlugins: ['pascal:trees'],
      })
      await store.save({ id: 'full', name: 'Full', graph })

      const reopened = await open()
      expect((await reopened.load('full'))?.graph).toEqual(graph)
    })

    test('stores optional metadata verbatim', async () => {
      await store.save({
        id: 'meta-test',
        name: 'Meta',
        graph: makeContractGraph(),
        projectId: 'proj-1',
        ownerId: 'user-42',
        thumbnailUrl: 'https://example.com/t.png',
      })

      const loaded = await store.load('meta-test')
      expect(loaded?.projectId).toBe('proj-1')
      expect(loaded?.ownerId).toBe('user-42')
      expect(loaded?.thumbnailUrl).toBe('https://example.com/t.png')
    })

    test('generates ids for new scenes and rejects explicit slug collisions', async () => {
      const a = await store.save({ name: 'A', graph: makeContractGraph() })
      const b = await store.save({ name: 'B', graph: makeContractGraph() })
      expect(a.id).not.toBe(b.id)

      await store.save({ id: 'kitchen', name: 'K1', graph: makeContractGraph() })
      await expect(
        store.save({ id: 'kitchen', name: 'K2', graph: makeContractGraph() }),
      ).rejects.toThrow(SceneInvalidError)
    })

    test('sanitizes explicit ids', async () => {
      const meta = await store.save({
        id: '../My Kitchen!',
        name: 'Kitchen',
        graph: makeContractGraph(),
      })
      expect(meta.id).toBe('my-kitchen')
      expect(await store.load('my-kitchen')).not.toBeNull()
    })

    test('increments version and preserves createdAt on overwrite', async () => {
      const first = await store.save({ id: 'bump', name: 'Bump', graph: makeContractGraph() })
      await tick()
      const second = await store.save({
        id: 'bump',
        name: 'Bump 2',
        graph: makeContractGraph(),
        expectedVersion: 1,
      })

      expect(second.version).toBe(2)
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.updatedAt >= first.updatedAt).toBe(true)
    })

    test('enforces optimistic locking for save, rename, and delete', async () => {
      await store.save({ id: 'locked', name: 'Locked', graph: makeContractGraph() })

      await expect(
        store.save({
          id: 'locked',
          name: 'Locked',
          graph: makeContractGraph(),
          expectedVersion: 99,
        }),
      ).rejects.toThrow(SceneVersionConflictError)
      await expect(store.rename('locked', 'New', { expectedVersion: 99 })).rejects.toThrow(
        SceneVersionConflictError,
      )
      await expect(store.delete('locked', { expectedVersion: 99 })).rejects.toThrow(
        SceneVersionConflictError,
      )
    })

    // Two editors autosaving the same scene is the ordinary case, not the edge
    // one. Exactly one of them has to lose, and it has to lose loudly.
    test('two concurrent saves at the same version: exactly one wins', async () => {
      const base = await store.save({ id: 'race', name: 'Race', graph: makeContractGraph() })
      const other = await open()

      const results = await Promise.allSettled([
        store.save({
          id: 'race',
          name: 'A',
          graph: makeContractGraph(),
          expectedVersion: base.version,
        }),
        other.save({
          id: 'race',
          name: 'B',
          graph: makeContractGraph(),
          expectedVersion: base.version,
        }),
      ])

      const won = results.filter((result) => result.status === 'fulfilled')
      const lost = results.filter((result) => result.status === 'rejected')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(SceneVersionConflictError)
      expect((await store.load('race'))?.version).toBe(base.version + 1)
    })

    test('expectedVersion=0 creates a brand-new explicit id', async () => {
      const meta = await store.save({
        id: 'fresh',
        name: 'Fresh',
        graph: makeContractGraph(),
        expectedVersion: 0,
      })
      expect(meta.version).toBe(1)
    })

    test('lists newest first and supports project, owner, and limit filters', async () => {
      const graph = makeContractGraph()
      await store.save({ id: 'a', name: 'A', graph, projectId: 'p1', ownerId: 'u1' })
      await tick()
      await store.save({ id: 'b', name: 'B', graph, projectId: 'p2', ownerId: 'u1' })
      await tick()
      await store.save({ id: 'c', name: 'C', graph, projectId: 'p1', ownerId: 'u2' })

      expect((await store.list()).map((m) => m.id)).toEqual(['c', 'b', 'a'])
      expect((await store.list({ projectId: 'p1' })).map((m) => m.id)).toEqual(['c', 'a'])
      expect((await store.list({ ownerId: 'u1' })).map((m) => m.id)).toEqual(['b', 'a'])
      expect((await store.list({ limit: 2 })).map((m) => m.id)).toEqual(['c', 'b'])
    })

    test('rename bumps the version and delete removes the scene', async () => {
      await store.save({ id: 'rev', name: 'Rev', graph: makeContractGraph() })
      const renamed = await store.rename('rev', 'Renamed', { expectedVersion: 1 })
      expect(renamed.name).toBe('Renamed')
      expect(renamed.version).toBe(2)

      expect(await store.delete('rev', { expectedVersion: 2 })).toBe(true)
      expect(await store.load('rev')).toBeNull()
      expect(await store.delete('rev')).toBe(false)
    })

    test('appends and lists scene events in order', async () => {
      const graph = makeContractGraph()
      const meta = await store.save({ id: 'live', name: 'Live', graph })
      const first = await store.appendSceneEvent?.({
        sceneId: meta.id,
        version: meta.version,
        kind: 'save_scene',
      })
      const second = await store.appendSceneEvent?.({
        sceneId: meta.id,
        version: meta.version,
        kind: 'create_wall',
      })

      expect(second?.eventId).toBeGreaterThan(first?.eventId ?? 0)
      expect((await store.listSceneEvents?.('live'))?.map((event) => event.kind)).toEqual([
        'save_scene',
        'create_wall',
      ])
      const afterFirst = await store.listSceneEvents?.('live', { afterEventId: first?.eventId })
      expect(afterFirst).toHaveLength(1)
      expect(afterFirst?.[0]?.eventId).toBe(second?.eventId as number)
    })

    test('an event carries a version, never the graph', async () => {
      const meta = await store.save({ id: 'notify', name: 'Notify', graph: makeContractGraph() })
      const appended = await store.appendSceneEvent?.({
        sceneId: meta.id,
        version: meta.version,
        kind: 'save_scene',
      })

      // The property is gone from the type; this is the runtime half, because
      // a store that still selected the column would satisfy the compiler and
      // put a scene-sized payload on every subscriber's connection anyway.
      expect(appended).not.toHaveProperty('graph')
      const listed = await store.listSceneEvents?.('notify')
      expect(listed?.[0]).not.toHaveProperty('graph')
      expect(listed?.[0]?.version).toBe(meta.version)
    })

    test('deleting a scene takes its events with it', async () => {
      const graph = makeContractGraph()
      const meta = await store.save({ id: 'cascade', name: 'Cascade', graph })
      await store.appendSceneEvent?.({
        sceneId: meta.id,
        version: meta.version,
        kind: 'save_scene',
      })
      expect(await store.listSceneEvents?.('cascade')).toHaveLength(1)

      await store.delete('cascade', { expectedVersion: meta.version })
      expect(await store.listSceneEvents?.('cascade')).toHaveLength(0)
    })

    /**
     * The point of the draft/checkpoint split, stated as something observable
     * through the interface: run a prune to get to a known floor, write more,
     * prune again on the same policy. Drafts leave nothing new to collect;
     * checkpoints leave one each. Row counts are a backend's own business —
     * SQLite keeps the body in the scene row and Postgres keeps it in the
     * version row — but "does editing accumulate history" has to be the same.
     */
    const saveRepeatedly = async (id: string, mode: 'draft' | 'checkpoint', times: number) => {
      let version = (await store.load(id))?.version ?? 0
      for (let i = 0; i < times; i += 1) {
        version = (
          await store.save({
            id,
            name: id,
            graph: makeContractGraph(),
            expectedVersion: version,
            saveMode: mode,
          })
        ).version
      }
      return version
    }

    const KEEP_ONE = { keepCheckpoints: 1, keepDays: 0, keepEvents: 0 } as const

    test('drafts do not accumulate history', async () => {
      const graph = makeContractGraph()
      await store.save({ id: 'drafty', name: 'drafty', graph })
      await saveRepeatedly('drafty', 'draft', 5)
      await store.pruneSceneHistory?.('drafty', KEEP_ONE)

      const version = await saveRepeatedly('drafty', 'draft', 5)
      const pruned = await store.pruneSceneHistory?.('drafty', KEEP_ONE)

      expect(pruned?.revisionsDeleted).toBe(0)
      // Every one of those drafts is still what the scene loads as.
      expect((await store.load('drafty'))?.version).toBe(version)
      expect((await store.load('drafty'))?.graph.rootNodeIds).toEqual(graph.rootNodeIds)
    })

    test('checkpoints accumulate history, and pruning collects it', async () => {
      const graph = makeContractGraph()
      await store.save({ id: 'kept', name: 'kept', graph })
      await saveRepeatedly('kept', 'checkpoint', 5)
      await store.pruneSceneHistory?.('kept', KEEP_ONE)

      const version = await saveRepeatedly('kept', 'checkpoint', 5)
      const pruned = await store.pruneSceneHistory?.('kept', KEEP_ONE)

      expect(pruned?.revisionsDeleted).toBeGreaterThan(0)
      // Pruning never takes the version the scene currently points at.
      expect((await store.load('kept'))?.version).toBe(version)
      expect((await store.load('kept'))?.graph.rootNodeIds).toEqual(graph.rootNodeIds)
    })

    test('the retention window keeps one row a day, not every row', async () => {
      const graph = makeContractGraph()
      await store.save({ id: 'daily', name: 'daily', graph })
      const version = await saveRepeatedly('daily', 'checkpoint', 12)

      // Every row here landed within seconds of the others, so they all sit
      // inside the window. Keeping one per day plus the newest two leaves the
      // rest collectable — the bug this pins let a week of five-minute
      // checkpoints accumulate untouched because they were all "recent".
      const pruned = await store.pruneSceneHistory?.('daily', {
        keepCheckpoints: 2,
        keepDays: 7,
        keepEvents: 0,
      })

      expect(pruned?.revisionsDeleted).toBeGreaterThan(5)
      expect((await store.load('daily'))?.version).toBe(version)
    })

    test('pruning keeps the newest events and drops the rest', async () => {
      const meta = await store.save({ id: 'feed', name: 'Feed', graph: makeContractGraph() })
      for (let i = 0; i < 6; i += 1) {
        await store.appendSceneEvent?.({
          sceneId: meta.id,
          version: meta.version,
          kind: `edit_${i}`,
        })
      }

      const pruned = await store.pruneSceneHistory?.('feed', { keepEvents: 2 })
      expect(pruned?.eventsDeleted).toBe(4)
      expect((await store.listSceneEvents?.('feed'))?.map((event) => event.kind)).toEqual([
        'edit_4',
        'edit_5',
      ])
    })

    test('validates the name', async () => {
      await expect(store.save({ name: '', graph: makeContractGraph() })).rejects.toThrow(
        SceneInvalidError,
      )
      await expect(
        store.save({ name: 'x'.repeat(201), graph: makeContractGraph() }),
      ).rejects.toThrow(SceneInvalidError)
    })

    test('refuses a scene past the size cap', async () => {
      const tiny = await open({ maxSceneBytes: 100 })
      await expect(
        tiny.save({ id: 'big', name: 'Big', graph: makeContractGraph() }),
      ).rejects.toThrow(SceneTooLargeError)
    })

    test('load returns null for a scene that is not there', async () => {
      expect(await store.load('missing')).toBeNull()
    })
  })
}
