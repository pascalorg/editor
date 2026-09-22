import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  cascadeDirty,
  clearFaceHostItemFields,
  collectAlignmentAnchors,
  collectDescendants,
  createSceneApi,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getBlockFaceFrame,
  getScaledDimensions,
  getSurfaceProvider,
  type ItemNode,
  movingFootprintAnchors,
  nodeRegistry,
  resolveSupportSlabPatch,
  resolveSurfacePlacement,
  surfaceRegionContainsPoint,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  boundsOf,
  boxCorners,
  composeFrames,
  frame,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import {
  applyFloorplanAlignment,
  isGridSnapActive,
  isMagneticSnapActive,
  surfaceAttachmentId,
  surfaceFramePose,
  updateSurfaceNode,
  useEditor,
  useInteractionScope,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { restingNodePlanFrame } from '../shared/resting-surface-plan'
import { findClosestWallInPlan, snapLocalXToNeighbors } from '../shared/wall-attach-target'
import { resolveItemTransform } from './floorplan'

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
 *   - undefined (floor): retains the current resting surface while the
 *     footprint centre is supported; otherwise reparents to the level
 *     at the floor datum and re-elects slab support.
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

function resolveItemPlanTransform(
  item: ItemNode,
  nodes: Record<AnyNodeId, AnyNode>,
): ItemPlanTransform {
  const pose = resolveItemTransform(item, { resolve: (id: AnyNodeId) => nodes[id] } as never)
  return {
    point: pose ? [pose.x, pose.y] : [item.position[0], item.position[2]],
    rotation: pose?.rotation ?? item.rotation[1],
  }
}

function resolveItemPlanPoint(item: ItemNode, nodes: Record<AnyNodeId, AnyNode>): [number, number] {
  return resolveItemPlanTransform(item, nodes).point
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
  let lastPatch: Partial<ItemNode> | null = null

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

      lastPatch = {
        position: [clampedX, startLocalY, 0],
        rotation: [0, hit.itemRotation, 0],
        side: hit.side,
        parentId: hit.wall.id,
        roofSegmentId: undefined,
        roofFace: undefined,
        blockFaceId: undefined,
      }
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
      useScene.getState().markDirty(node.id as AnyNodeId)
    },
    canCommit() {
      return !!lastPatch?.parentId
    },
    commit() {
      if (!lastPatch) return
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastPatch }])
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
 * A host exit converts the pose to the level frame, matching the 3D
 * `detachItemSurfaceToFloor`; inherited support lift stays out of stored Y.
 */
