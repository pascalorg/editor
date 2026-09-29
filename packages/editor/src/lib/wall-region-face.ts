import {
  type AnyNode,
  getWallArcData,
  getWallCurveFrameAt,
  getWallFaceAtLocalPoint,
  getWallFaceOffsets,
  isCurvedWall,
  resolveLevelId,
  spatialGridManager,
  type WallFace,
  type WallNode,
  type WallSlabSupportSegment,
} from '@pascal-app/core'
import { getWallFinishData } from '@pascal-app/viewer'
import type { BufferGeometry } from 'three'
import { faceBaseAt, type WallFaceBaseRuns } from './wall-region-snap'

// Face geometry for the paint tool's wall regions, all in the wall mesh's local
// frame (x along the chord from the start, y up from the slab the mesh stands
// on, z toward the chord's left). A region's `u` is that local x, on straight
// and curved walls alike; its `v` is local y above the face's own base.

type WallShape = Pick<
  WallNode,
  'start' | 'end' | 'thickness' | 'justification' | 'curveOffset' | 'height'
>

export type WallFaceFrame = {
  face: WallFace
  length: number
  /** Straight wall: the face plane's local z. */
  z: number
  /** Curved wall: the face's circle in local xz and the side of its centre the face lies on. */
  arc: { cx: number; cz: number; radius: number; side: number } | null
}

export type WallFaceExtent = {
  /** Local x range the face covers (mitred ends reach past 0 and the length). */
  uMin: number
  uMax: number
  /** Local y of the face top. */
  top: number
}

type FaceBase = Record<WallFace, WallFaceBaseRuns> | null

function chordFrame(wall: Pick<WallNode, 'start' | 'end'>) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const tx = length > 1e-9 ? dx / length : 1
  const tz = length > 1e-9 ? dz / length : 0
  const toLocal = (x: number, z: number): [number, number] => {
    const ox = x - wall.start[0]
    const oz = z - wall.start[1]
    return [ox * tx + oz * tz, -ox * tz + oz * tx]
  }
  return { length, toLocal }
}

export function wallFaceFrame(wall: WallShape, face: WallFace): WallFaceFrame {
  const { length, toLocal } = chordFrame(wall)
  const offset = getWallFaceOffsets(wall)[face]
  const arc = isCurvedWall(wall) ? getWallArcData(wall) : null
  if (!arc) return { face, length, z: offset, arc: null }
  const [cx, cz] = toLocal(arc.center.x, arc.center.y)
  const mid = getWallCurveFrameAt(wall, 0.5).point
  const [, midZ] = toLocal(mid.x, mid.y)
  // Left of a counter-clockwise arc points at its centre (`getWallFaceAtLocalPoint`).
  const radius = arc.direction > 0 ? arc.radius - offset : arc.radius + offset
  return { face, length, z: offset, arc: { cx, cz, radius, side: midZ >= cz ? 1 : -1 } }
}

/** Local (x, z) of the face surface at station `u`. */
export function faceSurfaceXZ(frame: WallFaceFrame, u: number): [number, number] {
  const { arc } = frame
  if (!arc) return [u, frame.z]
  const dx = u - arc.cx
  return [u, arc.cz + arc.side * Math.sqrt(Math.max(0, arc.radius * arc.radius - dx * dx))]
}

/** Unit local xz normal pointing out of the face at station `u`. */
export function faceOutwardXZ(
  frame: WallFaceFrame,
  other: WallFaceFrame,
  u: number,
): [number, number] {
  const [x, z] = faceSurfaceXZ(frame, u)
  const [ox, oz] = faceSurfaceXZ(other, u)
  const length = Math.hypot(x - ox, z - oz)
  if (length < 1e-9) return [0, frame.face === 'a' ? 1 : -1]
  return [(x - ox) / length, (z - oz) / length]
}

/**
 * Where a local ray meets the face surface (infinite plane or cylinder), as
 * local (u, y). Null when the ray runs parallel or points away.
 */
export function projectLocalRayToFace(
  frame: WallFaceFrame,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): { u: number; y: number } | null {
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = direction
  if (!frame.arc) {
    if (Math.abs(dz) < 1e-9) return null
    const t = (frame.z - oz) / dz
    return t > 0 ? { u: ox + dx * t, y: oy + dy * t } : null
  }
  const { cx, cz, radius, side } = frame.arc
  const px = ox - cx
  const pz = oz - cz
  const a = dx * dx + dz * dz
  if (a < 1e-12) return null
  const b = 2 * (px * dx + pz * dz)
  const c = px * px + pz * pz - radius * radius
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const root = Math.sqrt(disc)
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t <= 0) continue
    // The circle's far half is not this face.
    if ((oz + dz * t - cz) * side < 0) continue
    return { u: ox + dx * t, y: oy + dy * t }
  }
  return null
}

