/**
 * The measurement #31 asks for: what 100 consecutive autosaves cost on disk.
 *
 * It is a test rather than a script because the number is a regression surface —
 * the whole point of the draft/checkpoint split is that editing stops growing
 * the database, and a later change that quietly makes autosave write history
 * again would be invisible in every other test in the suite.
 *
 * Run with `PASCAL_REPORT_WRITES=1` to print the figures.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SqliteSceneStore } from './sqlite-scene-store'

const AUTOSAVES = 100

/** A scene with enough nodes that the graph body dominates the row overhead. */
function measurableGraph(wallCount = 200): SceneGraph {
  const nodes: Record<string, unknown> = {
    site_a: {
      object: 'node',
      id: 'site_a',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
    },
    building_a: {
      object: 'node',
      id: 'building_a',
      type: 'building',
      parentId: 'site_a',
      visible: true,
      metadata: {},
    },
  }
  for (let i = 0; i < wallCount; i += 1) {
    nodes[`wall_${i}`] = {
      object: 'node',
      id: `wall_${i}`,
      type: 'wall',
      parentId: 'building_a',
      visible: true,
      metadata: {},
      children: [],
      start: [i, 0],
      end: [i + 1, 0],
      thickness: 0.2,
      height: 2.7,
      frontSide: 'unknown',
      backSide: 'unknown',
    }
  }
  return {
    nodes: nodes as unknown as SceneGraph['nodes'],
    rootNodeIds: ['site_a'] as SceneGraph['rootNodeIds'],
  }
}

describe('what 100 autosaves write', () => {
  let directory: string
  let store: SqliteSceneStore

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pascal-writes-'))
    store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
  })

  afterEach(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })

  async function autosave(mode: 'draft' | 'checkpoint'): Promise<{
    graphBytes: number
    historyBytes: number
    fileBytes: number
  }> {
    const graph = measurableGraph()
    let version = (await store.save({ id: 'measured', name: 'Measured', graph })).version
    const graphBytes = Buffer.byteLength(JSON.stringify(graph), 'utf8')

    for (let i = 0; i < AUTOSAVES; i += 1) {
      version = (
        await store.save({
          id: 'measured',
          name: 'Measured',
          graph,
          expectedVersion: version,
          saveMode: mode,
        })
      ).version
    }

    // `total_changes` counts rows, not bytes; the graph is the payload, so rows
    // × graph size is the honest figure for how much body the history holds.
    const rows = await store.pruneSceneHistory('measured', {
      keepCheckpoints: 0,
      keepDays: 0,
      keepEvents: 0,
    })
    store.close()
    const fileBytes = statSync(join(directory, 'pascal.db')).size
    return {
      graphBytes,
      historyBytes: rows.revisionsDeleted * graphBytes,
      fileBytes,
    }
  }

  test('drafts write one body; checkpoints write one per save', async () => {
    const draft = await autosave('draft')

    // A second store over a fresh file, so the two runs cannot share pages.
    store.close()
    rmSync(directory, { recursive: true, force: true })
    directory = mkdtempSync(join(tmpdir(), 'pascal-writes-'))
    store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
    const checkpoint = await autosave('checkpoint')

    if (process.env.PASCAL_REPORT_WRITES) {
      const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)} MB`
      console.info(
        [
          '',
          `scene graph:          ${(draft.graphBytes / 1024).toFixed(1)} KB`,
          `${AUTOSAVES} autosaves as drafts:      history ${mb(draft.historyBytes)}, file ${mb(draft.fileBytes)}`,
          `${AUTOSAVES} autosaves as checkpoints: history ${mb(checkpoint.historyBytes)}, file ${mb(checkpoint.fileBytes)}`,
          `ratio: ${(checkpoint.fileBytes / draft.fileBytes).toFixed(1)}× smaller on disk`,
          '',
        ].join('\n'),
      )
    }

    // 100 draft saves leave behind exactly the one body the opening checkpoint
    // wrote; 100 checkpoints leave one body each.
    expect(draft.historyBytes).toBe(draft.graphBytes)
    expect(checkpoint.historyBytes).toBeGreaterThanOrEqual(AUTOSAVES * draft.graphBytes)

    // The file is the end-to-end number: what an hour of editing costs.
    expect(checkpoint.fileBytes).toBeGreaterThan(draft.fileBytes * 10)
  })
})
