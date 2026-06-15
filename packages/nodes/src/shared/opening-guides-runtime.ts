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

  if (guides.sillHead) {
    if (guides.sillHead.sill > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        from: toWorld(centerS, 0),
        to: toWorld(centerS, guides.sillHead.bottomY),
        value: guides.sillHead.sill,
      })
    }
    if (guides.sillHead.head > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        from: toWorld(centerS, guides.sillHead.topY),
        to: toWorld(centerS, wallHeight),
        value: guides.sillHead.head,
      })
    }
  }

  for (const gap of guides.gaps) {
    out.push({
      kind: 'dimension',
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
        from: toWorld(lo, guides.vertical.y),
        to: toWorld(hi, guides.vertical.y),
      })
    }
  }

  if (guides.equalSpacing) {
    for (const seg of guides.equalSpacing.segments) {
      out.push({
        kind: 'badge',
        at: toWorld((seg.fromS + seg.toS) / 2, centerY),
        value: guides.equalSpacing.gap,
      })
    }
  }

  useOpeningGuides.getState().set(out)
}

export function clearOpeningGuides3D(): void {
  useOpeningGuides.getState().clear()
}
