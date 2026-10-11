import { ROOM_TYPES, type UnitLayout, type UnitSpace } from './unit-layout'

/**
 * Funnel stage 4: near-duplicates out. A layout's features are a raster of room kinds (areas,
 * positions and adjacency at once) and its door cells; two layouts are near-duplicates when few
 * cells differ. Greedy and order-preserving: the first of a cluster stays.
 */

export type DedupeOptions = { cell?: number; threshold?: number }

/** Grid cell (m), and the share of differing cells under which two layouts are one. */
export const DEDUPE = { cell: 0.25, threshold: 0.1 }

type Signature = { kinds: Uint8Array; doors: Set<number> }

function signature(layout: UnitLayout, space: UnitSpace, cell: number): Signature {
  const xs = space.outline.map((p) => p[0])
  const zs = space.outline.map((p) => p[1])
  const x0 = Math.min(...xs)
  const z0 = Math.min(...zs)
  const nx = Math.ceil((Math.max(...xs) - x0) / cell)
  const nz = Math.ceil((Math.max(...zs) - z0) / cell)
  const kinds = new Uint8Array(nx * nz)
  for (const room of layout.rooms) {
    const code = ROOM_TYPES.indexOf(room.type) + 1
    for (const [rx0, rz0, rx1, rz1] of room.rects)
      for (
        let j = Math.max(0, Math.floor((rz0 - z0) / cell));
        j < Math.min(nz, Math.ceil((rz1 - z0) / cell));
        j++
      )
        for (
          let i = Math.max(0, Math.floor((rx0 - x0) / cell));
          i < Math.min(nx, Math.ceil((rx1 - x0) / cell));
          i++
        ) {
          const cx = x0 + (i + 0.5) * cell
          const cz = z0 + (j + 0.5) * cell
          if (cx > rx0 && cx < rx1 && cz > rz0 && cz < rz1) kinds[j * nx + i] = code
        }
  }
  const doors = new Set(
    [...layout.doors, layout.entry].map(
      (d) => Math.floor((d.at[1] - z0) / cell) * nx + Math.floor((d.at[0] - x0) / cell),
    ),
  )
  return { kinds, doors }
}

function distance(p: Signature, q: Signature) {
  let differ = 0
  let inside = 0
  for (let i = 0; i < p.kinds.length; i++) {
    if (!(p.kinds[i] || q.kinds[i])) continue
    inside++
    if (p.kinds[i] !== q.kinds[i]) differ++
  }
  let doors = 0
  for (const d of p.doors) if (!q.doors.has(d)) doors++
  for (const d of q.doors) if (!p.doors.has(d)) doors++
  return differ / Math.max(1, inside) + doors / Math.max(1, (p.doors.size + q.doors.size) * 4)
}

/** How different two layouts are, 0 (the same) to 1: the share of differing cells, plus doors. */
export function layoutDistance(p: UnitLayout, q: UnitLayout, space: UnitSpace, cell = DEDUPE.cell) {
  return Math.min(1, distance(signature(p, space, cell), signature(q, space, cell)))
}

export function dedupeLayouts(
  layouts: readonly UnitLayout[],
  space: UnitSpace,
  { cell = DEDUPE.cell, threshold = DEDUPE.threshold }: DedupeOptions = {},
): UnitLayout[] {
  const kept: { layout: UnitLayout; sig: Signature }[] = []
  for (const layout of layouts) {
    const sig = signature(layout, space, cell)
    if (kept.some((k) => distance(k.sig, sig) < threshold)) continue
    kept.push({ layout, sig })
  }
  return kept.map((k) => k.layout)
}
