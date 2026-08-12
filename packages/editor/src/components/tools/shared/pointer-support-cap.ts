import {
  type AnyNodeId,
  canHostOnTop,
  GROUND_SUPPORT_ID,
  type ItemNode,
  isLowProfileItemSurface,
  sceneRegistry,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type Camera, Matrix3, type Object3D, Raycaster, Vector3 } from 'three'
import { resolveTerrainGroundHit } from '../../../lib/ground-surface'

const originScratch = new Vector3()
const hitScratch = new Vector3()
const worldScratch = new Vector3()
const pointScratch = new Vector3()
const worldRayOrigin = new Vector3()
const worldRayDirection = new Vector3()
const nodeTopRaycaster = new Raycaster()
const nodeTopNormal = new Vector3()
const nodeTopNormalMatrix = new Matrix3()

const NODE_TOP_SURFACE_KINDS = ['wall', 'item', 'column', 'custom-mesh'] as const
const DEFAULT_NODE_TOP_SURFACE_KINDS = ['custom-mesh'] as const

export type PointerSupportSurface = {
  /** Level-local elevation of the pointed surface — the election cap. */
  elevation: number
  /** Slab host, or the explicit ground sentinel when the level base won. */
  supportSlabId: string | null
  /** Node whose upward-facing geometry supplied this surface, when applicable. */
  sourceNodeId: AnyNodeId | null
  /** World-space Y of the same surface, for grid-plane / preview placement. */
  worldY: number
  /**
   * World-space point where the pointer ray meets the pointed surface's
   * plane, or null when the ray never reaches it. Unlike the grid event's
   * own hit — whose XZ is perspective-skewed whenever the event plane
   * rides at a different storey than the aimed-at surface — this point
   * depends only on the ray and the pointed surface, so a preview /
   * election fed from it cannot flip with the event plane's height.
   */
  worldPoint: [number, number, number] | null
  /** {@link PointerSupportSurface.worldPoint} in the grid event's
   *  `localPosition` (building-local) frame — a drop-in replacement for
   *  the event's plane-hit XZ. */
  localPoint: [number, number, number] | null
}

/**
 * The walking surface the pointer actually points at: its level-local
 * elevation (for use as the slab-support election cap, `maxElevation`),
 * its world-space Y (for riding the grid event plane / draw preview on
 * it), and the ray's crossing of that surface's plane (the plan point the
 * cursor indicates).
 *
 * The grid event plane rides at the ghost's last height, so its hit point
 * alone can't be trusted (that feedback loop is what made a ghost under an
 * elevated deck blink between the deck top and the ground). But camera →
 * hit reconstructs the true pointer ray regardless of the plane height,
 * and the nearest slab plane that ray crosses inside its rendered polygon
 * IS the surface under the cursor — the deck top when aiming at the deck,
 * the floor/ground when aiming underneath it. The same reasoning applies
 * to the cursor XZ: the event plane's hit is skewed along the ray whenever
 * the plane sits on a different storey than the pointed surface, so
 * callers should place at `localPoint` / `worldPoint`, not the event hit.
 *
 * When the ray crosses no slab, the surface is the level base — and on the
 * storey that sits on the ground, that base is the sculpted terrain rather
 * than a plane, so `elevation` varies with XZ. Everything downstream already
 * treats it as a varying scalar, which is why terrain needs no new axis here.
 *
 * Returns null when no level is active (callers fall back to the
 * uncapped max election and the raw event hit).
 */
