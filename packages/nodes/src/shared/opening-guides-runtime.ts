// Runtime glue between the pure `computeOpeningGuides` geometry (core) and the
// editor's 3D guide store, used by the door/window move + placement tools. Lives
// in `nodes` (not core) because it talks to the editor store; kept thin so each
// tool's per-tick hook is a single call.

import {
  type AnyNode,
  type AnyNodeId,
  computeOpeningGuides,
  detectVerticalAlignment,
  type OpeningSpan,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type OpeningGuide3D, useOpeningGuides } from '@pascal-app/editor'

// Parity with `snapLocalXToNeighbors`' along-wall threshold.
const SILL_SNAP_THRESHOLD_M = 0.08
// Hide a dimension that has collapsed to nothing (sill flush to the floor, or
// head flush to the wall top) so it doesn't render a zero-length "0m" pill.
const MIN_DIMENSION_M = 0.02

/** Maps a wall-local point (s along the wall, y above the wall base) to the move
 *  tool's render frame — the caller passes its own `wallLocalToWorld` closure so
 *  the guides land in exactly the same (building-local) frame as the drag cursor. */
type ToWorld = (s: number, y: number) => [number, number, number]

/** The moving opening's same-wall neighbours, as wall-local spans. */
export function collectOpeningSiblings(
  wall: WallNode,
  movingId: string,
  nodes: Record<string, AnyNode>,
): OpeningSpan[] {
  const out: OpeningSpan[] = []
  const childIds = Array.isArray(wall.children) ? wall.children : []
  for (const childId of childIds) {
    if (childId === movingId) continue
    const node = nodes[childId as AnyNodeId]
    if (!node || (node.type !== 'door' && node.type !== 'window')) continue
    out.push({
      id: node.id,
      centerS: node.position[0],
      width: node.width,
      centerY: node.position[1],
      height: node.height,
    })
  }
  return out
}

/**
 * Vertical sill/centre/top snap for a window — the chosen "snap + guide"
 * behaviour. Returns the snapped wall-local Y when a sibling sill/centre/top is
 * within threshold, else null so the caller falls back to the grid. Mirrors
 * `snapLocalXToNeighbors` on the vertical axis.
 */
export function resolveSillSnap(args: {
  wall: WallNode
  movingId: string
  localX: number
  localY: number
  width: number
  height: number
  nodes: Record<string, AnyNode>
}): number | null {
  const siblings = collectOpeningSiblings(args.wall, args.movingId, args.nodes)
  const match = detectVerticalAlignment(
    {
      id: args.movingId,
      centerS: args.localX,
      width: args.width,
      centerY: args.localY,
      height: args.height,
    },
    siblings,
    SILL_SNAP_THRESHOLD_M,
  )
  return match ? args.localY + match.snap : null
}

/** Compute and publish the 3D opening guides for the current drag tick. */
export function publishOpeningGuides3D(args: {
  wall: WallNode
  movingId: string
  centerS: number
  centerY: number
  width: number
  height: number
  includeVertical: boolean
  toWorld: ToWorld
  nodes: Record<string, AnyNode>
}): void {
  const { wall, centerS, centerY, width, toWorld } = args
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const wallHeight = wall.height ?? 2.5
  const siblings = collectOpeningSiblings(wall, args.movingId, args.nodes)
  const guides = computeOpeningGuides({
    moving: { id: args.movingId, centerS, width, centerY, height: args.height },
    siblings,
    wall: { length: wallLength, height: wallHeight },
    includeVertical: args.includeVertical,
  })

  const out: OpeningGuide3D[] = []

  // Stable `id`s keyed on the guide's semantic role (not list position) so the
  // 3D layer can keep a persisting slot's element + `<Html>` pill mounted as the
  // set churns each tick — see `OpeningGuide3D`.
  if (guides.sillHead) {
    if (guides.sillHead.sill > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        id: 'sill',
        from: toWorld(centerS, 0),
        to: toWorld(centerS, guides.sillHead.bottomY),
        value: guides.sillHead.sill,
      })
    }
    if (guides.sillHead.head > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        id: 'head',
        from: toWorld(centerS, guides.sillHead.topY),
        to: toWorld(centerS, wallHeight),
        value: guides.sillHead.head,
      })
    }
  }

  for (const gap of guides.gaps) {
    out.push({
      kind: 'dimension',
      id: `gap:${gap.side}`,
      from: toWorld(gap.fromS, centerY),
      to: toWorld(gap.toS, centerY),
      value: gap.distance,
    })
  }

  if (guides.vertical) {
    const target = siblings.find((s) => s.id === guides.vertical?.targetId)
    if (target) {
      const lo = Math.min(centerS - width / 2, target.centerS - target.width / 2)
      const hi = Math.max(centerS + width / 2, target.centerS + target.width / 2)
      out.push({
        kind: 'align-line',
        id: 'vertical',
        from: toWorld(lo, guides.vertical.y),
        to: toWorld(hi, guides.vertical.y),
      })
    }
  }

  if (guides.equalSpacing) {
    const { gap, segments } = guides.equalSpacing
    segments.forEach((seg, i) => {
      out.push({
        kind: 'badge',
        id: `spacing:${i}`,
        at: toWorld((seg.fromS + seg.toS) / 2, centerY),
        value: gap,
      })
    })
  }

  useOpeningGuides.getState().set(out)
}

