import type {
  AnyNodeId,
  DownspoutNode,
  GutterNode,
  RoofSegmentNode,
  SceneApi,
} from '@pascal-app/core'
import { EAVE_TUCK_INWARD } from '../gutter/eave-snap'
import { resolveGutterOutletById } from '../gutter/outlet-lookup'
import {
  type OutletDims,
  type OutletShape,
  outletDims,
  profileFloorMidZ,
} from '../gutter/profile-geometry'

/**
 * Routing parameters that turn the downspout from a straight drop into
 * a pipe that actually returns to the wall. Derived from the host
 * gutter + its roof segment — the geometry builder stays pure (takes
 * this as data) so the renderer, the placement preview, and the handle
 * descriptors can all feed it the same numbers.
 */
export type DownspoutRouting = {
  /**
   * Distance the pipe must travel toward the wall (downspout-local −Z)
   * to leave the eave overhang and sit flat against the fascia. The
   * outlet hangs `overhang − tuck` outboard of the wall face, plus the
   * `floorMidZ` offset of the outlet within the trough — so the offset
   * elbow at the top steps the pipe back by exactly this much.
   */
  wallJog: number
  /** Cross-section the pipe takes — round on half-round, rect on k-style / box. */
  shape: OutletShape
  /**
   * Inner half-extents of the gutter's drilled collar (along-length X,
   * outward Z). The pipe's cross-section is clamped just under these so
   * it slip-fits up inside the collar instead of sharing a coincident
   * surface with it (the old pipe sat at exactly the bore and z-fought
   * the collar wall).
   */
  collarHalfX: number
  collarHalfZ: number
}

/**
 * Pure routing from resolved nodes — used by the renderer / preview /
 * tool, which already hold the effective gutter + segment.
 */
export function computeDownspoutRouting(
  gutter: GutterNode,
  segment: Pick<RoofSegmentNode, 'overhang'>,
  outletId: string | undefined,
): DownspoutRouting | null {
  const outlet = resolveGutterOutletById(gutter, outletId)
  if (!outlet) return null

  const overhang = segment.overhang ?? 0
  const floorMidZ = profileFloorMidZ(gutter.profile ?? 'k-style', Math.max(0.04, gutter.size))
  // The gutter rim is tucked `EAVE_TUCK_INWARD` back from the very tip
  // of the overhang, so the real outboard distance is `overhang − tuck`
  // (never negative — a flush eave still leaves the floorMidZ offset).
  const wallJog = Math.max(0, overhang - EAVE_TUCK_INWARD) + floorMidZ

  return {
    wallJog,
    shape: outlet.shape,
    collarHalfX: outlet.innerHalfX,
    collarHalfZ: outlet.innerHalfZ,
  }
}

/**
 * Routing for the handle descriptors, which only get `(node, sceneApi)`.
 * Walks downspout → gutter → segment through the scene snapshot.
 */
export function resolveDownspoutRouting(
  node: DownspoutNode,
  sceneApi: SceneApi,
): DownspoutRouting | null {
  if (!node.gutterId) return null
  const gutter = sceneApi.get<GutterNode>(node.gutterId as AnyNodeId)
  if (gutter?.type !== 'gutter') return null
  const segment = gutter.roofSegmentId
    ? sceneApi.get<RoofSegmentNode>(gutter.roofSegmentId as AnyNodeId)
    : undefined
  return computeDownspoutRouting(gutter, segment ?? { overhang: 0 }, node.outletId)
}

// ─── Pipe cross-section + effective jog ──────────────────────────────

// Slip-fit clearance — when the pipe lands within this of the collar
// bore (the placement default, where pipe == hole), nudge it just inside
// so it doesn't share a coincident wall (the old z-fighting).
const NEAR_BORE = 0.002
const SLIP_CLEARANCE = 0.0005

function nestUnder(half: number, collar: number | undefined): number {
  if (collar !== undefined && Math.abs(half - collar) < NEAR_BORE) {
    return Math.max(0.005, collar - SLIP_CLEARANCE)
  }
  return half
}

/**
 * Rendered pipe cross-section — round (halfX = halfZ = radius) or rect,
 * following the host gutter's profile. Defaults to `diameter`-sized, but
 * each half-extent that lands within a hair of the collar's matching
 * bore is nudged just inside so the pipe slip-fits the collar instead of
 * sharing a coincident wall. A deliberately larger / smaller pipe is
 * left alone, so the diameter field stays honest.
 */
