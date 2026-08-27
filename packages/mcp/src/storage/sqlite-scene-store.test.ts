import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  resolveDefaultDatabasePath,
  SqliteSceneStore,
  type SqliteSceneStoreOptions,
} from './sqlite-scene-store'
import { SceneInvalidError, SceneTooLargeError, SceneVersionConflictError } from './types'

function makeGraph(overrides: Partial<SceneGraph> = {}): SceneGraph {
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
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
    ...overrides,
  }
}

async function mkTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pascal-sqlite-test-'))
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

function createStore(rootDir: string, opts: Partial<SqliteSceneStoreOptions> = {}) {
  return new SqliteSceneStore({
    databasePath: path.join(rootDir, 'pascal.db'),
    ...opts,
  })
}

describe('resolveDefaultDatabasePath', () => {
  test('respects DIGITALTWIN_DB_PATH when set', () => {
    expect(resolveDefaultDatabasePath({ DIGITALTWIN_DB_PATH: '/tmp/custom.db' })).toBe(
      '/tmp/custom.db',
    )
  })

  test('resolves DIGITALTWIN_DATA_DIR to pascal.db', () => {
    expect(resolveDefaultDatabasePath({ DIGITALTWIN_DATA_DIR: '/tmp/pascal-data' })).toBe(
      path.join('/tmp/pascal-data', 'pascal.db'),
    )
  })

  test('falls back to XDG_DATA_HOME on Unix', () => {
    if (process.platform === 'win32') return
    expect(resolveDefaultDatabasePath({ XDG_DATA_HOME: '/xdg/share' })).toBe(
      path.join('/xdg/share', 'pascal', 'data', 'pascal.db'),
    )
  })

  test('falls back to homedir + .pascal/data/pascal.db', () => {
    if (process.platform === 'win32') return
    expect(resolveDefaultDatabasePath({}).endsWith(path.join('.pascal', 'data', 'pascal.db'))).toBe(
      true,
    )
  })
})