export function clearOpeningGuides3D(): void {
  useOpeningGuides.getState().clear()
}

/** Wall-local (s along the wall, y above the wall base) → the move tool's render
 *  frame, given the level Y offset + slab elevation. Shared by the wall-event
 *  publisher (which already has them) and the resize publisher (which derives
 *  them from the scene). Same frame as `wallLocalToWorld`. */
function makeWallToWorld(wall: WallNode, levelYOffset: number, slabElevation: number): ToWorld {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return (s, y) => [
    wall.start[0] + s * cos,
    slabElevation + y + levelYOffset,
    wall.start[1] + s * sin,
  ]
}

/** Like {@link makeWallToWorld} but derives the level Y + slab elevation from the
 *  scene, for callers without a wall event — i.e. the resize handles. */
export function wallToWorld(wall: WallNode): ToWorld {
  const levelId = wall.parentId as AnyNodeId | undefined
  const levelYOffset = levelId ? (sceneRegistry.nodes.get(levelId)?.position.y ?? 0) : 0
  const slabElevation = spatialGridManager.getSlabElevationForWall(
    wall.parentId ?? '',
    wall.start,
    wall.end,
  )
  return makeWallToWorld(wall, levelYOffset, slabElevation)
}

/**
 * Publish 3D opening guides for an opening being placed or moved on a wall via a
 * wall event. The caller passes the level Y + slab elevation it already computed
 * for the drag cursor, so the guides share the cursor's frame exactly — the one
 * place the door/window move + placement tools publish from.
 */
export function publishOpeningGuidesForWallEvent(args: {
  wall: WallNode
  movingId: string
  centerS: number
  centerY: number
  width: number
  height: number
  includeVertical: boolean
  levelYOffset: number
  slabElevation: number
}): void {
  const { wall, levelYOffset, slabElevation, ...rest } = args
  publishOpeningGuides3D({
    ...rest,
    wall,
    nodes: useScene.getState().nodes,
    toWorld: makeWallToWorld(wall, levelYOffset, slabElevation),
  })
}

/**
 * Publish 3D opening guides for an opening being RESIZED via a handle arrow.
 * Resolves the host wall + transform from the scene (no wall event), then reuses
 * the shared publish. Doors pass `includeVertical: false` (they sit on the
 * floor); windows pass `true` so a height drag also shows the live sill/head.
 */
export function publishOpeningResizeGuides(
  node: {
    id: string
    parentId?: string | null
    position: readonly [number, number, number]
    width: number
    height: number
  },
  includeVertical: boolean,
): void {
  const nodes = useScene.getState().nodes
  const wall = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  if (wall?.type !== 'wall') return
  publishOpeningGuides3D({
    wall,
    movingId: node.id,
    centerS: node.position[0],
    centerY: node.position[1],
    width: node.width,
    height: node.height,
    includeVertical,
    nodes,
    toWorld: wallToWorld(wall),
  })
}
