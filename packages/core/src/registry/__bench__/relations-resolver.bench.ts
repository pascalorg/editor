/**
 * Bench harness for the relations cascade resolver.
 *
 * Phase 1 risk gate: at 5000 nodes the resolver step must stay under
 * 2ms p95 per `cascadeDirty` invocation. Above that, the registry-driven
 * dispatch will tank framerate during a corner drag in Phase 3.
 *
 * Run via:
 *   bun run packages/core/src/registry/__bench__/relations-resolver.bench.ts
 *
 * Output: JSON to stdout with { p50, p95, p99, mean, max, n } in milliseconds.
 * Doubles as a regression gate — wire into CI when we have a baseline.
 */

import { z } from 'zod'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import { nodeRegistry, registerNode } from '../registry'
import { cascadeDirty, type SpatialQuery } from '../relations-resolver'
import type { AnyNodeDefinition, SceneApi } from '../types'

const ID = (s: string) => s as AnyNodeId

function makeDef(kind: string, relations?: AnyNodeDefinition['relations']): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities: {},
    relations,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  }
}

/**
 * Builds a 5000-node fixture: a 50×100 grid of walls (so 5000 walls).
 * Each wall hosts up to 2 doors and is bordered by ~4 slabs (in a sparse
 * spatial index). Designed to stress hosts + affectsSpatial cascade
 * simultaneously.
 *
 * Returns:
 * - 5000 wall nodes
 * - 8000 door nodes (children of walls)
 * - 200 slab nodes (sparse; ~25 walls per slab)
 *
 * Total: ~13,200 nodes. The cascade starts from one wall and should mark
 * its children (doors) + its spatial neighbors (slabs) dirty.
 */
function buildFixture() {
  const nodes: Record<string, AnyNode> = {}
  const wallToSlabIds = new Map<string, AnyNodeId[]>()

  for (let row = 0; row < 50; row++) {
    for (let col = 0; col < 100; col++) {
      const wallId = ID(`wall_r${row}c${col}`)
      const childIds: AnyNodeId[] = []
      for (let d = 0; d < 2; d++) {
        const doorId = ID(`door_r${row}c${col}d${d}`)
        childIds.push(doorId)
        nodes[doorId as string] = {
          id: doorId,
          type: 'door',
          parentId: wallId,
          visible: true,
        } as unknown as AnyNode
      }
      nodes[wallId as string] = {
        id: wallId,
        type: 'wall',
        parentId: null,
        visible: true,
        children: childIds,
      } as unknown as AnyNode

      // Map this wall to its bordering slab (sparse: ~25 walls share a slab).
      const slabRow = Math.floor(row / 5)
      const slabCol = Math.floor(col / 5)
      const slabId = ID(`slab_r${slabRow}c${slabCol}`)
      const list = wallToSlabIds.get(wallId as string) ?? []
      list.push(slabId)
      wallToSlabIds.set(wallId as string, list)
    }
  }

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 20; col++) {
      const slabId = ID(`slab_r${row}c${col}`)
      nodes[slabId as string] = {
        id: slabId,
        type: 'slab',
        parentId: null,
        visible: true,
      } as unknown as AnyNode
    }
  }

  return { nodes, wallToSlabIds }
}

function makeScene(nodes: Record<string, AnyNode>): SceneApi {
  return {
    get: ((nid: AnyNodeId) => nodes[nid as string]) as SceneApi['get'],
    nodes: () => nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    update: () => {},
    upsert: () => ID(''),
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx] ?? 0
}

async function main() {
  nodeRegistry._reset()
  registerNode(makeDef('wall', { hosts: ['door'], affectsSpatial: ['slab'] }))
  registerNode(makeDef('door'))
  registerNode(makeDef('slab'))

  const { nodes, wallToSlabIds } = buildFixture()
  const scene = makeScene(nodes)

  const spatialQuery: SpatialQuery = (node, kinds) => {
    if (!kinds.includes('slab')) return []
    return wallToSlabIds.get(node.id as string) ?? []
  }

  const totalNodes = Object.keys(nodes).length
  const totalWalls = 50 * 100
  console.log(`[bench] fixture: ${totalNodes} nodes (${totalWalls} walls, 8000 doors, 200 slabs)`)

  const iterations = 1000
  const samples: number[] = []

  // Warm-up — JIT, cache lines, etc.
  for (let i = 0; i < 50; i++) {
    cascadeDirty(ID(`wall_r${i % 50}c${i % 100}`), { scene, spatialQuery })
  }

  for (let i = 0; i < iterations; i++) {
    const row = i % 50
    const col = i % 100
    const startId = ID(`wall_r${row}c${col}`)
    const t0 = performance.now()
    cascadeDirty(startId, { scene, spatialQuery })
    const elapsed = performance.now() - t0
    samples.push(elapsed)
  }

  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length
  const max = Math.max(...samples)
  const p50 = percentile(samples, 50)
  const p95 = percentile(samples, 95)
  const p99 = percentile(samples, 99)

  const result = {
    fixture: { totalNodes, walls: totalWalls, doors: 8000, slabs: 200 },
    iterations,
    p50_ms: Number(p50.toFixed(4)),
    p95_ms: Number(p95.toFixed(4)),
    p99_ms: Number(p99.toFixed(4)),
    mean_ms: Number(mean.toFixed(4)),
    max_ms: Number(max.toFixed(4)),
  }
  console.log(JSON.stringify(result, null, 2))

  const target = 2.0
  if (p95 > target) {
    console.error(
      `\n❌ p95 ${p95.toFixed(2)}ms exceeds Phase 1 gate of ${target}ms. ` +
        `Phase 2 (column + shelf) can still proceed since their relations are empty, ` +
        `but Phase 3 wall migration must add spatial-index-backed neighbor queries first.`,
    )
    process.exitCode = 1
  } else {
    console.log(`\n✅ p95 ${p95.toFixed(3)}ms within Phase 1 gate of ${target}ms`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