function buildFloorItemSession(
  node: ItemNode,
  startLevelId: AnyNodeId | null,
  nodes: Record<AnyNodeId, AnyNode>,
): FloorplanMoveTargetSession {
  const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  const hosted = host && host.type !== 'level'
  const surfaceId = surfaceAttachmentId(node)
  const hostPose = surfaceFramePose(node.parentId, surfaceId, node, false)
  const planTransform = resolveItemPlanTransform(node, nodes)
  const levelFrame = hosted ? restingNodePlanFrame(node, (id) => nodes[id]) : null
  const rotationY = levelFrame
    ? Math.atan2(levelFrame.axes[2][0], levelFrame.axes[2][2])
    : planTransform.rotation
  const levelRotation: [number, number, number] = [...node.rotation]
  if (hosted) {
    if ((node as AnyNode).type === 'procedural-item') {
      // Generated footprints use the query frame; catalog footprints keep their legacy plan mapping.
      planTransform.point = [levelFrame!.position[0], levelFrame!.position[2]]
      const hostFrame = restingNodePlanFrame(host, (id) => nodes[id])
      const headingPose = surfaceFramePose(
        node.parentId,
        surfaceId,
        { position: node.position, rotation: [0, node.rotation[1], 0] },
        false,
      )
      levelRotation[1] =
        headingPose.rotation[1] + Math.atan2(hostFrame.axes[2][0], hostFrame.axes[2][2])
    } else {
      levelRotation.splice(0, 3, hostPose.rotation[0], rotationY, hostPose.rotation[2])
    }
  }
  if (host?.type === 'block' && node.blockFaceId) levelRotation.splice(0, 3, 0, rotationY, 0)
  const resolvePlanPoint = createPlanarMovePointResolver(planTransform.point, node)
  // Alignment candidates gathered once — scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  const scene = createSceneApi(useScene)
  const bounds = nodeRegistry.get(node.type)?.capabilities.dragBounds?.(node, nodes)
  const dimensions = bounds?.size ?? getScaledDimensions(node)
  const localBounds = bounds?.center
    ? {
        min: bounds.center.map((v, i) => v - dimensions[i]! / 2) as [number, number, number],
        max: bounds.center.map((v, i) => v + dimensions[i]! / 2) as [number, number, number],
      }
    : {
        min: [-dimensions[0] / 2, 0, -dimensions[2] / 2] as [number, number, number],
        max: [dimensions[0] / 2, dimensions[1], dimensions[2] / 2] as [number, number, number],
      }
  const originalBounds = boundsOf(
    boxCorners(localBounds.min, localBounds.max).map((p) =>
      transformPoint(frame(hostPose.position, hostPose.rotation), p),
    ),
  )
  const originalPlacement = hosted
    ? resolveSurfacePlacement({
        host,
        childKind: node.type,
        childId: node.id,
        childFootprint: {
          size: dimensions,
          rotationY: hostPose.rotation[1],
          rotation: hostPose.rotation,
          localBounds,
        },
        hit: {
          point: [
            (originalBounds.min[0] + originalBounds.max[0]) / 2,
            originalBounds.min[1],
            (originalBounds.min[2] + originalBounds.max[2]) / 2,
          ],
          normalWorldY: 1,
        },
        origin: hostPose.position,
        scene,
      })
    : null
  const retainedSurfaceId =
    hosted && originalPlacement
      ? getSurfaceProvider(host)
          .surfaces?.(host, { scene })
          .find((s) => s.id === (surfaceId ?? originalPlacement.surfaceId))?.id
      : undefined
  const markMoved = () => {
    for (const id of new Set([
      ...cascadeDirty(node.id, { scene }),
      ...collectDescendants(node.id, { scene }),
    ]))
      useScene.getState().markDirty(id)
  }

  let lastPatch: Partial<ItemNode> | null = null
  let lastInput: Parameters<FloorplanMoveTargetSession['apply']>[0] | null = null
  let commitBlocked = false
  let lastHostedPatch: Partial<ItemNode> = {
    parentId: node.parentId,
    position: [...node.position],
    rotation: [...node.rotation],
    supportSlabId: undefined,
  }
  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply(input) {
      lastInput = input
      commitBlocked = false
      const { planPoint } = input
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

      const liveHost = host && useScene.getState().nodes[host.id]
      if (liveHost?.type === 'block' && node.blockFaceId) {
        const face = getBlockFaceFrame(liveHost.topology, node.blockFaceId)
        if (face && face.normal[1] > 0.99) {
          const hostFrame = restingNodePlanFrame(liveHost, (id) => useScene.getState().nodes[id])
          const surface = composeFrames(hostFrame, {
            position: face.origin,
            axes: [face.xAxis, face.yAxis, face.normal],
          })
          const delta = [snapped[0] - surface.position[0], 0, snapped[1] - surface.position[2]]
          const uv = surface.axes
            .slice(0, 2)
            .map((axis) => axis.reduce((sum, v, i) => sum + v * delta[i]!, 0)) as [number, number]
          const vertices = new Map(liveHost.topology.vertices.map((v) => [v.id, v.position]))
          const polygon = liveHost.topology.faces
            .find((f) => f.id === node.blockFaceId)!
            .vertexIds.map((id) => {
              const v = vertices.get(id)!
              const delta = v.map((value, i) => value - face.origin[i]!)
              return [face.xAxis, face.yAxis].map((axis) =>
                axis.reduce((sum, value, i) => sum + value * delta[i]!, 0),
              ) as [number, number]
            })
          if (surfaceRegionContainsPoint({ kind: 'polygon', points: polygon }, uv)) {
            lastPatch = {
              parentId: liveHost.id,
              position: [uv[0], uv[1], node.position[2]],
              rotation: [...node.rotation],
              supportSlabId: undefined,
            }
            useLiveNodeOverrides.getState().set(node.id, lastPatch)
            markMoved()
            return
          }
        }
      }
      if (hosted && liveHost && (liveHost.type !== 'block' || !node.blockFaceId)) {
        const host = liveHost
        const retainedSurface = getSurfaceProvider(host)
          .surfaces?.(host, { scene })
          .find((s) => s.id === retainedSurfaceId)
        const hostFrame = restingNodePlanFrame(host, (id) => useScene.getState().nodes[id])
        if (host.type === 'item') {
          const plan = resolveItemTransform(host, {
            resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
          } as never)
          if (plan) {
            hostFrame.position[0] = plan.x
            hostFrame.position[2] = plan.y
          }
        }
        const surfaceFrame = composeFrames(
          hostFrame,
          frame(
            retainedSurface ? [...retainedSurface.position] : [0, hostPose.position[1], 0],
            retainedSurface ? [...(retainedSurface.rotation ?? [0, 0, 0])] : [0, 0, 0],
          ),
        )
        const normal = surfaceFrame.axes[1]
        const localRotation = originalPlacement?.surfaceLocal?.rotation ?? hostPose.rotation
        const bottomOffset = retainedSurface
          ? -Math.min(
              ...boxCorners(localBounds.min, localBounds.max).map(
                (p) => transformPoint(frame([0, 0, 0], [...localRotation]), p)[1],
              ),
            )
          : 0
        const y =
          surfaceFrame.position[1] +
          (bottomOffset -
            normal[0] * (snapped[0] - surfaceFrame.position[0]) -
            normal[2] * (snapped[1] - surfaceFrame.position[2])) /
            normal[1]
        const delta = [
          snapped[0] - hostFrame.position[0],
          y - hostFrame.position[1],
          snapped[1] - hostFrame.position[2],
        ]
        const local = hostFrame.axes.map((axis) =>
          axis.reduce((sum, v, i) => sum + v * delta[i]!, 0),
        ) as [number, number, number]
        const projected = boundsOf(
          boxCorners(
            localBounds?.min ?? [-dimensions[0] / 2, 0, -dimensions[2] / 2],
            localBounds?.max ?? [dimensions[0] / 2, dimensions[1], dimensions[2] / 2],
          ).map((p) => transformPoint(frame(local, hostPose.rotation), p)),
        )
        let occupied = false
        const pose = resolveSurfacePlacement({
          host,
          surface: retainedSurface,
          childKind: node.type,
          childId: node.id,
          childFootprint: {
            size: dimensions,
            rotationY: hostPose.rotation[1],
            rotation: hostPose.rotation,
            localBounds,
          },
          hit: {
            point: [
              (projected.min[0] + projected.max[0]) / 2,
              projected.min[1],
              (projected.min[2] + projected.max[2]) / 2,
            ],
            normalWorldY: 1,
          },
          origin: local,
          scene: createSceneApi(useScene),
          onReject: (reason) => {
            occupied = reason === 'surface-occupied'
          },
        })
        if (occupied) {
          commitBlocked = useInteractionScope.getState().ownedSubtree?.creation.rootId === node.id
          lastPatch = lastHostedPatch
          useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
          markMoved()
          return
        }
        if (
          pose &&
          (pose.childFrame === 'surface-local' ? pose.surfaceId === surfaceId : surfaceId === null)
        ) {
          const stored = pose.childFrame === 'surface-local' ? pose.surfaceLocal! : pose
          lastPatch = {
            parentId: host.id,
            position: [...stored.position],
            rotation: [...node.rotation],
            supportSlabId: undefined,
          }
          lastHostedPatch = lastPatch
          useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
          markMoved()
          return
        }
      }
      const nextPosition: [number, number, number] = [
        snapped[0],
        hosted ? 0 : node.position[1],
        snapped[1],
      ]

      lastPatch = {
        ...(node.blockFaceId ? clearFaceHostItemFields(host) : {}),
        position: nextPosition,
        rotation: levelRotation,
        // Keep parent as the level we resolved at session-start. If
        // somehow it's null (e.g. orphaned item), fall back to the
        // existing parent so we don't write `null` and detach.
        parentId: startLevelId ?? node.parentId,
      }
      Object.assign(lastPatch, resolveSupportSlabPatch({ ...node, ...lastPatch } as AnyNode, nodes))
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
      markMoved()
    },
    canCommit() {
      return lastPatch !== null && !commitBlocked
    },
    commit() {
      if (lastInput) session.apply(lastInput)
      if (!lastPatch) return
      updateSurfaceNode(node.id as AnyNodeId, lastPatch)
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
    },
  }
  return session
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
  let lastPatch: Partial<ItemNode> | null = null
  return {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint }) {
      const nodes = useScene.getState().nodes
      const snapped = resolvePlanPoint(planPoint)

      const surface = findContainingSurface(snapped, nodes, startLevelId, targetKind)

      const sourceY = node.position[1]
      const nextPosition: [number, number, number] = [snapped[0], sourceY, snapped[1]]

      lastPatch = {
        position: nextPosition,
        parentId: surface ? surface.id : node.parentId,
      }
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
      useScene.getState().markDirty(node.id as AnyNodeId)
    },
    canCommit() {
      return lastPatch !== null
    },
    commit() {
      if (!lastPatch) return
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastPatch }])
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
export function findContainingSurface(
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
