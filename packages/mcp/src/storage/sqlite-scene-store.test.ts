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
  test('respects PASCAL_DB_PATH when set', () => {
    expect(resolveDefaultDatabasePath({ PASCAL_DB_PATH: '/tmp/custom.db' })).toBe('/tmp/custom.db')
  })

  test('resolves PASCAL_DATA_DIR to pascal.db', () => {
    expect(resolveDefaultDatabasePath({ PASCAL_DATA_DIR: '/tmp/pascal-data' })).toBe(
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