describe('SqliteSceneStore', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('backend is "sqlite"', () => {
    expect(store.backend).toBe('sqlite')
  })

  test('round-trips a saved scene through a reopened database', async () => {
    const graph = makeGraph()
    const saved = await store.save({ id: 'kitchen', name: 'Kitchen', graph })

    expect(saved.id).toBe('kitchen')
    expect(saved.version).toBe(1)
    expect(saved.nodeCount).toBe(2)
    expect(saved.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(graph), 'utf8'))

    store.close()
    store = createStore(rootDir)

    const loaded = await store.load('kitchen')
    expect(loaded).not.toBeNull()
    expect(loaded!.graph).toEqual(graph)
    expect(loaded!.name).toBe('Kitchen')
  })

  // `GraphSchema` strips any key it doesn't name, so a field missing from it
  // is dropped on load without an error — the save looks like it worked.
  test('round-trips collections, materials and installed plugins', async () => {
    const graph = makeGraph({
      collections: {
        collection_1: { id: 'collection_1', name: 'Refs', nodeIds: ['site_abc'] },
      } as SceneGraph['collections'],
      materials: {
        mat_1: { id: 'mat_1', name: 'Oak', material: { preset: 'wood' } },
      } as SceneGraph['materials'],
      installedPlugins: ['pascal:trees'],
    })
    await store.save({ id: 'full', name: 'Full', graph })

    store.close()
    store = createStore(rootDir)

    expect((await store.load('full'))?.graph).toEqual(graph)
  })

  // Nothing validates a graph on the way in, and `parseGraph` throws on a
  // shape mismatch, so a strict read schema would make an odd stored value
  // permanently unloadable rather than merely odd.
  test('loads a stored scene whose material does not match the strict schema', async () => {
    const graph = makeGraph({
      materials: {
        mat_1: { id: 'mat_1', material: { texture: { url: 'ftp://host/a.png' } } },
      } as unknown as SceneGraph['materials'],
    })
    await store.save({ id: 'odd', name: 'Odd', graph })

    expect((await store.load('odd'))?.graph).toEqual(graph)
  })

  test('stores optional metadata verbatim', async () => {
    await store.save({
      id: 'meta-test',
      name: 'Meta',
      graph: makeGraph(),
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
    const a = await store.save({ name: 'A', graph: makeGraph() })
    const b = await store.save({ name: 'B', graph: makeGraph() })
    expect(a.id).not.toBe(b.id)

    await store.save({ id: 'kitchen', name: 'K1', graph: makeGraph() })
    await expect(store.save({ id: 'kitchen', name: 'K2', graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  test('sanitizes explicit ids', async () => {
    const meta = await store.save({ id: '../My Kitchen!', name: 'Kitchen', graph: makeGraph() })
    expect(meta.id).toBe('my-kitchen')
    expect(await store.load('my-kitchen')).not.toBeNull()
  })

  test('increments version and preserves createdAt on overwrite', async () => {
    const first = await store.save({ id: 'bump', name: 'Bump', graph: makeGraph() })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await store.save({
      id: 'bump',
      name: 'Bump 2',
      graph: makeGraph(),
      expectedVersion: 1,
    })

    expect(second.version).toBe(2)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
  })

  test('enforces optimistic locking for save, rename, and delete', async () => {
    await store.save({ id: 'locked', name: 'Locked', graph: makeGraph() })

    await expect(
      store.save({ id: 'locked', name: 'Locked', graph: makeGraph(), expectedVersion: 99 }),
    ).rejects.toThrow(SceneVersionConflictError)
    await expect(store.rename('locked', 'New', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
    await expect(store.delete('locked', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
  })

  test('expectedVersion=0 creates a brand-new explicit id', async () => {
    const meta = await store.save({
      id: 'fresh',
      name: 'Fresh',
      graph: makeGraph(),
      expectedVersion: 0,
    })
    expect(meta.version).toBe(1)
  })

  test('lists newest first and supports project, owner, and limit filters', async () => {
    await store.save({ id: 'a', name: 'A', graph: makeGraph(), projectId: 'p1', ownerId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.save({ id: 'b', name: 'B', graph: makeGraph(), projectId: 'p2', ownerId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.save({ id: 'c', name: 'C', graph: makeGraph(), projectId: 'p1', ownerId: 'u2' })

    expect((await store.list()).map((m) => m.id)).toEqual(['c', 'b', 'a'])
    expect((await store.list({ projectId: 'p1' })).map((m) => m.id)).toEqual(['c', 'a'])
    expect((await store.list({ ownerId: 'u1' })).map((m) => m.id)).toEqual(['b', 'a'])
    expect((await store.list({ limit: 2 })).map((m) => m.id)).toEqual(['c', 'b'])
  })

  test('rename writes a revision row and delete cascades revisions', async () => {
    await store.save({ id: 'rev', name: 'Rev', graph: makeGraph() })
    await store.rename('rev', 'Renamed', { expectedVersion: 1 })

    const dbPath = path.join(rootDir, 'pascal.db')
    const db = new Database(dbPath)
    try {
      const beforeDelete = db
        .query('SELECT COUNT(*) AS count FROM scene_revisions WHERE scene_id = ?')
        .get('rev') as { count: number }
      expect(beforeDelete.count).toBe(2)
    } finally {
      db.close()
    }

    expect(await store.delete('rev', { expectedVersion: 2 })).toBe(true)

    const reopened = new Database(dbPath)
    try {
      const afterDelete = reopened
        .query('SELECT COUNT(*) AS count FROM scene_revisions WHERE scene_id = ?')
        .get('rev') as { count: number }
      expect(afterDelete.count).toBe(0)
    } finally {
      reopened.close()
    }
  })

  /**
   * GUARD: revision history is a rolling window, not a growing log.
   *
   * A revision row carries the WHOLE graph and one was written on every save —
   * autosave included, which fires on a debounce while you draw. Nothing pruned
   * them and nothing in the application reads them. In production that table
   * reached 3.1 GiB over 2 256 rows, filled the database's quota, and the host
   * answered by refusing DDL; the app self-migrates at boot, so the entire site
   * went to 503 over a write-only table.
   *
   * The assertion is not "some rows were deleted" — it is WHICH rows survive.
   * A prune that kept the OLDEST five would also shrink the table, and would
   * also pass a count-only test, while throwing away every recent version.
   */
  test('keeps only the newest five revisions, evicting the oldest', async () => {
    await store.save({ id: 'roll', name: 'Roll', graph: makeGraph() })
    for (let version = 1; version <= 9; version += 1) {
      await store.rename('roll', `Roll ${version}`, { expectedVersion: version })
    }

    const db = new Database(path.join(rootDir, 'pascal.db'))
    try {
      const kept = db
        .query('SELECT version FROM scene_revisions WHERE scene_id = ? ORDER BY version')
        .all('roll') as Array<{ version: number }>

      // Ten saves in total; versions 1–5 are gone, 6–10 remain.
      expect(kept.map((row) => row.version)).toEqual([6, 7, 8, 9, 10])
    } finally {
      db.close()
    }
  })

  /**
   * The window is per scene. A shared cutoff would let a busy scene evict a
   * quiet one's entire history — the quiet scene would silently lose every
   * version it had without anyone touching it.
   */
  test('the window is counted per scene', async () => {
    await store.save({ id: 'busy', name: 'Busy', graph: makeGraph() })
    await store.save({ id: 'quiet', name: 'Quiet', graph: makeGraph() })
    for (let version = 1; version <= 9; version += 1) {
      await store.rename('busy', `Busy ${version}`, { expectedVersion: version })
    }

    const db = new Database(path.join(rootDir, 'pascal.db'))
    try {
      const count = (id: string) =>
        (
          db.query('SELECT COUNT(*) AS count FROM scene_revisions WHERE scene_id = ?').get(id) as {
            count: number
          }
        ).count

      expect(count('busy')).toBe(5)
      expect(count('quiet')).toBe(1)
    } finally {
      db.close()
    }
  })

  /**
   * GUARD: the live-sync log is a window, not a log.
   *
   * `scene_events` has the same shape as the revisions table — a whole graph
   * per row — but unlike revisions something reads it: the SSE route polls
   * `afterEventId` every 250 ms. So it cannot simply be dropped, only bounded.
   *
   * Ten is safe precisely because every event carries the entire graph: a
   * client that misses events does not desynchronise, the next event it
   * receives replaces its scene wholesale. The window only has to span the gap
   * between polls.
   *
   * Which ten survive is the whole assertion. Keeping the OLDEST ten would
   * shrink the table just as well and pass a count-only test, while feeding
   * every client a scene from minutes ago — live sync would run backwards.
   */
  test('keeps only the newest ten live-sync events', async () => {
    const graph = makeGraph()
    const meta = await store.save({ id: 'stream', name: 'Stream', graph })

    const appended: number[] = []
    for (let i = 0; i < 14; i += 1) {
      const event = await store.appendSceneEvent({
        sceneId: meta.id,
        version: meta.version,
        kind: 'save_scene',
        graph,
      })
      appended.push(event.eventId)
    }

    const db = new Database(path.join(rootDir, 'pascal.db'))
    try {
      const kept = (
        db
          .query('SELECT event_id FROM scene_events WHERE scene_id = ? ORDER BY event_id')
          .all('stream') as Array<{ event_id: number }>
      ).map((row) => Number(row.event_id))

      expect(kept).toEqual(appended.slice(-10))
    } finally {
      db.close()
    }
  })

  test('appends and lists scene events in order', async () => {
    const graph = makeGraph()
    const meta = await store.save({ id: 'live', name: 'Live', graph })
    const first = await store.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'save_scene',
      graph,
    })
    const updatedGraph = makeGraph({
      nodes: {
        ...graph.nodes,
        wall_new: {
          object: 'node',
          id: 'wall_new',
          type: 'wall',
          parentId: 'building_def',
          visible: true,
          metadata: {},
          children: [],
          start: [0, 0],
          end: [1, 0],
          thickness: 0.1,
          height: 2.5,
          frontSide: 'unknown',
          backSide: 'unknown',
        },
      } as SceneGraph['nodes'],
    })
    const second = await store.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'create_wall',
      graph: updatedGraph,
    })

    expect(second.eventId).toBeGreaterThan(first.eventId)
    expect((await store.listSceneEvents('live')).map((event) => event.kind)).toEqual([
      'save_scene',
      'create_wall',
    ])
    const afterFirst = await store.listSceneEvents('live', { afterEventId: first.eventId })
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]!.eventId).toBe(second.eventId)
    expect(afterFirst[0]!.graph.nodes.wall_new).toBeDefined()
  })

  test('validates name and scene size', async () => {
    await expect(store.save({ name: '', graph: makeGraph() })).rejects.toThrow(SceneInvalidError)
    await expect(store.save({ name: 'x'.repeat(201), graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )

    const tinyStore = createStore(rootDir, {
      databasePath: path.join(rootDir, 'tiny.db'),
      maxSceneBytes: 100,
    })
    try {
      await expect(tinyStore.save({ id: 'big', name: 'Big', graph: makeGraph() })).rejects.toThrow(
        SceneTooLargeError,
      )
    } finally {
      tinyStore.close()
    }
  })

  test('load returns null for missing scenes and errors on corrupt graph rows', async () => {
    expect(await store.load('missing')).toBeNull()

    const db = new Database(path.join(rootDir, 'pascal.db'), { create: true })
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scenes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_id TEXT,
          owner_id TEXT,
          thumbnail_url TEXT,
          version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          node_count INTEGER NOT NULL,
          graph_json TEXT NOT NULL
        );
      `)
      db.query(
        `INSERT INTO scenes (
           id, name, version, created_at, updated_at, size_bytes, node_count, graph_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('bad', 'Bad', 1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 2, 0, '{}')
    } finally {
      db.close()
    }

    await expect(store.load('bad')).rejects.toThrow(SceneInvalidError)
  })
})

describe('SqliteSceneStore scene sharing', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('setSceneShares replaces the whole set; roles round-trip', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'owner1', graph: makeGraph() })

    await store.setSceneShares('proj', [
      { userId: 'ann', role: 'viewer' },
      { userId: 'bob', role: 'editor' },
    ])
    expect(await store.listSceneShares('proj')).toEqual([
      { userId: 'ann', role: 'viewer' },
      { userId: 'bob', role: 'editor' },
    ])

    // A second call fully replaces — ann is dropped, bob is downgraded.
    await store.setSceneShares('proj', [{ userId: 'bob', role: 'viewer' }])
    expect(await store.listSceneShares('proj')).toEqual([{ userId: 'bob', role: 'viewer' }])
    expect(await store.getSceneShareRole('proj', 'ann')).toBeNull()
    expect(await store.getSceneShareRole('proj', 'bob')).toBe('viewer')
  })

  test('viewerId lists owned AND shared scenes, never unrelated ones', async () => {
    await store.save({ id: 'mine', name: 'Mine', ownerId: 'me', graph: makeGraph() })
    await store.save({ id: 'shared', name: 'Shared', ownerId: 'other', graph: makeGraph() })
    await store.save({ id: 'private', name: 'Private', ownerId: 'other', graph: makeGraph() })
    await store.setSceneShares('shared', [{ userId: 'me', role: 'editor' }])

    const ids = (await store.list({ viewerId: 'me' })).map((s) => s.id).sort()
    expect(ids).toEqual(['mine', 'shared'])
    // `private` is owned by other and not shared with me — it must not leak.
    expect(ids).not.toContain('private')
  })

  test('ownerId filter still returns owned-only (admin/console path)', async () => {
    await store.save({ id: 'mine', name: 'Mine', ownerId: 'me', graph: makeGraph() })
    await store.save({ id: 'shared', name: 'Shared', ownerId: 'other', graph: makeGraph() })
    await store.setSceneShares('shared', [{ userId: 'me', role: 'editor' }])

    const ids = (await store.list({ ownerId: 'me' })).map((s) => s.id)
    expect(ids).toEqual(['mine'])
  })

  test('deleting a scene cascades its shares away', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'owner1', graph: makeGraph() })
    await store.setSceneShares('proj', [{ userId: 'ann', role: 'viewer' }])
    await store.delete('proj')
    expect(await store.listSceneShares('proj')).toEqual([])
  })
})

describe('SqliteSceneStore revisions and thumbnail', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('checkpoint saves accumulate restorable revisions', async () => {
    const v1 = await store.save({
      id: 'proj',
      name: 'Proj',
      graph: makeGraph(),
      saveMode: 'checkpoint',
    })
    await store.save({
      id: 'proj',
      name: 'Proj',
      graph: makeGraph(),
      saveMode: 'checkpoint',
      expectedVersion: v1.version,
    })

    const revs = await store.listSceneRevisions('proj')
    expect(revs.length).toBeGreaterThanOrEqual(2)
    // Newest first, and each carries a usable node count.
    expect(revs[0]!.version).toBeGreaterThan(revs[1]!.version)
    expect(revs[0]!.nodeCount).toBe(2)

    const graph = await store.loadSceneRevision('proj', revs[revs.length - 1]!.version)
    expect(graph).not.toBeNull()
    expect(Object.keys(graph!.nodes).length).toBe(2)
    expect(await store.loadSceneRevision('proj', 9999)).toBeNull()
  })

  test('updateThumbnail sets the preview without bumping the version', async () => {
    const saved = await store.save({ id: 'proj', name: 'Proj', graph: makeGraph() })
    await store.updateThumbnail('proj', 'data:image/jpeg;base64,AAAA')

    const loaded = await store.load('proj')
    expect(loaded!.thumbnailUrl).toBe('data:image/jpeg;base64,AAAA')
    expect(loaded!.version).toBe(saved.version)
  })
})