/**
 * Face and (u, v) of a hit on the wall mesh, by the same rule as the paint
 * resolver (`resolveWallRole`): face from where the point lies, u = local x,
 * v = local y above that face's base at u.
 */
export function wallHitFaceUV(
  wall: Pick<WallNode, 'start' | 'end' | 'thickness' | 'justification' | 'curveOffset'>,
  localPosition: readonly [number, number, number],
  localNormal: readonly [number, number, number] | undefined,
  faceBase: FaceBase,
): { face: WallFace; u: number; v: number } | null {
  const face = getWallFaceAtLocalPoint(wall, localPosition, localNormal)
  if (!face) return null
  const u = localPosition[0]
  return { face, u, v: localPosition[1] - faceBaseAt(faceBase?.[face] ?? null, u) }
}

/** Local x of a support-segment parameter, as the wall renderer measures it. */
function stationX(wall: WallShape, t: number, length: number): number {
  if (!isCurvedWall(wall)) return t * length
  const point = getWallCurveFrameAt(wall, t).point
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  return ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / length
}

/**
 * Each face's base runs as the renderer measures region heights. A built wall
 * that carries finishes stores them on its geometry; a plain wall does not, so
 * they are derived the way its first region's rebuild will derive them — a
 * region drawn on a stepped face lands where it was drawn.
 */
export function resolveWallFaceBase(
  wall: WallNode,
  geometry: BufferGeometry | undefined | null,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): FaceBase {
  const data = getWallFinishData(geometry)
  if (data) return data.faceBase
  const cached = derivedFaceBase.get(wall)
  if (cached?.nodes === nodes) return cached.faceBase
  const faceBase = deriveWallFaceBase(wall, nodes)
  derivedFaceBase.set(wall, { nodes, faceBase })
  return faceBase
}

// The derivation runs the slab-support election, so a hovering pointer reuses
// it until the wall or the scene changes.
const derivedFaceBase = new WeakMap<
  WallNode,
  { nodes: Readonly<Record<string, AnyNode | undefined>>; faceBase: FaceBase }
>()

function deriveWallFaceBase(
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): FaceBase {
  const support = spatialGridManager.getSlabSupportForWall(
    resolveLevelId(wall, nodes as Record<string, AnyNode>),
    wall.start,
    wall.end,
    wall.curveOffset ?? 0,
    wall.thickness,
    wall.supportSlabId,
    undefined,
    wall.supportOffset,
    wall.justification,
  )
  const faceBase = support.faceDatum
  if (!faceBase) return null
  const same = [faceBase.a, faceBase.b].every(
    (segments) => JSON.stringify(segments) === JSON.stringify(support.baseSegments),
  )
  if (same) return null
  const { length } = chordFrame(wall)
  const runs = (segments: readonly WallSlabSupportSegment[]) =>
    segments
      .map((segment) => ({
        start: stationX(wall, segment.start, length),
        end: stationX(wall, segment.end, length),
        y: segment.elevation - support.elevation,
      }))
      .sort((left, right) => left.start - right.start)
  return { a: runs(faceBase.a), b: runs(faceBase.b) }
}

const extentCache = new WeakMap<BufferGeometry, Map<string, WallFaceExtent>>()

/** The face's local x range and top, read off the built geometry. */
export function wallFaceExtent(
  wall: WallShape,
  face: WallFace,
  geometry: BufferGeometry | undefined | null,
): WallFaceExtent {
  const frame = wallFaceFrame(wall, face)
  const fallback = { uMin: 0, uMax: frame.length, top: wall.height ?? 2.5 }
  const position = geometry?.getAttribute('position')
  if (!(geometry && position)) return fallback
  const key = `${face}:${frame.z}:${frame.arc?.radius ?? ''}`
  const cached = extentCache.get(geometry)?.get(key)
  if (cached) return cached
  let uMin = Number.POSITIVE_INFINITY
  let uMax = Number.NEGATIVE_INFINITY
  let top = Number.NEGATIVE_INFINITY
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const off = frame.arc
      ? Math.abs(Math.hypot(x - frame.arc.cx, z - frame.arc.cz) - frame.arc.radius)
      : Math.abs(z - frame.z)
    if (off > 3e-3) continue
    uMin = Math.min(uMin, x)
    uMax = Math.max(uMax, x)
    top = Math.max(top, position.getY(index))
  }
  const extent = Number.isFinite(top) && uMax > uMin ? { uMin, uMax, top } : fallback
  const perGeometry = extentCache.get(geometry) ?? new Map<string, WallFaceExtent>()
  perGeometry.set(key, extent)
  extentCache.set(geometry, perGeometry)
  return extent
}

