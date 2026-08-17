import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { migrateScenes } from './scene-migration'
import { SqliteSceneStore } from './sqlite-scene-store'

// Two SQLite stores stand in for the real SQLite→Postgres pair: `migrateScenes`
// only sees the `SceneStore` contract, and the contract test already pins the
// two backends to the same behaviour. This keeps the migration tests runnable
// without a database while still exercising dry-run, idempotency and ownership.
let dirs: string[] = []

async function tmpStore(name: string): Promise<SqliteSceneStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pascal-migrate-${name}-`))
  dirs.push(dir)
  return new SqliteSceneStore({ databasePath: path.join(dir, 'pascal.db') })
}

function graph(label: string): SceneGraph {
  return {
    nodes: { n1: { type: 'level', id: 'n1', name: label } },
    rootNodeIds: ['n1'],
  }
}

beforeEach(() => {
  dirs = []
})

afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function seed(store: SqliteSceneStore): Promise<void> {
  await store.save({
    id: 'scene_a',
    name: 'Owned',
    ownerId: 'user_1',
    projectId: null,
    graph: graph('a'),
  })
  await store.save({
    id: 'scene_b',
    name: 'Guest',
    ownerId: null,
    projectId: null,
    graph: graph('b'),
  })
}

describe('migrateScenes', () => {
  test('copies every scene with its metadata and graph', async () => {
    const source = await tmpStore('src')
    const target = await tmpStore('dst')
    await seed(source)

    const report = await migrateScenes(source, target)

    expect(report).toEqual({ migrated: 2, overwritten: 0, skipped: 0, failed: [] })
    const owned = await target.load('scene_a')
    expect(owned?.ownerId).toBe('user_1')
    expect(owned?.name).toBe('Owned')
    expect((owned?.graph.nodes as Record<string, { name: string }>).n1?.name).toBe('a')
    const guest = await target.load('scene_b')
    expect(guest?.ownerId).toBeNull()
  })

  test('dry-run writes nothing', async () => {
    const source = await tmpStore('src')
    const target = await tmpStore('dst')
    await seed(source)

    const report = await migrateScenes(source, target, { dryRun: true })

    expect(report.migrated).toBe(2)
    expect(await target.list()).toEqual([])
  })

  test('a second run skips every scene', async () => {
    const source = await tmpStore('src')
    const target = await tmpStore('dst')
    await seed(source)
    await migrateScenes(source, target)

    const second = await migrateScenes(source, target)

    expect(second.skipped).toBe(2)
    expect(second.migrated).toBe(0)
    const scenes = await target.list()
    expect(scenes).toHaveLength(2)
    // Versions did not advance: the second run did not rewrite anything.
    expect(scenes.every((scene) => scene.version === 1)).toBe(true)
  })

  test('--owner stamps only the scenes that had no owner', async () => {
    const source = await tmpStore('src')
    const target = await tmpStore('dst')
    await seed(source)

    await migrateScenes(source, target, { ownerId: 'user_migrator' })

    expect((await target.load('scene_a'))?.ownerId).toBe('user_1')
    expect((await target.load('scene_b'))?.ownerId).toBe('user_migrator')
  })

  test('--overwrite re-saves a scene the target already has', async () => {
    const source = await tmpStore('src')
    const target = await tmpStore('dst')
    await seed(source)
    await migrateScenes(source, target)

    // The source scene changes after the first migration.
    await source.save({
      id: 'scene_a',
      name: 'Owned',
      ownerId: 'user_1',
      graph: graph('a2'),
      expectedVersion: 1,
    })

    const report = await migrateScenes(source, target, { overwrite: true })

    expect(report.overwritten).toBe(2)
    expect(
      (await target.load('scene_a'))?.graph.nodes as Record<string, { name: string }>,
    ).n1?.name.toBe('a2')
  })

  test('a failed save is reported, not thrown', async () => {
    const source = await tmpStore('src')
    await seed(source)

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-migrate-small-'))
    dirs.push(dir)
    // A 1-byte cap refuses every scene, so each save fails and the tool reports
    // the failures instead of aborting on the first one.
    const smallTarget = new SqliteSceneStore({
      databasePath: path.join(dir, 'pascal.db'),
      maxSceneBytes: 1,
    })

    const report = await migrateScenes(source, smallTarget)

    expect(report.failed.length).toBe(2)
    expect(report.migrated).toBe(0)
  })
})
