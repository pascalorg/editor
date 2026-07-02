import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getRoofWallFaceFrame,
  getScaledDimensions,
  type ItemNode,
  movingFootprintAnchors,
  type RoofSegmentNode,
  roofFacePointToSegment,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
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

type ItemPlanTransform = {
  point: [number, number]
  rotation: number
}

function rotateVec(x: number, z: number, rotationY: number): [number, number] {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [x * c + z * s, -x * s + z * c]
}

function resolveItemPlanTransform(
  item: ItemNode,
  nodes: Record<AnyNodeId, AnyNode>,
  cache = new Map<AnyNodeId, ItemPlanTransform>(),
): ItemPlanTransform {
  const cached = cache.get(item.id as AnyNodeId)
  if (cached) return cached

  const localRotation = item.rotation[1] ?? 0
  let result: ItemPlanTransform = {
    point: [item.position[0], item.position[2]],
    rotation: localRotation,
  }
  const parent = item.parentId ? nodes[item.parentId as AnyNodeId] : null
  if (parent?.type === 'wall') {
    const wallRotation = -Math.atan2(
      parent.end[1] - parent.start[1],
      parent.end[0] - parent.start[0],
    )
    const wallLocalZ =
      item.asset.attachTo === 'wall-side'
        ? ((parent.thickness ?? 0.1) / 2) * (item.side === 'front' ? 1 : -1)
        : item.position[2]
    const [offsetX, offsetZ] = rotateVec(item.position[0], wallLocalZ, wallRotation)
    result = {
      point: [parent.start[0] + offsetX, parent.start[1] + offsetZ],
      rotation: wallRotation + localRotation,
    }
  } else if (parent?.type === 'shelf') {
    const shelf = parent as AnyNode & {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    const [offsetX, offsetZ] = rotateVec(item.position[0], item.position[2], shelf.rotation[1] ?? 0)
    result = {
      point: [shelf.position[0] + offsetX, shelf.position[2] + offsetZ],
      rotation: (shelf.rotation[1] ?? 0) + localRotation,
    }
  } else if (parent?.type === 'item') {
    const parentTransform = resolveItemPlanTransform(parent as ItemNode, nodes, cache)
    const [offsetX, offsetZ] = rotateVec(
      item.position[0],
      item.position[2],
      parentTransform.rotation,
    )
    result = {
      point: [parentTransform.point[0] + offsetX, parentTransform.point[1] + offsetZ],
      rotation: parentTransform.rotation + localRotation,
    }
  } else if (parent?.type === 'roof-segment') {
    // Roof-hosted wall item: FACE-LOCAL position mapped through the face
    // frame, then composed through the segment's and roof's yaw +
    // position into level-local plan coords — without this the drag seed
    // jumps off the roof at move start.
    const segment = parent as RoofSegmentNode
    const roof = segment.parentId
      ? (nodes[segment.parentId as AnyNodeId] as
          | (AnyNode & { position: [number, number, number]; rotation: number })
          | undefined)
      : undefined
    if (roof?.type === 'roof' && item.roofFace) {
      const frame = getRoofWallFaceFrame(segment, item.roofFace)
      const segLocal = roofFacePointToSegment(segment, item.roofFace, item.position)
      const [sx, sz] = rotateVec(segLocal[0], segLocal[2], segment.rotation ?? 0)
      const [rx, rz] = rotateVec(
        sx + segment.position[0],
        sz + segment.position[2],
        roof.rotation ?? 0,
      )
      result = {
        point: [rx + roof.position[0], rz + roof.position[2]],
        rotation: (roof.rotation ?? 0) + (segment.rotation ?? 0) + frame.yaw + localRotation,
      }
    }
  }

  cache.set(item.id as AnyNodeId, result)
  return result
}

function resolveItemPlanPoint(
  item: ItemNode,
  nodes: Record<AnyNodeId, AnyNode>,
  cache = new Map<AnyNodeId, ItemPlanTransform>(),
): [number, number] {
  return resolveItemPlanTransform(item, nodes, cache).point
}

function createPlanarMovePointResolver(originalPlanPoint: [number, number], node: ItemNode) {
  const resolveCursor = createFloorplanCursorResolver({
    original: originalPlanPoint,
    metadata: node.metadata,
  })

  return (planPoint: readonly [number, number]): WallPlanPoint => {
    // Grid snap is mode-driven (matching 3D): quantize only when grid mode is
    // active; in lines/off mode the cursor passes through unsnapped.
    const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
    const snap = (value: number) => (step <= 0 ? value : Math.round(value / step) * step)
    return resolveCursor(planPoint, { snap }) as WallPlanPoint
  }
}

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
  const resolveCursor = createFloorplanCursorResolver({
    original: resolveItemPlanPoint(node, useScene.getState().nodes),
    metadata: node.metadata,
  })

  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint }) {
      const nodes = useScene.getState().nodes
      const resolvedPlanPoint = resolveCursor(planPoint)
      const hit = findClosestWallInPlan(resolvedPlanPoint, nodes, startLevelId)
      if (!hit) return

      const [width] = getScaledDimensions(node)

      // Figma-style along-wall alignment (edge-to-edge with other openings /
      // wall items / wall ends), winning over the grid snap; falls back to grid
      // when nothing aligns. Both are mode-driven (matching 3D): alignment only in
      // lines/magnetic mode, grid quantization only in grid mode.
      const neighborX = isMagneticSnapActive()
        ? snapLocalXToNeighbors({
            wall: hit.wall,
            localX: hit.localX,
            width,
            selfId: node.id as AnyNodeId,
            nodes,
          })
        : null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snappedLocalX =
        neighborX ?? (step <= 0 ? hit.localX : Math.round(hit.localX / step) * step)

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
            // Re-anchoring to a wall ends any roof-segment hosting; the
            // overlay's snapshot restores it if the move is reverted.
            roofSegmentId: undefined,
            roofFace: undefined,
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
  const resolvePlanPoint = createPlanarMovePointResolver(resolveItemPlanPoint(node, nodes), node)
  // Alignment candidates gathered once — scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint }) {
      const gridSnapped = resolvePlanPoint(planPoint)
      // Figma-style alignment layered on the grid snap, mode-driven (matching 3D):
      // guides are DISPLAYED in every snapping mode; the magnetic pull onto them
      // is applied only in "lines" mode (`applySnap`).
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          rotationY,
        ),
        candidates,
        { applySnap: isMagneticSnapActive() },
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
  const resolvePlanPoint = createPlanarMovePointResolver(
    resolveItemPlanPoint(node, useScene.getState().nodes),
    node,
  )
  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint }) {
      const nodes = useScene.getState().nodes
      const snapped = resolvePlanPoint(planPoint)

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
