import {
  type AnyNode,
  type AnyNodeId,
  collectLevelWallSegments,
  getScaledDimensions,
  type ItemNode,
  nearestWallSegment,
  useScene,
  WALL_SNAP_DISTANCE_M,
  type WallNode,
} from '@pascal-app/core'

/**
 * Shared helpers for the kinds whose 2D move snaps onto a wall in plan
 * space (door, window, item with `attachTo === 'wall' | 'wall-side'`).
 *
 * The 3D move tools listen to R3F `WallEvent`s (mesh-hit with normal)
 * for wall snapping. The 2D path doesn't have that — pointer events
 * land on the SVG layer, not on the wall meshes. This helper does the
 * equivalent plan-space projection: for each wall on the level, find
 * the perpendicular projection of the pointer onto the wall line and
 * pick the closest one within a reasonable range.
 *
 * Curved walls are excluded — the legacy door / window placement also
 * rejects curved walls (mitering + arc + opening would tear in 3D).
 */

export type WallHit = {
  wall: WallNode
  /** Distance along the wall from `start` (clamped to [0, length]). */
  localX: number
  /** Signed perpendicular distance from the wall axis (+ on the "front" side). */
  perpDistance: number
  /** Which face of the wall the pointer was on. */
  side: 'front' | 'back'
  /** Wall direction unit vector, x. */
  dirX: number
  /** Wall direction unit vector, y (== z in plan). */
  dirY: number
  /** Wall length in metres. */
  wallLength: number
  /**
   * Rotation around Y in **wall-local** space — 0 for the front face,
   * π for the back. Matches the 3D `calculateItemRotation(normal)`
   * convention (normal +Z → 0, normal -Z → π). Items / doors / windows
   * are children of the wall mesh, so their `rotation.y` is in the
   * wall's local frame; writing a world-space rotation here would mis-
   * orient the node by `wallRotation` (off by 90° on vertical walls).
   */
  itemRotation: number
}

export function projectWallLocalPointToPlan(
  wall: WallNode,
  localX: number,
  localZ = 0,
): [number, number] {
  const angle = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [wall.start[0] + localX * c + localZ * s, wall.start[1] - localX * s + localZ * c]
}

/**
 * Return the single closest wall under `parentLevelId` to `planPoint` — the
 * wall whose segment-Voronoi cell the point lies in — or `null` if nothing is
 * within `WALL_SNAP_DISTANCE_M`. `excludeWallId` skips a specific wall.
 *
 * The nearest-segment scan + curved-wall filter live in core
 * (`collectLevelWallSegments` / `nearestWallSegment`) so the editor's 2D
 * Voronoi debug overlay classifies points with the exact same math — the
 * overlay is then a faithful picture of where this snaps.
 */
export function findClosestWallInPlan(
  planPoint: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  parentLevelId: AnyNodeId | null,
  excludeWallId?: AnyNodeId,
): WallHit | null {
  const segments = collectLevelWallSegments(nodes, parentLevelId)
  const closest = nearestWallSegment(
    segments,
    planPoint[0],
    planPoint[1],
    WALL_SNAP_DISTANCE_M,
    excludeWallId,
  )
  if (!closest) return null

  const { segment, along, perp } = closest
  // Side determination, calibrated to the 3D wall convention. In wall-local
  // space the wall extends along +X and its +Z axis is the front-face normal;
  // `perp >= 0` is consistently the front side (see `closestOnSegment`).
  const side: 'front' | 'back' = perp >= 0 ? 'front' : 'back'
  // Wall-local rotation matching 3D `calculateItemRotation`: 0 front, π back.
  // The node is parented to the wall, so this composes with the wall's own
  // rotation at render — never a world-space rotation here.
  const itemRotation = side === 'front' ? 0 : Math.PI

  return {
    wall: segment.wall,
    localX: along,
    perpDistance: perp,
    side,
    dirX: segment.dirX,
    dirY: segment.dirY,
    wallLength: segment.length,
    itemRotation,
  }
}

/** Figma-style along-wall alignment threshold (meters) — parity with the
 *  XZ placement / move threshold. */
const ALONG_WALL_ALIGN_THRESHOLD_M = 0.08

/** The along-wall span of a wall-hosted node (door / window / wall item):
 *  its centre `localX` and half-width. `null` for kinds with no along-wall
 *  footprint. */
function wallAttachmentSpan(node: AnyNode): { center: number; half: number } | null {
  if (node.type === 'door' || node.type === 'window') {
    const n = node as { position: [number, number, number]; width: number }
    return { center: n.position[0], half: n.width / 2 }
  }
  if (node.type === 'item') {
    const item = node as ItemNode
    const attachTo = item.asset.attachTo
    if (attachTo !== 'wall' && attachTo !== 'wall-side') return null
    const [w] = getScaledDimensions(item)
    return { center: item.position[0], half: w / 2 }
  }
  return null
}