describe('SqliteSceneStore presence + edit lease', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('first claimant holds the lease; a concurrent claimant is a viewer', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })

    const a = await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    expect(a.isEditor).toBe(true)
    expect(a.editorUserId).toBe('ann')

    // Bob opens while Ann is fresh — forced viewer, told who holds it.
    const b = await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: true })
    expect(b.isEditor).toBe(false)
    expect(b.editorUserId).toBe('ann')
    expect(b.editorEmail).toBe('ann@x')

    // Ann heartbeats — still the editor.
    const a2 = await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    expect(a2.isEditor).toBe(true)

    // A non-editing viewer (claimEditor:false) never becomes editor.
    const c = await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })
    expect(c.isEditor).toBe(false)
    expect(c.editorUserId).toBe('ann')
  })

  test('listScenePresence returns everyone fresh, editor first', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: true })

    const present = await store.listScenePresence('proj')
    expect(present.map((p) => p.userId).sort()).toEqual(['ann', 'bob'])
    expect(present[0]!.isEditor).toBe(true)
    expect(present[0]!.userId).toBe('ann')
    expect(present.find((p) => p.userId === 'bob')!.isEditor).toBe(false)
  })

  test('releasing the editor frees the lease for the next claimant', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    const bBefore = await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: true })
    expect(bBefore.isEditor).toBe(false)

    await store.releaseScenePresence('proj', 'ann')

    // Now Bob's next heartbeat (still wanting to edit) takes the lease.
    const bAfter = await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: true })
    expect(bAfter.isEditor).toBe(true)
    expect(bAfter.editorUserId).toBe('bob')

    const present = await store.listScenePresence('proj')
    expect(present.map((p) => p.userId)).toEqual(['bob'])
  })

  // ── Tier 1: Feature Coverage (R3 Backend) ──────────────────────────────────
  test('transferPresenceEditor atomically hands off the edit lease to a present viewer', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })

    const claim = await store.transferPresenceEditor('proj', 'ann', 'bob')
    expect(claim.isEditor).toBe(false)
    expect(claim.editorUserId).toBe('bob')
    expect(claim.editorEmail).toBe('bob@x')

    const present = await store.listScenePresence('proj')
    expect(present[0]!.userId).toBe('bob')
    expect(present[0]!.isEditor).toBe(true)
    expect(present[1]!.userId).toBe('ann')
    expect(present[1]!.isEditor).toBe(false)
  })

  test('listScenePresence reflects transferred editor at index 0 and former editor as viewer', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })
    await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })

    await store.transferPresenceEditor('proj', 'ann', 'bob')

    const present = await store.listScenePresence('proj')
    expect(present.length).toBe(3)
    expect(present[0]!.userId).toBe('bob')
    expect(present[0]!.isEditor).toBe(true)
    expect(present.filter((p) => !p.isEditor).map((p) => p.userId).sort()).toEqual(['ann', 'cy'])
  })

  test('new editor retains lease on subsequent heartbeat with claimEditor: true', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })

    await store.transferPresenceEditor('proj', 'ann', 'bob')

    const bobHeartbeat = await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: true })
    expect(bobHeartbeat.isEditor).toBe(true)
    expect(bobHeartbeat.editorUserId).toBe('bob')
    expect(bobHeartbeat.editorEmail).toBe('bob@x')
  })

  test('former editor is rejected as editor on subsequent heartbeat while new editor holds lease', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })

    await store.transferPresenceEditor('proj', 'ann', 'bob')

    const annHeartbeat = await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    expect(annHeartbeat.isEditor).toBe(false)
    expect(annHeartbeat.editorUserId).toBe('bob')
    expect(annHeartbeat.editorEmail).toBe('bob@x')
  })

  test('atomic transaction guarantees single editor invariant across lease transfer', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })

    await store.transferPresenceEditor('proj', 'ann', 'bob')

    const present = await store.listScenePresence('proj')
    const editors = present.filter((p) => p.isEditor)
    expect(editors.length).toBe(1)
    expect(editors[0]!.userId).toBe('bob')
  })

  // ── Tier 2: Boundary & Corner Cases (R3 Backend) ───────────────────────────
  test('transferPresenceEditor fails if fromUserId is not the current editor', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })
    await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })

    // Bob (viewer) tries to transfer to Cy
    const claim = await store.transferPresenceEditor('proj', 'bob', 'cy')
    expect(claim.isEditor).toBe(false)
    expect(claim.editorUserId).toBe('ann')

    // Ann remains editor
    const present = await store.listScenePresence('proj')
    expect(present[0]!.userId).toBe('ann')
    expect(present[0]!.isEditor).toBe(true)
    expect(present.find((p) => p.userId === 'cy')!.isEditor).toBe(false)
  })

  test('transferPresenceEditor retains current editor if target user is not present', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })

    const claim = await store.transferPresenceEditor('proj', 'ann', 'nonexistent_user')
    expect(claim.isEditor).toBe(true)
    expect(claim.editorUserId).toBe('ann')

    const present = await store.listScenePresence('proj')
    expect(present).toHaveLength(1)
    expect(present[0]!.userId).toBe('ann')
    expect(present[0]!.isEditor).toBe(true)
  })

  test('transferPresenceEditor handles same user fromUserId === toUserId as a no-op', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })

    const claim = await store.transferPresenceEditor('proj', 'ann', 'ann')
    expect(claim.isEditor).toBe(true)
    expect(claim.editorUserId).toBe('ann')

    const present = await store.listScenePresence('proj')
    expect(present[0]!.userId).toBe('ann')
    expect(present[0]!.isEditor).toBe(true)
  })

  test('transferPresenceEditor on non-existent scene returns empty claim without error', async () => {
    const claim = await store.transferPresenceEditor('missing-scene-xyz', 'ann', 'bob')
    expect(claim.isEditor).toBe(false)
    expect(claim.editorUserId).toBeNull()
    expect(claim.editorEmail).toBeNull()
  })

  test('transferPresenceEditor prunes expired target rows and rejects transfer to stale user', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })

    // Simulate an ancient presence row for dave by direct insert
    const db = await (store as unknown as { database: () => Promise<Database> }).database()
    const ancient = new Date(Date.now() - 3600_000).toISOString()
    db.query(
      'INSERT INTO scene_presence (scene_id, user_id, email, last_seen, is_editor) VALUES (?, ?, ?, ?, ?)',
    ).run('proj', 'dave', 'dave@x', ancient, 0)

    // Attempt transfer to expired dave
    const claim = await store.transferPresenceEditor('proj', 'ann', 'dave')
    expect(claim.isEditor).toBe(true)
    expect(claim.editorUserId).toBe('ann')

    // Dave should have been pruned by cutoff
    const present = await store.listScenePresence('proj')
    expect(present.find((p) => p.userId === 'dave')).toBeUndefined()
  })

  // ── Tier 3: Cross-Feature Combinations (R3 Backend) ────────────────────────
  test('rapid sequential role transfers A -> B -> C preserve atomic consistency', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })
    await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })

    // Step 1: Ann transfers to Bob
    const claim1 = await store.transferPresenceEditor('proj', 'ann', 'bob')
    expect(claim1.editorUserId).toBe('bob')

    // Step 2: Bob transfers to Cy
    const claim2 = await store.transferPresenceEditor('proj', 'bob', 'cy')
    expect(claim2.editorUserId).toBe('cy')

    // Step 3: Verify final presence state
    const present = await store.listScenePresence('proj')
    expect(present[0]!.userId).toBe('cy')
    expect(present[0]!.isEditor).toBe(true)
    expect(present.find((p) => p.userId === 'ann')!.isEditor).toBe(false)
    expect(present.find((p) => p.userId === 'bob')!.isEditor).toBe(false)
  })

  test('transfer with multiple concurrent viewers leaves unselected viewers unaffected', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })
    await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })
    await store.touchPresence('proj', 'dan', 'dan@x', { claimEditor: false })

    await store.transferPresenceEditor('proj', 'ann', 'bob')

    const present = await store.listScenePresence('proj')
    expect(present.find((p) => p.userId === 'bob')!.isEditor).toBe(true)
    expect(present.find((p) => p.userId === 'ann')!.isEditor).toBe(false)
    expect(present.find((p) => p.userId === 'cy')!.isEditor).toBe(false)
    expect(present.find((p) => p.userId === 'dan')!.isEditor).toBe(false)
  })

  test('releasing editor after transfer allows remaining viewer to claim the vacant lease', async () => {
    await store.save({ id: 'proj', name: 'Proj', ownerId: 'ann', graph: makeGraph() })
    await store.touchPresence('proj', 'ann', 'ann@x', { claimEditor: true })
    await store.touchPresence('proj', 'bob', 'bob@x', { claimEditor: false })
    await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: false })

    // Ann transfers to Bob
    await store.transferPresenceEditor('proj', 'ann', 'bob')

    // Bob leaves and releases presence
    await store.releaseScenePresence('proj', 'bob')

    // Cy heartbeats requesting editor lease
    const cyClaim = await store.touchPresence('proj', 'cy', 'cy@x', { claimEditor: true })
    expect(cyClaim.isEditor).toBe(true)
    expect(cyClaim.editorUserId).toBe('cy')
  })

  // ── Tier 4: Real-World Scenarios (R3 Backend) ──────────────────────────────
  test('full collaborative editing lifecycle: join -> transfer -> edit -> depart -> recover', async () => {
    await store.save({ id: 'team-scene', name: 'Team Scene', ownerId: 'alice', graph: makeGraph() })

    // Phase 1: Alice joins and becomes editor
    const p1 = await store.touchPresence('team-scene', 'alice', 'alice@test.com', { claimEditor: true })
    expect(p1.isEditor).toBe(true)

    // Phase 2: Bob and Charlie join as viewers
    const p2Bob = await store.touchPresence('team-scene', 'bob', 'bob@test.com', { claimEditor: false })
    const p2Charlie = await store.touchPresence('team-scene', 'charlie', 'charlie@test.com', { claimEditor: false })
    expect(p2Bob.isEditor).toBe(false)
    expect(p2Charlie.isEditor).toBe(false)

    // Phase 3: Alice passes control to Bob
    const handoff = await store.transferPresenceEditor('team-scene', 'alice', 'bob')
    expect(handoff.editorUserId).toBe('bob')

    // Phase 4: Bob heartbeats and edits
    const bobActive = await store.touchPresence('team-scene', 'bob', 'bob@test.com', { claimEditor: true })
    expect(bobActive.isEditor).toBe(true)

    // Phase 5: Bob departs cleanly
    await store.releaseScenePresence('team-scene', 'bob')

    // Phase 6: Alice reclaims editor role
    const aliceRecover = await store.touchPresence('team-scene', 'alice', 'alice@test.com', { claimEditor: true })
    expect(aliceRecover.isEditor).toBe(true)
    expect(aliceRecover.editorUserId).toBe('alice')
  })

  test('interleaved sequential heartbeats and transfer attempts maintain strict consistency', async () => {
    await store.save({ id: 'stress-scene', name: 'Stress Scene', ownerId: 'user1', graph: makeGraph() })
    await store.touchPresence('stress-scene', 'user1', 'u1@x', { claimEditor: true })
    await store.touchPresence('stress-scene', 'user2', 'u2@x', { claimEditor: false })

    // Interleaved sequence: transfer from user1 to user2, user1 heartbeat as viewer, user2 heartbeat as editor
    const tRes = await store.transferPresenceEditor('stress-scene', 'user1', 'user2')
    expect(tRes.editorUserId).toBe('user2')

    const hb1 = await store.touchPresence('stress-scene', 'user1', 'u1@x', { claimEditor: false })
    expect(hb1.isEditor).toBe(false)

    const hb2 = await store.touchPresence('stress-scene', 'user2', 'u2@x', { claimEditor: true })
    expect(hb2.isEditor).toBe(true)

    const present = await store.listScenePresence('stress-scene')
    const activeEditors = present.filter((p) => p.isEditor)
    expect(activeEditors.length).toBe(1)
    expect(activeEditors[0]!.userId).toBe('user2')
  })
})
