import { expect } from 'bun:test'
import { Vector3 } from 'three'
import type { Fixture, Member } from '../core/types'
import { endpointsOf, segDist } from './electrical.test-helpers'

/**
 * Shared plumbing test harness (extracted from plumbing.connectivity.test.ts
 * so the service-override gate can reuse it without double-registering
 * suites): supply reachability union-find, the strictly-downhill drain walk,
 * and the level-drain (missing pitch) probe.
 */

export const MERGE_TOL = 0.02
export const ATTACH_TOL = 0.03

/**
 * unreachableDevices adapted for plumbing: pipes are pre-filtered by system
 * prefix (cold-/hot-/dwv-), the source is a point (meter or WH — not a
 * panel fixture), and targets carry their own attach tolerance.
 */
export function unreachableFrom(
  pipes: Member[],
  source: readonly [number, number, number],
  sourceTol: number,
  targets: { id: string; position: readonly [number, number, number] }[],
  targetTol: number,
): string[] {
  const parent: number[] = pipes.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    let c = i
    while (parent[c] !== c) {
      const n = parent[c] as number
      parent[c] = r
      c = n
    }
    return r
  }
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }
  const ends = pipes.map(endpointsOf)
  for (let i = 0; i < pipes.length; i++) {
    for (let j = i + 1; j < pipes.length; j++) {
      const [a1, a2] = ends[i] as [Vector3, Vector3]
      const [b1, b2] = ends[j] as [Vector3, Vector3]
      const touch =
        a1.distanceTo(b1) < MERGE_TOL ||
        a1.distanceTo(b2) < MERGE_TOL ||
        a2.distanceTo(b1) < MERGE_TOL ||
        a2.distanceTo(b2) < MERGE_TOL ||
        segDist(a1, b1, b2) < ATTACH_TOL ||
        segDist(a2, b1, b2) < ATTACH_TOL ||
        segDist(b1, a1, a2) < ATTACH_TOL ||
        segDist(b2, a1, a2) < ATTACH_TOL
      if (touch) union(i, j)
    }
  }
  const componentsNear = (p: Vector3, tol: number): Set<number> => {
    const comps = new Set<number>()
    for (let i = 0; i < pipes.length; i++) {
      const [a, b] = ends[i] as [Vector3, Vector3]
      if (p.distanceTo(a) < tol || p.distanceTo(b) < tol || segDist(p, a, b) < tol) {
        comps.add(find(i))
      }
    }
    return comps
  }
  const sourceComps = componentsNear(new Vector3(...source), sourceTol)
  if (sourceComps.size === 0) return targets.map((t) => t.id)
  const out: string[] = []
  for (const t of targets) {
    const comps = componentsNear(new Vector3(...t.position), targetTol)
    if (![...comps].some((c) => sourceComps.has(c))) out.push(t.id)
  }
  return out
}

export const byPrefix = (members: Member[], prefix: string): Member[] =>
  members.filter((m) => m.role === 'pipe-run' && m.sourceId.startsWith(prefix))

export const stubs = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'stub-out')

export function checkSupply(members: Member[], fixtures: Fixture[]): void {
  const meter = fixtures.find((f) => f.kind === 'water-meter') as Fixture
  const wh = fixtures.find((f) => f.kind === 'water-heater') as Fixture
  expect(meter).toBeDefined()
  expect(wh).toBeDefined()
  const targets = stubs(fixtures).map((f) => ({ id: String(f.meta?.fixtureId), position: f.position }))
  const hotTargets = stubs(fixtures)
    .filter((f) => f.meta?.hot === true)
    .map((f) => ({ id: String(f.meta?.fixtureId), position: f.position }))
  expect(unreachableFrom(byPrefix(members, 'cold-'), meter.position, 0.12, targets, 0.03)).toEqual([])
  // hot drops land in the same bay nudged 1" off the cold drop
  expect(unreachableFrom(byPrefix(members, 'hot-'), wh.position, 0.35, hotTargets, 0.08)).toEqual([])
}

/**
 * Directed walk over the DWV tree (vents excluded): edges only traverse from
 * the higher member end to the lower, so reaching the sewer exit PROVES the
 * path falls monotonically. Returns fixture ids whose trap never gets there.
 */
