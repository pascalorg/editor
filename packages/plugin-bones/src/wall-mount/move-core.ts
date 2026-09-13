import { inches } from '../core/units'
import { RECEPTACLE_HEIGHT_BAND, SWITCH_HEIGHT_BAND } from '../engines/electrical'
import {
  isMovedPosition,
  nearestUsableWall,
  SERVICE_BODY,
  usableWall,
  WALL_MOUNTED_TYPES,
  type WallGeom,
  wallAngle,
  wallGeom,
  wallPointAt,
} from '../service/placement'

/**
 * Pure math for the Bones wall-mount MOVE tool (move-tool.tsx) — the
 * window-parity slide for `bones:device` / `bones:service` nodes. Everything
 * here is headlessly testable; the React tool only wires events to these.
 *
 * The flow ROUTES THROUGH the engines (night-5's applyDeviceOverrides is the
 * plugin truth): the live preview publishes a `useLiveNodeOverrides` patch
 * whose `position` rides the wall axis — the same shape the parentFrame drag
 * used, so the renderer's moved-position path AND the framing renderer's
 * live recompute (framing/live.ts → computeLevel → applyDeviceOverrides)
 * both follow the gesture with the code-aware stud/blocking snap intact.
 * The commit writes the ANCHOR form (`wallId` + `wallT` + `heightAff`,
 * position reset to [0,0,0]) — exactly what the inspector sliders write and
 * what `extractDeviceOverrides` / `extractServiceOverrides` read.
 */

type LooseNode = Record<string, unknown>
type LooseNodes = Readonly<Record<string, LooseNode>>

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ─── #694 own-wall gate ──────────────────────────────────────────────
//
// While MOVING an existing node, a wall event may drive the drag only when
// the wall is one of the node's OWN walls (grab wall / current mid-drag
// host) — hidden or not — or when the wall is VISIBLE. An interposed HIDDEN
// wall between the camera and the node's wall must not capture the drag
// (and must not be stopPropagation'd, so the ray falls through to the own
// wall behind it). Mirrors the host's `shouldIgnoreWallEventForOpeningMove`
// truth table (packages/nodes shared/opening-move-wall-gate.ts, unexported).

export const shouldIgnoreWallEventForMove = ({
  eventWallId,
  eventWallHidden,
  ownWallIds,
}: {
  eventWallId: string
  eventWallHidden: boolean
  ownWallIds: ReadonlyArray<string | null | undefined>
}): boolean => eventWallHidden && !ownWallIds.includes(eventWallId)

// ─── Body + height rules ─────────────────────────────────────────────

/** Single-gang device box — matches the engine's DEVICE_BOX footprint and
 * the fixture the framing renderer instances. */
export const DEVICE_BODY_DIMS: readonly [number, number, number] = [
  inches(3),
  inches(4.5),
  inches(2.5),
]

/** Ghost body for the moving node: the engine box for devices, the
 * service body spec (placement.ts SERVICE_BODY) for service points. */
export function moveBodyDims(node: LooseNode): readonly [number, number, number] {
  if (node.type === 'bones:device') return DEVICE_BODY_DIMS
  const serviceType = typeof node.serviceType === 'string' ? node.serviceType : ''
  const body = (SERVICE_BODY as Record<string, { dims: readonly [number, number, number] }>)[
    serviceType
  ]
  return body ? body.dims : [0.2, 0.2, 0.15]
}

/**
 * Legal mount band (device CENTER, m AFF) for the moving node, or null when
 * the engines own the height entirely (service points). Devices pre-clamp to
 * the NEC band so the ghost, the commit, and the engine result agree — and
 * the engine's "height clamped" warning never fires for a plain drag
 * (night-5 height rule, engines/electrical.ts bands).
 */
export function heightBandFor(node: LooseNode): readonly [number, number] | null {
  if (node.type !== 'bones:device') return null
  return node.deviceKind === 'switch' ? SWITCH_HEIGHT_BAND : RECEPTACLE_HEIGHT_BAND
}

