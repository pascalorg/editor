import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getScaledDimensions,
  type ItemNode,
  movingFootprintAnchors,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  snapBuildingLocalToWorldGrid,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { findClosestWallInPlan, snapLocalXToNeighbors } from '../shared/wall-attach-target'

/**
 * 2D floor-plan move handler for item. Branches on `asset.attachTo`:
 *
 *   - `'wall'` / `'wall-side'`: pointer snaps to nearest wall (same
 *     math as door / window via `findClosestWallInPlan`). Position
 *     local-X is snapped to 0.5m grid; the wall-local Y carries over
 *     from the source position (2D has no vertical signal).
 *   - `'ceiling'`: pointer is point-in-polygon-tested against every
 *     ceiling on the level. If hit, the item reparents to that
 *     ceiling at the snapped local plan position.
 *   - undefined (floor): pointer is point-in-polygon-tested against
 *     every slab on the level. If hit, the item reparents to that
 *     slab; otherwise it stays parented to the level (free-floating)
 *     at the snapped plan position.
 *
 * Skipped vs the 3D `MoveItemContent` for now: attachTo *transitions*
 * (drop a wall lamp on a ceiling and have it switch to ceiling-attach).
 * The 3D path remains canonical for that — 2D only re-anchors within
 * the item's current attach family.
 */

const GRID_STEP = 0.5

export const itemFloorplanMoveTarget: FloorplanMoveTarget<ItemNode> = ({ node, nodes }) => {
  const attachTo = node.asset.attachTo
  const startLevelId: AnyNodeId | null = (() => {
    // Walk to the owning level depending on the item's current parent:
    //   - wall / ceiling parent → parent.parentId is the level
    //   - level parent (floor items) → parent.id IS the level
    //   - item / shelf parent → walk up until we hit a level
    // Without the `parent.type === 'level'` short-circuit, floor items
    // (whose immediate parent is the level itself) get `level.parentId`,
    // which is the *building* — `findContainingSurface` would then
    // iterate the building's children (levels, not slabs) and the
    // fallback `parentId: startLevelId` would reparent the item to the
    // building. The item drops out of the level→children DFS the floor
    // plan walks and disappears mid-drag.
    const nodes = useScene.getState().nodes
    let current = nodes[node.parentId as AnyNodeId]
    while (current) {
      if (current.type === 'level') return current.id as AnyNodeId
      if (!current.parentId) return null
      current = nodes[current.parentId as AnyNodeId]
    }
    return null
  })()

  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return buildWallItemSession(node, startLevelId)
  }
  if (attachTo === 'ceiling') {
    return buildSurfaceItemSession(node, startLevelId, 'ceiling')
  }
  return buildFloorItemSession(node, startLevelId, nodes)
}

function buildWallItemSession(
  node: ItemNode,
  startLevelId: AnyNodeId | null,
): FloorplanMoveTargetSession {
  // Wall items use the same local-X snap pipeline as doors / windows.
  // local-Y carries over from the source item's position (2D can't
  // express vertical movement).
  const startLocalY = node.position[1]

  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan(planPoint, nodes, startLevelId)
      if (!hit) return

      const [width] = getScaledDimensions(node)

      // Figma-style along-wall alignment (edge-to-edge with other openings /
      // wall items / wall ends), winning over the 0.5m grid snap; falls back
      // to grid when nothing aligns. Alt bypasses; Shift drops the grid snap.
      const neighborX = modifiers.altKey
        ? null
        : snapLocalXToNeighbors({
            wall: hit.wall,
            localX: hit.localX,
            width,
            selfId: node.id as AnyNodeId,
            nodes,
          })
      const snappedLocalX =
        neighborX ??
        (modifiers.shiftKey ? hit.localX : Math.round(hit.localX / GRID_STEP) * GRID_STEP)

      const halfW = width / 2
      const clampedX = Math.max(halfW, Math.min(hit.wallLength - halfW, snappedLocalX))

      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: {
            position: [clampedX, startLocalY, 0],
            rotation: [0, hit.itemRotation, 0],
            side: hit.side,
            parentId: hit.wall.id,
          },
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[node.id as AnyNodeId] as ItemNode | undefined
      return !!live && live.type === 'item' && !!live.parentId
    },
  }
}