export function downspoutPipeDims(
  node: Pick<DownspoutNode, 'diameter' | 'shape'>,
  routing?: DownspoutRouting | null,
): OutletDims {
  // 'auto' follows the gutter profile; 'round' / 'rect' override it.
  const shape: OutletShape =
    node.shape && node.shape !== 'auto' ? node.shape : (routing?.shape ?? 'round')
  const dims = outletDims(shape, node.diameter)
  if (!routing) return dims
  return {
    shape,
    halfX: nestUnder(dims.halfX, routing.collarHalfX),
    halfZ: nestUnder(dims.halfZ, routing.collarHalfZ),
  }
}

/**
 * The −Z distance the wall run actually sits at. The raw `wallJog`
 * reaches the wall *face*; we pull back by the pipe's outward half-depth
 * (so the pipe's surface — not its centerline — meets the wall) plus the
 * `standoff` (bracket gap / overshoot escape hatch), so the pipe sits
 * proud of the wall instead of burying into it.
 */
export function effectiveWallJog(
  node: Pick<DownspoutNode, 'diameter' | 'standoff' | 'shape'>,
  routing?: DownspoutRouting | null,
): number {
  if (!routing) return 0
  const dims = downspoutPipeDims(node, routing)
  return Math.max(0, routing.wallJog - dims.halfZ - (node.standoff ?? 0))
}

// ─── Centerline path ─────────────────────────────────────────────────

// Vertical drop straight out of the collar before the offset elbow.
const TOP_DROP = 0.05
// Bottom kickout: how far the mouth throws outward (+Z) and how tall
// the kicked section is. Skipped when the pipe is too short to fit it.
const KICK_OUT = 0.08
const KICK_RISE = 0.1

export type DownspoutPath = {
  /** Centerline points, top → bottom, in downspout-local space. */
  points: [number, number, number][]
  /** Bottom mouth — the kicked-out pipe end. */
  bottom: [number, number, number]
  /** Z of the vertical wall run (downspout-local; −jog). */
  wallRunZ: number
  /** Y at the top of the straight wall run (just below the offset elbow). */
  wallRunTopY: number
  /** Y at the bottom of the straight wall run (just above the kickout). */
  wallRunBottomY: number
}

/**
 * Pure centerline of the routed pipe. Shared by the geometry builder
 * (sweeps a cylinder along it) and the handle descriptors (place the
 * length cube at `bottom`), so the dimension chrome can never drift
 * from the mesh.
 *
 * Local frame: Y = 0 at the gutter floor, −Y down, −Z toward the wall.
 * The four legs are the vertical drop out of the collar, the offset
 * elbow stepping back to the wall, the wall run, and the kickout.
 */
export function computeDownspoutPath(length: number, jog: number, allowKick = true): DownspoutPath {
  const len = Math.max(0.1, length)
  const j = Math.max(0, jog)
  const drop = Math.min(TOP_DROP, len * 0.15)
  // Offset elbow runs at ~45° (vertical travel == horizontal jog) but
  // never eats more than what's left after the drop + a minimum run.
  const elbowVert = Math.min(j, Math.max(0, len - drop - 0.1))
  const afterElbow = len - drop - elbowVert
  // `allowKick` off (terminal 'straight') runs the pipe straight to the
  // bottom — no kickout leg.
  const kick = allowKick && afterElbow > KICK_RISE * 1.5
  const kickRise = kick ? Math.min(KICK_RISE, afterElbow * 0.3) : 0
  const kickOut = kick ? KICK_OUT : 0

  const wallRunTopY = -drop - elbowVert
  const wallRunBottomY = -len + kickRise
  const bottom: [number, number, number] = [0, -len, -j + kickOut]
  return {
    points: [
      [0, 0, 0], // collar mouth
      [0, -drop, 0], // bottom of the first drop
      [0, wallRunTopY, -j], // offset elbow, now at the wall
      [0, wallRunBottomY, -j], // bottom of the wall run
      bottom, // kicked mouth
    ],
    bottom,
    wallRunZ: -j,
    wallRunTopY,
    wallRunBottomY,
  }
}