/** True when this node slides along a wall (device always; service only for
 * the wall-mounted types — floor types keep the planar ground move). */
export function isWallMountedMoveNode(node: LooseNode): boolean {
  if (node.type === 'bones:device') return true
  const serviceType = typeof node.serviceType === 'string' ? node.serviceType : ''
  return WALL_MOUNTED_TYPES.has(serviceType as never)
}

// ─── Wall-slide target resolution ────────────────────────────────────

export type WallMoveTarget = {
  kind: 'wall'
  wallId: string
  /** 0..1 along the wall from `start` — the anchor the commit writes. */
  t: number
  /** Mount height (node center, m AFF) — snapped + clamped. */
  heightAff: number
  /** On-axis plan point at `t` (level-local) — the live-override position. */
  plan: readonly [number, number]
  rotationY: number
  wallThickness: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Resolve a wall-surface cursor hit into a move target. `localX` is the
 * along-wall distance from the wall start (the wall event's
 * `localPosition[0]`), `localY` the height above the wall base
 * (`localPosition[1]`). `snap` is the mode-aware grid snap (the editor's
 * `snapToHalf` — identity when grid snap is off).
 */
export function resolveWallMoveTarget({
  wall,
  wallId,
  localX,
  localY,
  body,
  band,
  snap = (v) => v,
}: {
  wall: LooseNode
  wallId: string
  localX: number
  localY: number
  body: readonly [number, number, number]
  band: readonly [number, number] | null
  snap?: (value: number) => number
}): WallMoveTarget | null {
  const geom = wallGeom(wall)
  if (!geom) return null
  const length = Math.hypot(geom.end[0] - geom.start[0], geom.end[1] - geom.start[1])
  const halfW = Math.min(body[0] / 2, length / 2)
  const along = clamp(snap(localX), halfW, length - halfW)
  const t = clamp(along / length, 0, 1)
  const wallHeight = finite(wall.height) ? wall.height : 2.7
  const halfH = body[1] / 2
  const heightLimits: readonly [number, number] = band ?? [
    Math.min(halfH, wallHeight / 2),
    Math.max(wallHeight - halfH, wallHeight / 2),
  ]
  const heightAff = clamp(snap(localY), heightLimits[0], heightLimits[1])
  const [x, z] = wallPointAt(geom, t)
  return {
    kind: 'wall',
    wallId,
    t,
    heightAff,
    plan: [x, z],
    rotationY: wallAngle(geom),
    wallThickness: geom.thickness,
  }
}

/**
 * Floor-cursor fallback (the cursor is over open ground, not a wall face):
 * the node keeps riding the NEAREST usable wall — device/service semantics
 * (a wall-mounted box always lives on a wall; there is no off-wall drop).
 * Height is carried over from the last wall target / the node's own anchor.
 */
export function nearestWallMoveTarget({
  nodes,
  node,
  plan,
  heightAff,
  body,
  band,
  snap = (v) => v,
}: {
  nodes: LooseNodes
  node: LooseNode
  plan: readonly [number, number]
  heightAff: number
  body: readonly [number, number, number]
  band: readonly [number, number] | null
  snap?: (value: number) => number
}): WallMoveTarget | null {
  const hit = nearestUsableWall(
    nodes as Record<string, Record<string, unknown>>,
    node as { parentId?: string | null },
    plan,
  )
  if (!hit) return null
  const wall = nodes[hit.wallId]
  if (!wall) return null
  const length = Math.hypot(
    hit.geom.end[0] - hit.geom.start[0],
    hit.geom.end[1] - hit.geom.start[1],
  )
  return resolveWallMoveTarget({
    wall,
    wallId: hit.wallId,
    localX: hit.t * length,
    localY: heightAff,
    body,
    band,
    snap,
  })
}

// ─── Preview + commit shapes ─────────────────────────────────────────

/** Tiny non-zero Y so the override position NEVER reads as the [0,0,0]
 * "never moved" sentinel (isMovedPosition) — even when the on-axis plan
 * point crosses the level origin. Renderer + engines only consume [x,z]. */
const OVERRIDE_Y = 1e-4

/**
 * The per-frame `useLiveNodeOverrides` patch. Position rides the wall AXIS
 * (the renderer's moved-position path re-resolves the same wall; the framing
 * live recompute routes it through applyDeviceOverrides for the stud snap).
 */
export function wallLiveOverride(target: WallMoveTarget): Record<string, unknown> {
  return {
    position: [target.plan[0], OVERRIDE_Y, target.plan[1]],
    heightAff: target.heightAff,
  }
}

/**
 * The gesture's ONE committed write: the anchor form. Position resets to the
 * [0,0,0] sentinel so the wall anchor is authoritative after every drag —
 * the reconciler's normalization branch stays dead (device/place.ts) and
 * `isMovedDeviceNode` reads the override from wallT/heightAff vs seed.
 */
export function wallCommitPatch(target: WallMoveTarget): Record<string, unknown> {
  return {
    wallId: target.wallId,
    wallT: target.t,
    heightAff: target.heightAff,
    position: [0, 0, 0],
  }
}

export type FloorMoveTarget = {
  kind: 'floor'
  plan: readonly [number, number]
}

/** Grid-snapped planar target for floor-placed service points. */
export function floorMoveTarget(
  plan: readonly [number, number],
  snap: (value: number) => number = (v) => v,
): FloorMoveTarget {
  return { kind: 'floor', plan: [snap(plan[0]), snap(plan[1])] }
}

export function floorLiveOverride(target: FloorMoveTarget): Record<string, unknown> {
  return { position: [target.plan[0], OVERRIDE_Y, target.plan[1]] }
}

/** Floor commit: position IS the anchor for floor types. Guard the origin —
 * exactly [0,0,0] would read as "never moved" and snap back to the wall
 * anchor, so keep the epsilon Y there. */
export function floorCommitPatch(target: FloorMoveTarget): Record<string, unknown> {
  const [x, z] = target.plan
  const y = Math.abs(x) <= 1e-6 && Math.abs(z) <= 1e-6 ? OVERRIDE_Y : 0
  return { position: [x, y, z] }
}

// ─── Grab-time anchor resolution ─────────────────────────────────────

/**
 * Where the node currently rides: its resolved wall + height. Mirrors the
 * renderer precedence (moved position → nearest wall; else stored anchor).
 * Used to seed the own-wall gate and the pre-first-move height.
 */
export function currentWallAnchor(
  nodes: LooseNodes,
  node: LooseNode,
): { wallId: string | null; heightAff: number } {
  const band = heightBandFor(node)
  const fallbackHeight = ((): number => {
    if (finite(node.heightAff)) return node.heightAff
    if (node.type === 'bones:device') {
      return node.deviceKind === 'switch' ? inches(48) : inches(15)
    }
    const serviceType = typeof node.serviceType === 'string' ? node.serviceType : ''
    const body = (SERVICE_BODY as Record<string, { defaultAff: number }>)[serviceType]
    return body ? body.defaultAff : 1
  })()
  const heightAff = band ? clamp(fallbackHeight, band[0], band[1]) : fallbackHeight

  const position = node.position as readonly unknown[] | undefined
  if (isMovedPosition(position)) {
    const p = position as readonly [number, number, number]
    const hit = nearestUsableWall(
      nodes as Record<string, Record<string, unknown>>,
      node as { parentId?: string | null },
      [p[0], p[2]],
    )
    return { wallId: hit ? hit.wallId : null, heightAff }
  }
  const wall = typeof node.wallId === 'string' ? nodes[node.wallId] : undefined
  const usable = wall ? usableWall(wall, node as { parentId?: string | null }) : null
  return { wallId: usable ? (node.wallId as string) : null, heightAff }
}

/** Re-export for the tool's curved/degenerate-wall gate. */
export type { WallGeom }
export { wallGeom }