/**
 * Floor items live as level children — the slab is *not* a parent (slabs
 * have no `children` field; only ceilings and the level itself do).
 * Reparenting a floor item to a slab corrupts the parent-children
 * bookkeeping and the item drops out of the level→children DFS the
 * floor-plan layer walks → the polygon stops rendering mid-drag.
 *
 * For the 2D move we just translate `position` in level-local coords and
 * leave the parent as the level (matching the 3D `detachItemSurfaceToFloor`
 * in `use-placement-coordinator.tsx`). Snap to the 0.5m grid unless the
 * user holds Shift.
 */
function buildFloorItemSession(
  node: ItemNode,
  startLevelId: AnyNodeId | null,
  nodes: Record<AnyNodeId, AnyNode>,
): FloorplanMoveTargetSession {
  const rotationY = node.rotation[1] ?? 0
  // Alignment candidates gathered once — scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const gridSnapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : (snapBuildingLocalToWorldGrid(
            [planPoint[0], planPoint[1]] as WallPlanPoint,
            GRID_STEP,
          ) as WallPlanPoint)
      // Figma-style alignment layered on the grid snap (Alt bypasses).
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          rotationY,
        ),
        candidates,
        { bypass: modifiers.altKey },
      )

      const sourceY = node.position[1]
      const nextPosition: [number, number, number] = [snapped[0], sourceY, snapped[1]]

      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: {
            position: nextPosition,
            // Keep parent as the level we resolved at session-start. If
            // somehow it's null (e.g. orphaned item), fall back to the
            // existing parent so we don't write `null` and detach.
            parentId: startLevelId ?? node.parentId,
          },
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[node.id as AnyNodeId] as ItemNode | undefined
      return !!live && live.type === 'item'
    },
  }
}

/**
 * Ceiling items reparent to whichever ceiling polygon contains the
 * pointer. Ceilings carry a `children` field on their schema so the
 * parent-children bookkeeping in `updateNodes` works correctly when the
 * item moves between ceilings. If the cursor drifts off every ceiling,
 * the original parent is preserved (no detach back to the level — there
 * is no canonical "free-floating ceiling item").
 */
function buildSurfaceItemSession(
  node: ItemNode,
  startLevelId: AnyNodeId | null,
  targetKind: 'ceiling',
): FloorplanMoveTargetSession {
  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const nodes = useScene.getState().nodes
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : (snapBuildingLocalToWorldGrid(
            [planPoint[0], planPoint[1]] as WallPlanPoint,
            GRID_STEP,
          ) as WallPlanPoint)

      const surface = findContainingSurface(snapped, nodes, startLevelId, targetKind)

      const sourceY = node.position[1]
      const nextPosition: [number, number, number] = [snapped[0], sourceY, snapped[1]]

      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: {
            position: nextPosition,
            parentId: surface ? surface.id : node.parentId,
          },
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[node.id as AnyNodeId] as ItemNode | undefined
      return !!live && live.type === 'item'
    },
  }
}

/**
 * Walk every ceiling under the level and return the first one whose
 * polygon contains the pointer. Holes are honoured — a point inside a
 * hole counts as not inside the surface. Slabs are intentionally NOT a
 * valid target: floor items are parented to the level, not the slab,
 * because slabs don't carry a `children` field on their schema.
 */
function findContainingSurface(
  point: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  parentLevelId: AnyNodeId | null,
  targetKind: 'ceiling',
): CeilingNode | null {
  if (!parentLevelId) return null
  const level = nodes[parentLevelId]
  const childIds = (level as unknown as { children?: AnyNodeId[] })?.children
  if (!Array.isArray(childIds)) return null

  for (const childId of childIds) {
    const node = nodes[childId]
    if (!node || node.type !== targetKind) continue
    const surface = node as CeilingNode
    const polygon = surface.polygon
    if (!polygon || polygon.length < 3) continue
    if (!pointInRing(point, polygon)) continue
    const holes = surface.holes ?? []
    let inHole = false
    for (const hole of holes) {
      if (hole.length >= 3 && pointInRing(point, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole) return surface
  }
  return null
}

/** Standard ray-cast point-in-polygon. Treats edges as inside. */
function pointInRing(
  point: readonly [number, number],
  ring: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false
  const [px, py] = point
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[i]![0]
    const ay = ring[i]![1]
    const bx = ring[j]![0]
    const by = ring[j]![1]
    const intersects = ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax
    if (intersects) inside = !inside
  }
  return inside
}
