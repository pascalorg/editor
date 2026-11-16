import { heightAt, type TerrainField } from '@pascal-app/core'
import type { RampGroundCut } from './ramp-ground-holes'
import type { TerrainHoleBoundary } from './terrain-holes'

export type RampCutFaceBuffers = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/** A rim edge is the ground's own cut edge when its midpoint lies on the cut's ring (to the clipper's 0.1 mm lattice). */
const ON_RING_M = 2e-4

function ringDistance(ring: readonly (readonly [number, number])[], x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i] as readonly [number, number]
    const [x1, z1] = ring[(i + 1) % ring.length] as readonly [number, number]
    const dx = x1 - x0
    const dz = z1 - z0
    const length2 = dx * dx + dz * dz
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length2))
    nearest = Math.min(nearest, Math.hypot(x - x0 - t * dx, z - z0 - t * dz))
  }
  return nearest
}

type End = { x: number; z: number; ground: number; top: number; bottom: number }

/**
 * The soil face that closes a ground cut against the roadway beside it.
 *
 * Where the ground stands above the roadway's side (its wall top, or the deck where there is no
 * wall) the face runs from that side up to the ground; where the ground lies below the deck's
 * underside it runs from the ground up to the underside. Between the two the roadway's own side
 * meets the ground and there is nothing to close. The face is built on the ground's own cut edge,
 * vertex for vertex, so it closes against the ground without a gap.
 */
export function rampCutFaces(
  boundary: TerrainHoleBoundary,
  cuts: readonly RampGroundCut[],
  field: TerrainField,
): RampCutFaceBuffers | null {
  if (!cuts.length || !boundary.rim.length) return null
  const { points } = boundary
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // One piece of face on the rim edge from `from` to `to`: `high` and `low` are each end's
  // upper and lower heights, kept only where the upper is above the lower.
  const piece = (
    from: End,
    to: End,
    high: (end: End) => number,
    low: (end: End) => number,
    normal: [number, number],
  ) => {
    const dA = high(from) - low(from)
    const dB = high(to) - low(to)
    if (dA <= 0 && dB <= 0) return
    const at = (t: number) => {
      const x = from.x + (to.x - from.x) * t
      const z = from.z + (to.z - from.z) * t
      const h = high(from) + (high(to) - high(from)) * t
      const l = low(from) + (low(to) - low(from)) * t
      return { x, z, h, l }
    }
    // The vertices of the piece, in order along the edge: the top edge, then back along the bottom.
    let corners: { x: number; z: number; y: number }[]
    if (dA > 0 && dB > 0) {
      const a = at(0)
      const b = at(1)
      corners = [
        { x: a.x, z: a.z, y: a.h },
        { x: b.x, z: b.z, y: b.h },
        { x: b.x, z: b.z, y: b.l },
        { x: a.x, z: a.z, y: a.l },
      ]
    } else {
      // The face closes to nothing where upper and lower cross.
      const t = dA / (dA - dB)
      const cross = at(t)
      const end = dA > 0 ? at(0) : at(1)
      corners = [
        { x: end.x, z: end.z, y: end.h },
        { x: cross.x, z: cross.z, y: cross.h },
        { x: end.x, z: end.z, y: end.l },
      ]
    }
    const along = (x: number, z: number) => x * -normal[1] + z * normal[0]
    const base = positions.length / 3
    for (const corner of corners) {
      positions.push(corner.x, corner.y, corner.z)
      normals.push(normal[0], 0, normal[1])
      uvs.push(along(corner.x, corner.z), corner.y)
    }
    // Wound so the face looks toward the roadway, the way its normal points.
    const first = corners[0] as { x: number; z: number; y: number }
    const second = corners[1] as { x: number; z: number; y: number }
    const last = corners[corners.length - 1] as { x: number; z: number; y: number }
    const ux = second.x - first.x
    const uy = second.y - first.y
    const uz = second.z - first.z
    const vx = last.x - first.x
    const vy = last.y - first.y
    const vz = last.z - first.z
    const facing = (uy * vz - uz * vy) * normal[0] + (ux * vy - uy * vx) * normal[1]
    const order = facing >= 0 ? [0, 1, 2] : [0, 2, 1]
    for (let i = 1; i < corners.length - 1; i++) {
      const triangle = [0, i, i + 1]
      for (const k of order) indices.push(base + (triangle[k] as number))
    }
  }

  for (const { a, b } of boundary.rim) {
    const [ax, az] = points[a] as [number, number]
    const [bx, bz] = points[b] as [number, number]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-9) continue
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    const cut = cuts.find((candidate) => ringDistance(candidate.ring, mx, mz) <= ON_RING_M)
    if (!cut) continue
    const [sa, sb] = [cut.structureAt(ax, az), cut.structureAt(bx, bz)]
    if (!sa || !sb) continue
    const from: End = {
      x: ax,
      z: az,
      ground: heightAt(field, ax, az),
      top: sa.top,
      bottom: sa.bottom,
    }
    const to: End = {
      x: bx,
      z: bz,
      ground: heightAt(field, bx, bz),
      top: sb.top,
      bottom: sb.bottom,
    }
    // The ground is on this edge's left, so the roadway is on its right: (dz, -dx).
    const normal: [number, number] = [(bz - az) / length, -(bx - ax) / length]
    piece(
      from,
      to,
      (end) => end.ground,
      (end) => end.top,
      normal,
    )
    piece(
      from,
      to,
      (end) => end.bottom,
      (end) => end.ground,
      normal,
    )
  }
  if (!indices.length) return null
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  }
}