export function resolvePointerSupportSurface(
  camera: Camera,
  worldHit: readonly [number, number, number],
  options?: { includeNodeTopSurfaces?: boolean },
): PointerSupportSurface | null {
  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return null

  // The world ray, kept before the level conversion below: the terrain field is
  // world-space (site geometry, not level-local), so the march needs this frame.
  camera.getWorldPosition(worldRayOrigin)
  worldRayDirection.set(worldHit[0], worldHit[1], worldHit[2]).sub(worldRayOrigin)

  originScratch.copy(worldRayOrigin)
  hitScratch.set(worldHit[0], worldHit[1], worldHit[2])
  // Slab polygons/elevations live in the level frame; the level mesh
  // carries the storey Y offset and any building rotation.
  const levelMesh = sceneRegistry.nodes.get(levelId as AnyNodeId)
  if (levelMesh) {
    levelMesh.worldToLocal(originScratch)
    levelMesh.worldToLocal(hitScratch)
  }
  hitScratch.sub(originScratch)
  if (hitScratch.lengthSq() < 1e-12) return null

  const pointed = spatialGridManager.getPointedSupportSurface(
    levelId,
    [originScratch.x, originScratch.y, originScratch.z],
    [hitScratch.x, hitScratch.y, hitScratch.z],
  )
  let elevation = pointed.elevation
  let point = pointed.point

  // The level base is the second flat plane terrain has to displace (the first is
  // `useGridEvents`'). The manager solves `t = -oy / dy` for it — a plane — which
  // is still right for every storey whose base is a built floor, and wrong for the
  // storey sitting on the ground, where the base IS the terrain.
  //
  // Substituted here rather than inside the manager for two reasons: the
  // discrimination ("is this plane the site ground?") needs the level's *world*
  // height, and this function is what owns the world↔level conversion; and
  // `ground-surface` is meant to hold that rule once, shared with `useGridEvents`,
  // rather than have `core` grow a terrain dependency it cannot express.
  //
  // Only the no-slab branch is replaced. A ray that crossed a slab inside its
  // rendered polygon is aimed at a built floor, and terrain does not compete with
  // one — that is the flat-floor invariant.
  if (pointed.slabId === null) {
    const baseWorldY = levelMesh ? levelMesh.localToWorld(worldScratch.set(0, 0, 0)).y : 0
    const groundHit = resolveTerrainGroundHit(
      [worldRayOrigin.x, worldRayOrigin.y, worldRayOrigin.z],
      [worldRayDirection.x, worldRayDirection.y, worldRayDirection.z],
      baseWorldY,
    )
    if (groundHit) {
      pointScratch.set(groundHit.x, groundHit.y, groundHit.z)
      if (levelMesh) levelMesh.worldToLocal(pointScratch)
      elevation = pointScratch.y
      point = [pointScratch.x, pointScratch.z]
    }
  }

  const worldY = levelMesh ? levelMesh.localToWorld(worldScratch.set(0, elevation, 0)).y : elevation

  let worldPoint: [number, number, number] | null = null
  let localPoint: [number, number, number] | null = null
  if (point) {
    pointScratch.set(point[0], elevation, point[1])
    if (levelMesh) levelMesh.localToWorld(pointScratch)
    worldPoint = [pointScratch.x, pointScratch.y, pointScratch.z]
    // Same frame the grid events report `localPosition` in (use-grid-events).
    const buildingId = useViewer.getState().selection.buildingId
    const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
    if (buildingMesh) buildingMesh.worldToLocal(pointScratch)
    localPoint = [pointScratch.x, pointScratch.y, pointScratch.z]
  }

  const nodeTopSurfaceKinds = options?.includeNodeTopSurfaces
    ? NODE_TOP_SURFACE_KINDS
    : DEFAULT_NODE_TOP_SURFACE_KINDS
  if (nodeTopSurfaceKinds.some((kind) => (sceneRegistry.byType[kind]?.size ?? 0) > 0)) {
    nodeTopRaycaster.set(worldRayOrigin, worldRayDirection.clone().normalize())
    const nodes = useScene.getState().nodes
    const registeredOwners = new Map(
      [...sceneRegistry.nodes.entries()].map(([nodeId, object]) => [object, nodeId as AnyNodeId]),
    )
    const belongsToActiveLevel = (nodeId: AnyNodeId) => {
      let current = nodes[nodeId]
      const visited = new Set<AnyNodeId>()
      while (current && !visited.has(current.id)) {
        if (current.id === levelId) return true
        visited.add(current.id)
        current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
      }
      return false
    }

    const pointedDistance = worldPoint
      ? worldRayOrigin.distanceTo(pointScratch.set(...worldPoint))
      : Number.POSITIVE_INFINITY
    let nearest:
      | {
          distance: number
          nodeId: AnyNodeId
          point: Vector3
        }
      | undefined

    for (const kind of nodeTopSurfaceKinds) {
      for (const rawId of sceneRegistry.byType[kind] ?? []) {
        const nodeId = rawId as AnyNodeId
        const node = nodes[nodeId]
        const object = sceneRegistry.nodes.get(nodeId)
        if (!(node?.visible && object?.visible && belongsToActiveLevel(nodeId))) continue
        if (
          node.type === 'item' &&
          (!canHostOnTop(node) || isLowProfileItemSurface(node as ItemNode))
        ) {
          continue
        }

        for (const intersection of nodeTopRaycaster.intersectObject(object, true)) {
          if (
            intersection.distance >= (nearest?.distance ?? pointedDistance) ||
            !intersection.face
          ) {
            continue
          }
          let ownerObject: Object3D | null = intersection.object
          let belongsToNestedNode = false
          while (ownerObject && ownerObject !== object) {
            const ownerId = registeredOwners.get(ownerObject)
            if (ownerId && ownerId !== nodeId) {
              belongsToNestedNode = true
              break
            }
            ownerObject = ownerObject.parent
          }
          if (belongsToNestedNode) continue
          nodeTopNormal
            .copy(intersection.face.normal)
            .applyNormalMatrix(nodeTopNormalMatrix.getNormalMatrix(intersection.object.matrixWorld))
            .normalize()
          if (nodeTopNormal.y < 0.75) continue
          nearest = {
            distance: intersection.distance,
            nodeId,
            point: intersection.point.clone(),
          }
        }
      }
    }

    if (nearest) {
      const sourceNode = nodes[nearest.nodeId]
      pointScratch.copy(nearest.point)
      const nodeWorldPoint: [number, number, number] = [
        pointScratch.x,
        pointScratch.y,
        pointScratch.z,
      ]
      if (levelMesh) levelMesh.worldToLocal(pointScratch)
      elevation = pointScratch.y

      pointScratch.copy(nearest.point)
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (buildingMesh) buildingMesh.worldToLocal(pointScratch)

      return {
        elevation,
        supportSlabId:
          sourceNode && 'supportSlabId' in sourceNode
            ? ((sourceNode.supportSlabId as string | undefined) ?? null)
            : null,
        sourceNodeId: nearest.nodeId,
        worldY: nearest.point.y,
        worldPoint: nodeWorldPoint,
        localPoint: [pointScratch.x, pointScratch.y, pointScratch.z],
      }
    }
  }

  return {
    elevation,
    supportSlabId: pointed.slabId ?? GROUND_SUPPORT_ID,
    sourceNodeId: null,
    worldY,
    worldPoint,
    localPoint,
  }
}

/** {@link resolvePointerSupportSurface}, elevation only — the election cap. */
export function resolvePointerSupportElevation(
  camera: Camera,
  worldHit: readonly [number, number, number],
): number | null {
  return resolvePointerSupportSurface(camera, worldHit)?.elevation ?? null
}
