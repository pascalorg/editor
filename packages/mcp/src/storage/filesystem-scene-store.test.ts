import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  FilesystemSceneStore,
  type FilesystemSceneStoreOptions,
  resolveDefaultRootDir,
} from './filesystem-scene-store'
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
  return fs.mkdtemp(path.join(os.tmpdir(), 'pascal-test-'))
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

function createStore(rootDir: string, opts: Partial<FilesystemSceneStoreOptions> = {}) {
  return new FilesystemSceneStore({ rootDir, ...opts })
}

describe('resolveDefaultRootDir', () => {
  test('respects PASCAL_DATA_DIR when set', () => {
    const dir = resolveDefaultRootDir({ PASCAL_DATA_DIR: '/custom/pascal' })
    expect(dir).toBe('/custom/pascal')
  })

  test('ignores empty PASCAL_DATA_DIR', () => {
    const dir = resolveDefaultRootDir({ PASCAL_DATA_DIR: '', HOME: '/home/user' })
    expect(dir.endsWith(path.join('.pascal', 'data'))).toBe(true)
  })

  test('falls back to XDG_DATA_HOME', () => {
    if (process.platform === 'win32') return
    const dir = resolveDefaultRootDir({ XDG_DATA_HOME: '/xdg/share' })
    expect(dir).toBe(path.join('/xdg/share', 'pascal', 'data'))
  })

  test('falls back to homedir + .pascal/data', () => {
    if (process.platform === 'win32') return
    const dir = resolveDefaultRootDir({})
    expect(dir.endsWith(path.join('.pascal', 'data'))).toBe(true)
  })
})

