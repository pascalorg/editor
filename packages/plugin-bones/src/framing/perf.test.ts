import { describe, expect, test } from 'bun:test'
import { FramingNode } from './schema'
import { computeLevel } from './compute'

/**
 * The rubric's hard performance gate (review/RUBRIC.md → UI/UX/Performance):
 * full-level recompute stays interactive — p95 under 50ms for a 20-wall
 * house and under 150ms for a 60-wall house, ALL systems on, at LOD 400.
 * This test is the regression tripwire for every fabrication feature the
 * loop adds: geometry is welcome, O(n²) blowups are not.
 */

/** Synthetic house: a ring of exterior walls + interior partitions, doors,
 * windows, zones, a slab, and a gable roof — every engine gets work. */
function synthesizeHouse(wallCount: number): Record<string, Record<string, unknown>> {
  const nodes: Record<string, Record<string, unknown>> = {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.7 },
  }
  // Exterior ring: a big rectangle subdivided into wallCount/2 segments.
  const half = Math.max(4, Math.floor(wallCount / 2))
  const perimeterPts: [number, number][] = []
  const W = 24
  const D = 12
  for (let i = 0; i < half; i++) {
    const t = i / half
    // walk the rectangle perimeter
    const p = t * 2 * (W + D)
    let x: number
    let z: number
    if (p < W) [x, z] = [p, 0]
    else if (p < W + D) [x, z] = [W, p - W]
    else if (p < 2 * W + D) [x, z] = [W - (p - W - D), D]
    else [x, z] = [0, D - (p - 2 * W - D)]
    perimeterPts.push([x, z])
  }
  for (let i = 0; i < perimeterPts.length; i++) {
    const a = perimeterPts[i] as [number, number]
    const b = perimeterPts[(i + 1) % perimeterPts.length] as [number, number]
    const id = `wall_ext_${i}`
    const children: string[] = []
    if (i % 3 === 0) {
      const doorId = `door_${i}`
      nodes[doorId] = { id: doorId, type: 'door', position: [1.2, 1.05, 0], width: 0.9, height: 2.1 }
      children.push(doorId)
    }
    if (i % 3 === 1) {
      const winId = `window_${i}`
      nodes[winId] = { id: winId, type: 'window', position: [1.5, 1.5, 0], width: 1.2, height: 1.2 }
      children.push(winId)
    }
    nodes[id] = {
      id,
      type: 'wall',
      parentId: 'level_1',
      start: a,
      end: b,
      thickness: 0.15,
      height: 2.5,
      frontSide: 'exterior',
      backSide: 'interior',
      children,
    }
  }
  // Interior partitions to reach wallCount.
  for (let i = perimeterPts.length; i < wallCount; i++) {
    const x = 2 + (i % 10) * 2
    nodes[`wall_int_${i}`] = {
      id: `wall_int_${i}`,
      type: 'wall',
      parentId: 'level_1',
      start: [x, 1],
      end: [x, D - 1],
      thickness: 0.1,
      height: 2.5,
      frontSide: 'interior',
      backSide: 'interior',
      children: [],
    }
  }
  // Rooms, slab, roof.
  nodes.zone_kitchen = {
    id: 'zone_kitchen', type: 'zone', parentId: 'level_1', name: 'Kitchen',
    polygon: [[0, 0], [8, 0], [8, 6], [0, 6]], boundaryWallIds: [], ceilingHeight: 2.5,
  }
  nodes.zone_bath = {
    id: 'zone_bath', type: 'zone', parentId: 'level_1', name: 'Bathroom',
    polygon: [[8, 0], [12, 0], [12, 6], [8, 6]], boundaryWallIds: [], ceilingHeight: 2.5,
  }
  nodes.zone_bed = {
    id: 'zone_bed', type: 'zone', parentId: 'level_1', name: 'Bedroom',
    polygon: [[12, 0], [24, 0], [24, 12], [12, 12]], boundaryWallIds: [], ceilingHeight: 2.5,
  }
  nodes.slab_1 = {
    id: 'slab_1', type: 'slab', parentId: 'level_1',
    polygon: [[0, 0], [W, 0], [W, D], [0, D]], elevation: 0.05, thickness: 0.2,
  }
  nodes.roof_1 = {
    id: 'roof_1', type: 'roof', parentId: 'level_1', position: [W / 2, 2.5, D / 2], rotation: 0, children: ['roofseg_1'],
  }
  nodes.roofseg_1 = {
    id: 'roofseg_1', type: 'roof-segment', parentId: 'roof_1', position: [0, 0, 0], rotation: 0,
    roofType: 'gable', width: W, depth: D, pitch: 35, overhang: 0.3, wallHeight: 0.5,
  }
  return nodes
}

function allOnConfig() {
  const config = FramingNode.parse({
    jurisdiction: 'CA', // seismic path on
    detail: '400',
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
  })
  return { ...config, parentId: 'level_1' as typeof config.parentId }
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number
}

function benchmark(wallCount: number, runs: number): { p95ms: number; members: number } {
  const nodes = synthesizeHouse(wallCount)
  const config = allOnConfig()
  // warmup (JIT, module caches)
  computeLevel(nodes, config)
  const samples: number[] = []
  let members = 0
  for (let i = 0; i < runs; i++) {
    // computeLevel memoizes on (nodes, config) REFERENCE identity — a fresh
    // config object per iteration defeats the cache so the timer measures a
    // real recompute, not a map lookup (round-3 finding: the gate had gone
    // vacuous, timing 0.0005 ms cache hits).
    const freshConfig = { ...config }
    const t0 = performance.now()
    const result = computeLevel(nodes, freshConfig)
    samples.push(performance.now() - t0)
    members = result.members.length
  }
  return { p95ms: p95(samples), members }
}

describe('compute memo (the perf fix that almost broke this gate)', () => {
  test('identical references hit the cache; any fresh object recomputes', () => {
    const nodes = synthesizeHouse(8)
    const config = allOnConfig()
    const first = computeLevel(nodes, config)
    expect(computeLevel(nodes, config)).toBe(first) // same reference = cached
    expect(computeLevel(nodes, { ...config })).not.toBe(first) // fresh = recomputed
  })
})

describe('performance gate (rubric: UI/UX/Performance)', () => {
  test('20-wall house, all systems, LOD 400: p95 < 50ms', () => {
    const { p95ms, members } = benchmark(20, 20)
    expect(members).toBeGreaterThan(300) // the bench is doing real work
    expect(p95ms).toBeLessThan(50)
  })

  test('60-wall house, all systems, LOD 400: p95 < 150ms', () => {
    const { p95ms, members } = benchmark(60, 10)
    expect(members).toBeGreaterThan(600)
    expect(p95ms).toBeLessThan(150)
  })
})