/**
 * Figma-style alignment for a wall-hosted opening / item, along the wall
 * axis. Snaps the moving node's edges (or centre) to other attachments'
 * edges/centres on the same wall, plus the wall ends. Edge-to-edge first,
 * so two doors line up flush.
 *
 * Returns the adjusted `localX` when a neighbour stop is within threshold,
 * or `null` when nothing aligns — callers treat `null` as "no alignment,
 * fall back to the grid snap". This lets along-wall alignment COMPETE with
 * the 0.5m grid (openings have arbitrary widths rarely on the grid, so
 * layering on top of the grid snap would almost never trigger).
 *
 * Snap-only for v1 — no guide is published (the floor-plan guide layer
 * renders XZ guides; an along-wall guide on a diagonal wall needs extra
 * projection work, deferred).
 */
export function snapLocalXToNeighbors(args: {
  wall: WallNode
  localX: number
  width: number
  selfId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  threshold?: number
}): number | null {
  const { wall, localX, width, selfId, nodes, threshold = ALONG_WALL_ALIGN_THRESHOLD_M } = args
  const half = width / 2
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])

  // Candidate stops along the wall: both ends + every other attachment's
  // edges and centre.
  const candidateStops: number[] = [0, wallLength]
  for (const node of Object.values(nodes)) {
    if (!node || node.id === selfId) continue
    if ((node as { parentId?: string }).parentId !== wall.id) continue
    const span = wallAttachmentSpan(node)
    if (!span) continue
    candidateStops.push(span.center - span.half, span.center, span.center + span.half)
  }

  // Moving stops: our two edges (edge-to-edge alignment) + centre.
  const movingStops = [localX - half, localX, localX + half]

  let bestDelta: number | null = null
  let bestAbs = threshold
  for (const ms of movingStops) {
    for (const cs of candidateStops) {
      const d = cs - ms
      const ad = Math.abs(d)
      if (ad <= bestAbs && (bestDelta === null || ad < bestAbs)) {
        bestAbs = ad
        bestDelta = d
      }
    }
  }

  return bestDelta === null ? null : localX + bestDelta
}

/**
 * Does a wall-hosted opening of `width × height` centred at `(clampedX,
 * clampedY)` (wall-local) overlap any OTHER child of `wallId` (door / window /
 * wall-mounted item)? AABB test in the wall's local face plane. `ignoreId`
 * excludes the moving node itself. Returns `true` (blocked) if the wall is
 * gone.
 *
 * Single source of truth for door + window placement collision — door-math and
 * window-math had byte-identical copies of this. Y conventions differ per kind
 * (items store bottom Y; doors/windows store centre Y), handled inline.
 */
export function hasWallChildOverlap(
  wallId: string,
  clampedX: number,
  clampedY: number,
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  const nodes = useScene.getState().nodes
  const wallNode = nodes[wallId as AnyNodeId] as WallNode | undefined
  if (!wallNode) return true
  const halfW = width / 2
  const halfH = height / 2
  const newBottom = clampedY - halfH
  const newTop = clampedY + halfH
  const newLeft = clampedX - halfW
  const newRight = clampedX + halfW

  for (const childId of Array.isArray(wallNode.children) ? wallNode.children : []) {
    if (childId === ignoreId) continue
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    let childLeft: number
    let childRight: number
    let childBottom: number
    let childTop: number

    if (child.type === 'item') {
      const item = child as ItemNode
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') continue
      const [w, h] = getScaledDimensions(item)
      childLeft = item.position[0] - w / 2
      childRight = item.position[0] + w / 2
      childBottom = item.position[1] // items store bottom Y
      childTop = item.position[1] + h
    } else if (child.type === 'window') {
      const win = child as { position: [number, number, number]; width: number; height: number }
      childLeft = win.position[0] - win.width / 2
      childRight = win.position[0] + win.width / 2
      childBottom = win.position[1] - win.height / 2 // windows store centre Y
      childTop = win.position[1] + win.height / 2
    } else if (child.type === 'door') {
      const door = child as { position: [number, number, number]; width: number; height: number }
      childLeft = door.position[0] - door.width / 2
      childRight = door.position[0] + door.width / 2
      childBottom = door.position[1] - door.height / 2 // doors store centre Y
      childTop = door.position[1] + door.height / 2
    } else {
      continue
    }

    const xOverlap = newLeft < childRight && newRight > childLeft
    const yOverlap = newBottom < childTop && newTop > childBottom
    if (xOverlap && yOverlap) return true
  }

  return false
}

/** Placement state for a wall-hosted opening — the SINGLE decision the preview
 *  tint and the commit gate both consume so they can never disagree. */
export type OpeningPlacement = {
  /** Geometric overlap with another wall child (independent of modifiers). */
  collides: boolean
  /** May the opening be committed here? `true` unless it collides and the user
   *  isn't force-placing. */
  placeable: boolean
  /** Ghost tint: green when placeable, red when not. */
  tint: 'valid' | 'invalid'
}

/**
 * Resolve the placement state from the raw collision result and whether the
 * user is force-placing (Shift). Force-place lifts the collision block, so the
 * opening becomes placeable AND the tint goes green — the preview and the
 * commit gate stay in lockstep because both read this one result.
 */
export function resolveOpeningPlacement(args: {
  collides: boolean
  forcePlace: boolean
}): OpeningPlacement {
  const placeable = !args.collides || args.forcePlace
  return {
    collides: args.collides,
    placeable,
    tint: placeable ? 'valid' : 'invalid',
  }
}