/** A span of the face in region terms: absent bounds run to the face's edges. */
export type FaceSpan = { u0?: number; u1?: number; v0?: number; v1?: number }

type FaceStrip = { u0: number; u1: number; low: number; high: number }

/**
 * The span cut into pieces that each stand on one base run (and, on a curved
 * wall, short enough to follow the arc), with local y bottom and top.
 */
export function faceSpanStrips(
  frame: WallFaceFrame,
  extent: WallFaceExtent,
  runs: WallFaceBaseRuns,
  span: FaceSpan,
): FaceStrip[] {
  const start = Math.max(span.u0 ?? extent.uMin, extent.uMin)
  const end = Math.min(span.u1 ?? extent.uMax, extent.uMax)
  if (end - start < 1e-6) return []
  const stations = [start, end]
  for (const run of runs ?? [])
    for (const edge of [run.start, run.end]) if (edge > start && edge < end) stations.push(edge)
  if (frame.arc) {
    const pieces = Math.max(1, Math.ceil((end - start) / 0.1))
    for (let index = 1; index < pieces; index++)
      stations.push(start + ((end - start) * index) / pieces)
  }
  stations.sort((a, b) => a - b)
  const strips: FaceStrip[] = []
  for (let index = 0; index < stations.length - 1; index++) {
    const u0 = stations[index]!
    const u1 = stations[index + 1]!
    if (u1 - u0 < 1e-6) continue
    const base = faceBaseAt(runs, (u0 + u1) / 2)
    const low = Math.max(base + (span.v0 ?? 0), base)
    const high = Math.min(span.v1 === undefined ? extent.top : base + span.v1, extent.top)
    if (high - low > 1e-6) strips.push({ u0, u1, low, high })
  }
  return strips
}

function lift(frame: WallFaceFrame, other: WallFaceFrame, u: number, offset: number) {
  const [x, z] = faceSurfaceXZ(frame, u)
  const [nx, nz] = faceOutwardXZ(frame, other, u)
  return [x + nx * offset, z + nz * offset] as const
}

/** Triangles covering the strips, lifted `offset` metres off the face. */
export function faceStripTriangles(
  frame: WallFaceFrame,
  other: WallFaceFrame,
  strips: readonly FaceStrip[],
  offset: number,
): Float32Array {
  const out: number[] = []
  for (const { u0, u1, low, high } of strips) {
    const [ax, az] = lift(frame, other, u0, offset)
    const [bx, bz] = lift(frame, other, u1, offset)
    out.push(ax, low, az, bx, low, bz, bx, high, bz, ax, low, az, bx, high, bz, ax, high, az)
  }
  return new Float32Array(out)
}

/** Line segments around the strips' outline (steps included), lifted off the face. */
export function faceStripOutline(
  frame: WallFaceFrame,
  other: WallFaceFrame,
  strips: readonly FaceStrip[],
  offset: number,
): Float32Array {
  const out: number[] = []
  strips.forEach((strip, index) => {
    const [ax, az] = lift(frame, other, strip.u0, offset)
    const [bx, bz] = lift(frame, other, strip.u1, offset)
    out.push(ax, strip.low, az, bx, strip.low, bz, ax, strip.high, az, bx, strip.high, bz)
    const previous = strips[index - 1]
    if (!previous || Math.abs(previous.u1 - strip.u0) > 1e-6) {
      out.push(ax, strip.low, az, ax, strip.high, az)
    } else {
      if (Math.abs(previous.low - strip.low) > 1e-6)
        out.push(ax, previous.low, az, ax, strip.low, az)
      if (Math.abs(previous.high - strip.high) > 1e-6)
        out.push(ax, previous.high, az, ax, strip.high, az)
    }
    const next = strips[index + 1]
    if (!next || Math.abs(next.u0 - strip.u1) > 1e-6)
      out.push(bx, strip.low, bz, bx, strip.high, bz)
  })
  return new Float32Array(out)
}

/** Local position of face point (u, local y), lifted `offset` metres off the face. */
export function facePoint(
  frame: WallFaceFrame,
  other: WallFaceFrame,
  u: number,
  y: number,
  offset: number,
): [number, number, number] {
  const [x, z] = lift(frame, other, u, offset)
  return [x, y, z]
}