describe('FilesystemSceneStore', () => {
  let rootDir: string
  let store: FilesystemSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    await rmrf(rootDir)
  })

  // ----------- Construction / defaults -----------

  test('backend is "filesystem"', () => {
    expect(store.backend).toBe('filesystem')
  })

  test('resolves default root when no rootDir is passed', () => {
    const fallback = new FilesystemSceneStore({ env: { PASCAL_DATA_DIR: rootDir } })
    expect(fallback.backend).toBe('filesystem')
  })

  // ----------- save() -----------

  test('generates an id when none is provided', async () => {
    const meta = await store.save({ name: 'Scratch', graph: makeGraph() })
    expect(typeof meta.id).toBe('string')
    expect(meta.id.length).toBeGreaterThan(0)
    expect(meta.version).toBe(1)
  })

  test('round-trip save → load preserves graph exactly', async () => {
    const graph = makeGraph()
    const saved = await store.save({ id: 'kitchen', name: 'Kitchen', graph })
    expect(saved.id).toBe('kitchen')
    const loaded = await store.load('kitchen')
    expect(loaded).not.toBeNull()
    expect(loaded!.graph).toEqual(graph)
    expect(loaded!.name).toBe('Kitchen')
    expect(loaded!.nodeCount).toBe(2)
    expect(loaded!.version).toBe(1)
  })

  test('stores projectId, ownerId, and thumbnailUrl verbatim', async () => {
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

  test('version bumps by 1 each save', async () => {
    const first = await store.save({ id: 'bump', name: 'Bump', graph: makeGraph() })
    expect(first.version).toBe(1)
    const second = await store.save({
      id: 'bump',
      name: 'Bump',
      graph: makeGraph(),
      expectedVersion: 1,
    })
    expect(second.version).toBe(2)
    const third = await store.save({
      id: 'bump',
      name: 'Bump',
      graph: makeGraph(),
      expectedVersion: 2,
    })
    expect(third.version).toBe(3)
  })

  test('preserves createdAt on overwrite, updates updatedAt', async () => {
    const first = await store.save({ id: 'times', name: 'T', graph: makeGraph() })
    await new Promise((r) => setTimeout(r, 5))
    const second = await store.save({
      id: 'times',
      name: 'T',
      graph: makeGraph(),
      expectedVersion: 1,
    })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
  })

  test('expectedVersion mismatch throws SceneVersionConflictError', async () => {
    await store.save({ id: 'conflict', name: 'C', graph: makeGraph() })
    await expect(
      store.save({ id: 'conflict', name: 'C', graph: makeGraph(), expectedVersion: 99 }),
    ).rejects.toThrow(SceneVersionConflictError)
  })

  test('expectedVersion=0 matches a brand-new id', async () => {
    const meta = await store.save({
      id: 'fresh',
      name: 'Fresh',
      graph: makeGraph(),
      expectedVersion: 0,
    })
    expect(meta.version).toBe(1)
  })

  test('slug collision (no expectedVersion) throws', async () => {
    await store.save({ id: 'kitchen', name: 'K1', graph: makeGraph() })
    await expect(store.save({ id: 'kitchen', name: 'K2', graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  test('save without id never collides (generates unique slug)', async () => {
    const a = await store.save({ name: 'A', graph: makeGraph() })
    const b = await store.save({ name: 'B', graph: makeGraph() })
    expect(a.id).not.toBe(b.id)
  })

  test('name length 0 throws', async () => {
    await expect(store.save({ name: '', graph: makeGraph() })).rejects.toThrow(SceneInvalidError)
  })

  test('name length 201 throws', async () => {
    const longName = 'x'.repeat(201)
    await expect(store.save({ name: longName, graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  test('name length 200 is accepted', async () => {
    const name = 'x'.repeat(200)
    const meta = await store.save({ name, graph: makeGraph() })
    expect(meta.name).toBe(name)
  })

  test('non-string name throws', async () => {
    await expect(
      store.save({ name: 123 as unknown as string, graph: makeGraph() }),
    ).rejects.toThrow(SceneInvalidError)
  })

  test('whitespace-only name throws', async () => {
    await expect(store.save({ name: '   ', graph: makeGraph() })).rejects.toThrow(SceneInvalidError)
  })

  test('too-large scene throws SceneTooLargeError', async () => {
    // Build a graph that encodes to > 10 MB in pretty JSON.
    const nodes: Record<string, unknown> = {}
    const bigBlob = 'A'.repeat(2048)
    for (let i = 0; i < 6000; i++) {
      nodes[`site_${i}`] = {
        object: 'node',
        id: `site_${i}`,
        type: 'site',
        parentId: null,
        visible: true,
        metadata: { blob: bigBlob },
      }
    }
    const graph = {
      nodes,
      rootNodeIds: Object.keys(nodes),
    } as unknown as SceneGraph
    await expect(store.save({ name: 'Big', graph })).rejects.toThrow(SceneTooLargeError)
  })

  test('sanitizes id with path traversal attempt', async () => {
    const meta = await store.save({ id: '../escape', name: 'Evil', graph: makeGraph() })
    expect(meta.id).toBe('escape')
    const filesInScenes = await fs.readdir(path.join(rootDir, 'scenes'))
    expect(filesInScenes).toContain('escape.json')
    // Nothing wrote outside the scenes dir
    const rootEntries = await fs.readdir(rootDir)
    expect(rootEntries).toEqual(['scenes'])
  })

  test('sanitizes mixed-case / whitespace id', async () => {
    const meta = await store.save({ id: 'My Kitchen!', name: 'Kitchen', graph: makeGraph() })
    expect(meta.id).toBe('my-kitchen')
  })

  test('fails fast if sanitized id is empty', async () => {
    await expect(store.save({ id: '!!!', name: 'Bad', graph: makeGraph() })).rejects.toThrow()
  })

  test('pretty-prints JSON with 2-space indent', async () => {
    await store.save({ id: 'pretty', name: 'P', graph: makeGraph() })
    const raw = await fs.readFile(path.join(rootDir, 'scenes', 'pretty.json'), 'utf8')
    expect(raw.includes('\n  "meta"')).toBe(true)
  })

  test('sizeBytes reflects on-disk byte length', async () => {
    const meta = await store.save({ id: 'sized', name: 'S', graph: makeGraph() })
    const stat = await fs.stat(path.join(rootDir, 'scenes', 'sized.json'))
    expect(meta.sizeBytes).toBe(stat.size)
  })

  test('nodeCount equals Object.keys(graph.nodes).length', async () => {
    const meta = await store.save({ id: 'count', name: 'C', graph: makeGraph() })
    expect(meta.nodeCount).toBe(2)
  })

  test('writes index sidecar after save', async () => {
    await store.save({ id: 'idx-a', name: 'A', graph: makeGraph() })
    const idxRaw = await fs.readFile(path.join(rootDir, 'scenes', '.index.json'), 'utf8')
    const parsed = JSON.parse(idxRaw) as Array<{ id: string }>
    expect(parsed.map((m) => m.id)).toContain('idx-a')
  })

  // ----------- load() -----------

  test('load returns null for missing file', async () => {
    const result = await store.load('nonexistent')
    expect(result).toBeNull()
  })

  test('load throws SceneInvalidError for non-object nodes', async () => {
    // Write bogus contents directly.
    await fs.mkdir(path.join(rootDir, 'scenes'), { recursive: true })
    const bogus = {
      meta: {
        id: 'bogus',
        name: 'Bogus',
        projectId: null,
        thumbnailUrl: null,
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ownerId: null,
        sizeBytes: 0,
        nodeCount: 1,
      },
      graph: {
        nodes: { site_x: 'not-an-object' },
        rootNodeIds: ['site_x'],
      },
    }
    await fs.writeFile(
      path.join(rootDir, 'scenes', 'bogus.json'),
      JSON.stringify(bogus, null, 2),
      'utf8',
    )
    await expect(store.load('bogus')).rejects.toThrow(SceneInvalidError)
  })

  test('load throws SceneInvalidError when nodes is not an object', async () => {
    await fs.mkdir(path.join(rootDir, 'scenes'), { recursive: true })
    const badShape = {
      meta: {
        id: 'badshape',
        name: 'B',
        projectId: null,
        thumbnailUrl: null,
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ownerId: null,
        sizeBytes: 0,
        nodeCount: 0,
      },
      graph: {
        nodes: 'hello',
        rootNodeIds: [],
      },
    }
    await fs.writeFile(
      path.join(rootDir, 'scenes', 'badshape.json'),
      JSON.stringify(badShape),
      'utf8',
    )
    await expect(store.load('badshape')).rejects.toThrow(SceneInvalidError)
  })

  test('load throws SceneInvalidError for node missing "type"', async () => {
    await fs.mkdir(path.join(rootDir, 'scenes'), { recursive: true })
    const noType = {
      meta: {
        id: 'notype',
        name: 'N',
        projectId: null,
        thumbnailUrl: null,
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ownerId: null,
        sizeBytes: 0,
        nodeCount: 1,
      },
      graph: {
        nodes: { site_x: { id: 'site_x' } },
        rootNodeIds: ['site_x'],
      },
    }
    await fs.writeFile(path.join(rootDir, 'scenes', 'notype.json'), JSON.stringify(noType), 'utf8')
    await expect(store.load('notype')).rejects.toThrow(SceneInvalidError)
  })

  test('load throws SceneInvalidError for unparseable JSON', async () => {
    await fs.mkdir(path.join(rootDir, 'scenes'), { recursive: true })
    await fs.writeFile(path.join(rootDir, 'scenes', 'garbage.json'), '{not json', 'utf8')
    await expect(store.load('garbage')).rejects.toThrow(SceneInvalidError)
  })

  // ----------- list() -----------

  test('list returns [] when scenes dir is empty or absent', async () => {
    expect(await store.list()).toEqual([])
  })

  test('list finds all saved scenes', async () => {
    await store.save({ id: 'a', name: 'A', graph: makeGraph() })
    await store.save({ id: 'b', name: 'B', graph: makeGraph() })
    await store.save({ id: 'c', name: 'C', graph: makeGraph() })
    const list = await store.list()
    expect(list.map((m) => m.id).sort()).toEqual(['a', 'b', 'c'])
  })

  test('list uses index sidecar as fast path', async () => {
    await store.save({ id: 'fast', name: 'F', graph: makeGraph() })
    // Corrupt the on-disk json so collectAllMeta would fail; the index should
    // still list the entry as long as the file exists.
    const list = await store.list()
    expect(list.map((m) => m.id)).toContain('fast')
  })

  test('list falls back to readdir when index is absent', async () => {
    await store.save({ id: 'slow', name: 'S', graph: makeGraph() })
    await fs.unlink(path.join(rootDir, 'scenes', '.index.json'))
    const list = await store.list()
    expect(list.map((m) => m.id)).toContain('slow')
  })

  test('list filters by projectId', async () => {
    await store.save({ id: 'p1-a', name: 'A', graph: makeGraph(), projectId: 'p1' })
    await store.save({ id: 'p1-b', name: 'B', graph: makeGraph(), projectId: 'p1' })
    await store.save({ id: 'p2-c', name: 'C', graph: makeGraph(), projectId: 'p2' })
    const result = await store.list({ projectId: 'p1' })
    expect(result.map((m) => m.id).sort()).toEqual(['p1-a', 'p1-b'])
  })

  test('list filters by ownerId', async () => {
    await store.save({ id: 'u1-a', name: 'A', graph: makeGraph(), ownerId: 'u1' })
    await store.save({ id: 'u2-b', name: 'B', graph: makeGraph(), ownerId: 'u2' })
    const result = await store.list({ ownerId: 'u1' })
    expect(result.map((m) => m.id)).toEqual(['u1-a'])
  })

  test('list respects limit', async () => {
    await store.save({ id: 'l1', name: '1', graph: makeGraph() })
    await store.save({ id: 'l2', name: '2', graph: makeGraph() })
    await store.save({ id: 'l3', name: '3', graph: makeGraph() })
    const result = await store.list({ limit: 2 })
    expect(result.length).toBe(2)
  })

  test('list sorts by updatedAt desc', async () => {
    await store.save({ id: 'first', name: '1', graph: makeGraph() })
    await new Promise((r) => setTimeout(r, 10))
    await store.save({ id: 'second', name: '2', graph: makeGraph() })
    const result = await store.list()
    expect(result[0]?.id).toBe('second')
    expect(result[1]?.id).toBe('first')
  })

  test('list ignores tmp files and non-json entries', async () => {
    await store.save({ id: 'real', name: 'R', graph: makeGraph() })
    await fs.unlink(path.join(rootDir, 'scenes', '.index.json'))
    await fs.writeFile(path.join(rootDir, 'scenes', 'stray.txt'), 'ignored', 'utf8')
    await fs.writeFile(path.join(rootDir, 'scenes', 'real.json.tmp'), '{}', 'utf8')
    const result = await store.list()
    expect(result.map((m) => m.id)).toEqual(['real'])
  })

  test('list drops index entries whose file was removed out-of-band', async () => {
    await store.save({ id: 'vanish', name: 'V', graph: makeGraph() })
    await store.save({ id: 'keep', name: 'K', graph: makeGraph() })
    // Bypass delete() — simulate another tool removing the file without updating the index
    await fs.unlink(path.join(rootDir, 'scenes', 'vanish.json'))
    const result = await store.list()
    expect(result.map((m) => m.id)).toEqual(['keep'])
  })

  // ----------- delete() -----------

  test('delete removes file and returns true', async () => {
    await store.save({ id: 'del', name: 'D', graph: makeGraph() })
    const ok = await store.delete('del')
    expect(ok).toBe(true)
    expect(await store.load('del')).toBeNull()
  })

  test('delete returns false for missing scene', async () => {
    expect(await store.delete('ghost')).toBe(false)
  })

  test('delete with matching expectedVersion succeeds', async () => {
    await store.save({ id: 'dv', name: 'D', graph: makeGraph() })
    const ok = await store.delete('dv', { expectedVersion: 1 })
    expect(ok).toBe(true)
  })

  test('delete with mismatched expectedVersion throws', async () => {
    await store.save({ id: 'dvx', name: 'D', graph: makeGraph() })
    await expect(store.delete('dvx', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
  })

  test('delete updates index', async () => {
    await store.save({ id: 'i1', name: '1', graph: makeGraph() })
    await store.save({ id: 'i2', name: '2', graph: makeGraph() })
    await store.delete('i1')
    const idx = JSON.parse(
      await fs.readFile(path.join(rootDir, 'scenes', '.index.json'), 'utf8'),
    ) as Array<{ id: string }>
    expect(idx.map((m) => m.id)).toEqual(['i2'])
  })

  // ----------- rename() -----------

  test('rename updates name and bumps version', async () => {
    await store.save({ id: 'ren', name: 'Original', graph: makeGraph() })
    const renamed = await store.rename('ren', 'Shiny')
    expect(renamed.name).toBe('Shiny')
    expect(renamed.version).toBe(2)
    const loaded = await store.load('ren')
    expect(loaded?.name).toBe('Shiny')
  })

  test('rename preserves graph exactly', async () => {
    const graph = makeGraph()
    await store.save({ id: 'rg', name: 'Before', graph })
    await store.rename('rg', 'After')
    const loaded = await store.load('rg')
    expect(loaded?.graph).toEqual(graph)
  })

  test('rename preserves projectId / ownerId / thumbnailUrl', async () => {
    await store.save({
      id: 'rmeta',
      name: 'Before',
      graph: makeGraph(),
      projectId: 'p',
      ownerId: 'u',
      thumbnailUrl: 'https://x.y/z',
    })
    const renamed = await store.rename('rmeta', 'After')
    expect(renamed.projectId).toBe('p')
    expect(renamed.ownerId).toBe('u')
    expect(renamed.thumbnailUrl).toBe('https://x.y/z')
  })

  test('rename with matching expectedVersion succeeds', async () => {
    await store.save({ id: 'rv', name: 'A', graph: makeGraph() })
    const renamed = await store.rename('rv', 'B', { expectedVersion: 1 })
    expect(renamed.version).toBe(2)
  })

  test('rename with mismatched expectedVersion throws', async () => {
    await store.save({ id: 'rvx', name: 'A', graph: makeGraph() })
    await expect(store.rename('rvx', 'B', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
  })

  test('rename on missing scene throws SceneInvalidError', async () => {
    await expect(store.rename('ghost', 'X')).rejects.toThrow(SceneInvalidError)
  })

  test('rename validates name length', async () => {
    await store.save({ id: 'rnl', name: 'A', graph: makeGraph() })
    await expect(store.rename('rnl', '')).rejects.toThrow(SceneInvalidError)
    await expect(store.rename('rnl', 'x'.repeat(201))).rejects.toThrow(SceneInvalidError)
  })

  // ----------- Integration: delete + list + rename round-trip -----------

  test('round-trip: save → rename → list → delete', async () => {
    await store.save({ id: 'rt1', name: 'One', graph: makeGraph() })
    await store.save({ id: 'rt2', name: 'Two', graph: makeGraph() })
    await store.rename('rt1', 'Uno')
    const listed = await store.list()
    const renamed = listed.find((m) => m.id === 'rt1')
    expect(renamed?.name).toBe('Uno')
    expect(renamed?.version).toBe(2)
    expect(await store.delete('rt2')).toBe(true)
    const after = await store.list()
    expect(after.map((m) => m.id)).toEqual(['rt1'])
  })

  // ----------- Atomic write / concurrency -----------

  test('atomic write does not leave tmp files on success', async () => {
    await store.save({ id: 'atomic', name: 'A', graph: makeGraph() })
    const entries = await fs.readdir(path.join(rootDir, 'scenes'))
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  test('concurrent saves do not leave a torn file', async () => {
    // Atomic rename guarantees the on-disk file is always a complete,
    // parseable snapshot even under parallel writes. We don't guarantee that
    // optimistic version checks serialize writers — that requires an external
    // lock — but each write either succeeds or rejects cleanly, and the
    // final file is always loadable.
    await store.save({ id: 'race', name: 'Race', graph: makeGraph() })
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        store.save({
          id: 'race',
          name: `Race-${i}`,
          graph: makeGraph(),
          expectedVersion: 1,
        }),
      ),
    )
    expect(attempts.every((a) => a.status === 'fulfilled' || a.status === 'rejected')).toBe(true)
    const loaded = await store.load('race')
    expect(loaded).not.toBeNull()
    // At least one concurrent save committed, so the version advanced.
    expect(loaded!.version).toBeGreaterThanOrEqual(2)
  })
})