export function drainFailures(members: Member[], fixtureIds: string[]): string[] {
  const drains = members.filter(
    (m) =>
      m.role === 'pipe-run' && m.sourceId.startsWith('dwv-') && !m.sourceId.startsWith('dwv-vent'),
  )
  const NODE_TOL = 0.07
  const pts: Vector3[] = []
  const nodeOf = (p: Vector3): number => {
    for (let i = 0; i < pts.length; i++) {
      if ((pts[i] as Vector3).distanceTo(p) < NODE_TOL) return i
    }
    pts.push(p)
    return pts.length - 1
  }
  const edges = new Map<number, number[]>()
  const addEdge = (a: number, b: number) => {
    const list = edges.get(a) ?? []
    list.push(b)
    edges.set(a, list)
  }
  const topOf = new Map<string, number>() // sourceId → highest node
  for (const m of drains) {
    const [a, b] = endpointsOf(m)
    const hi = a.y >= b.y ? a : b
    const lo = a.y >= b.y ? b : a
    const hn = nodeOf(hi)
    const ln = nodeOf(lo)
    addEdge(hn, ln) // downhill only
    if (Math.abs(hi.y - lo.y) < 1e-9) addEdge(ln, hn) // dead level (risers/arms never are)
    const prev = topOf.get(m.sourceId)
    if (prev === undefined || (pts[prev] as Vector3).y < hi.y) topOf.set(m.sourceId, hn)
  }
  // exit = the LOW end of the building drain
  const mains = drains.filter((m) => m.sourceId === 'dwv-main')
  expect(mains.length).toBeGreaterThan(0)
  let exitNode = -1
  let exitY = Number.POSITIVE_INFINITY
  for (const m of mains) {
    for (const p of endpointsOf(m)) {
      if (p.y < exitY) {
        exitY = p.y
        exitNode = nodeOf(p)
      }
    }
  }
  const reaches = (start: number): boolean => {
    const seen = new Set<number>([start])
    const queue = [start]
    while (queue.length > 0) {
      const n = queue.shift() as number
      if (n === exitNode) return true
      for (const next of edges.get(n) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    return false
  }
  const failures: string[] = []
  for (const id of fixtureIds) {
    const start = topOf.get(`dwv-trap-${id}`)
    if (start === undefined || !reaches(start)) failures.push(id)
  }
  return failures
}

/** Every horizontal drain leg must carry a real pitch (P3005.3). */
export function levelDrains(members: Member[]): string[] {
  return members
    .filter(
      (m) =>
        m.role === 'pipe-run' &&
        m.sourceId.startsWith('dwv-') &&
        !m.sourceId.startsWith('dwv-vent') &&
        m.dims[0] > m.dims[1] &&
        m.length > 0.06,
    )
    .filter((m) => Math.abs(m.rotation[2]) < 1e-9)
    .map((m) => `${m.label ?? m.sourceId}`)
}

/** The LOWEST endpoint of the building drain — where the sewer leaves. */
export function buildingDrainExit(members: Member[]): Vector3 | null {
  let exit: Vector3 | null = null
  for (const m of members) {
    if (m.sourceId !== 'dwv-main' || m.role !== 'pipe-run') continue
    for (const p of endpointsOf(m)) {
      if (!exit || p.y < exit.y) exit = p
    }
  }
  return exit
}

/**
 * R1 (round-2 skeptic): the through-roof stack must physically TIE INTO the
 * drainage tree (P3104) — stopping it at the floor line severed it from the
 * inboard sleeved drop on every placed scene. Returns the minimum
 * segment-to-segment gap between any vent-stack member and the DWV drain
 * runs (vents excluded); connected trees measure ≤ ATTACH_TOL.
 */
export function stackToTreeGap(members: Member[]): number {
  const stacks = members.filter((m) => m.role === 'vent-stack')
  const drains = members.filter(
    (m) =>
      m.role === 'pipe-run' && m.sourceId.startsWith('dwv-') && !m.sourceId.startsWith('dwv-vent'),
  )
  let best = Number.POSITIVE_INFINITY
  for (const s of stacks) {
    const [s1, s2] = endpointsOf(s)
    for (const d of drains) {
      const [d1, d2] = endpointsOf(d)
      best = Math.min(
        best,
        segDist(d1, s1, s2),
        segDist(d2, s1, s2),
        segDist(s1, d1, d2),
        segDist(s2, d1, d2),
      )
    }
  }
  return best
}
