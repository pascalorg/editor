import { Euler, Vector3 } from 'three'
import type { Fixture, Member } from '../core/types'

/**
 * Shared test harness: physical-continuity + geometry probes over routed
 * wiring. Lives outside the *.test.ts files so both the connectivity gate
 * and the openings gate can import it without double-registering suites.
 */

export const MERGE_TOL = 0.02
export const ATTACH_TOL = 0.03
/** Devices attach to their box stub's endpoint — tight, no fudge. */
export const DEVICE_TOL = 0.02

export function endpointsOf(m: Member): [Vector3, Vector3] {
  const axis = new Vector3(1, 0, 0)
    .applyEuler(new Euler(m.rotation[0], m.rotation[1], m.rotation[2], 'XYZ'))
    .multiplyScalar(
      (m.dims[0] >= Math.max(m.dims[1], m.dims[2]) ? m.dims[0] : m.dims[1]) / 2,
    )
  // vertical wires store length in dims[1]
  const vertical = m.dims[1] > m.dims[0]
  const a = new Vector3(...m.position)
  const half = vertical ? new Vector3(0, m.dims[1] / 2, 0) : axis
  return [a.clone().add(half), a.clone().sub(half)]
}

export function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a)
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())))
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)))
}

/**
 * Union-find over wire endpoints; returns the ids of devices NOT connected
 * to the panel component.
 */
export function unreachableDevices(
  members: Member[],
  fixtures: Fixture[],
): string[] {
  const wires = members.filter((m) => m.role === 'wire-run')
  const panel = fixtures.find((f) => f.kind === 'panel')
  if (!panel) return []
  const routed = fixtures.filter((f) => f !== panel && typeof f.meta?.circuit === 'string')

  const parent: number[] = wires.map((_, i) => i)
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

  const ends = wires.map(endpointsOf)
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
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
    for (let i = 0; i < wires.length; i++) {
      const [a, b] = ends[i] as [Vector3, Vector3]
      if (p.distanceTo(a) < tol || p.distanceTo(b) < tol || segDist(p, a, b) < tol) {
        comps.add(find(i))
      }
    }
    return comps
  }

  // Circuits run on per-circuit drill planes (12mm steps) so each homerun
  // is its OWN component — every one of them must touch the panel.
  const panelComps = componentsNear(new Vector3(...panel.position), 0.35)
  if (panelComps.size === 0) return routed.map((f) => f.sourceId)
  const out: string[] = []
  for (const f of routed) {
    const comps = componentsNear(new Vector3(...f.position), DEVICE_TOL)
    const connected = [...comps].some((c) => panelComps.has(c))
    if (!connected) out.push(`${f.kind}@${f.position.join(',')}`)
  }
  return out
}

/** Union-find continuity over the SE-cable members: true when `points` all
 * live in one connected cable component (street → meter → panel proofs). */
export function cableConnects(members: Member[], points: [number, number, number][]): boolean {
  const cable = members.filter((m) => m.sourceId === 'service-entrance')
  if (cable.length === 0) return false
  const parent = cable.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    return r
  }
  const ends = cable.map(endpointsOf)
  for (let i = 0; i < cable.length; i++) {
    for (let j = i + 1; j < cable.length; j++) {
      const [a1, a2] = ends[i] as [Vector3, Vector3]
      const [b1, b2] = ends[j] as [Vector3, Vector3]
      const touch =
        a1.distanceTo(b1) < 0.03 ||
        a1.distanceTo(b2) < 0.03 ||
        a2.distanceTo(b1) < 0.03 ||
        a2.distanceTo(b2) < 0.03 ||
        segDist(a1, b1, b2) < 0.03 ||
        segDist(a2, b1, b2) < 0.03
      if (touch) parent[find(i)] = find(j)
    }
  }
  const compAt = (p: [number, number, number]): number | null => {
    const v = new Vector3(p[0], p[1], p[2])
    for (let i = 0; i < cable.length; i++) {
      const [a, b] = ends[i] as [Vector3, Vector3]
      if (v.distanceTo(a) < 0.05 || v.distanceTo(b) < 0.05 || segDist(v, a, b) < 0.05) {
        return find(i)
      }
    }
    return null
  }
  const comps = points.map(compAt)
  return comps.every((c) => c !== null && c === comps[0])
}

