import {
  type AnyNodeId,
  type EventSuffix,
  emitter,
  type GridEvent,
  nodeRegistry,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { setSurfaceRaycastLayers, timeSpan, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Matrix3, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { getPlacementSurface } from '../lib/active-placement-surface'
import { raycastCeilingUnderside } from '../lib/ceiling-surface-raycast'
import { resolveTerrainGroundHit } from '../lib/ground-surface'
import {
  type DraftingSurfaceExtension,
  registeredDraftingConfig,
  registeredDraftingSurface,
} from '../lib/interaction/registered-drafting'
import useInteractionScope from '../store/use-interaction-scope'

// Keep tool previews tracking camera navigation at 10 Hz without querying every move.
const CAMERA_DRAG_MOVE_INTERVAL_MS = 100

/**
 * Custom grid events hook that uses manual raycasting instead of mesh events.
 * This ensures grid events work even when other meshes block pointer events with stopPropagation.
 */
export function useGridEvents(gridY: number) {
  const { camera, gl } = useThree()
  const interactionScope = useInteractionScope((state) => state.scope)
  const semanticSurfaceQueryRef = useRef(false)
  semanticSurfaceQueryRef.current =
    interactionScope.kind === 'placing' ||
    interactionScope.kind === 'moving' ||
    registeredDraftingConfig(interactionScope)?.surfaceQuery === true
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const groundPlane = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const intersectionPoint = useRef(new Vector3())

  type GridIntersection = {
    point: Vector3
    surface?: {
      point: Vector3
      object: Object3D
      hostId: AnyNodeId
      descriptor: DraftingSurfaceExtension
      worldNormal?: Vector3
    }
  }

  // Update ground plane when grid Y changes
  useEffect(() => {
    groundPlane.current.constant = -gridY
  }, [gridY])

  useEffect(() => {
    const canvas = gl.domElement
    setSurfaceRaycastLayers(raycaster.current.layers)

    const getSurfaceIntersection = (): GridIntersection | null => {
      let closest: GridIntersection | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      for (const [type, definition] of nodeRegistry.entries()) {
        const descriptor = registeredDraftingSurface(definition)
        if (!descriptor) continue
        for (const id of sceneRegistry.byType[type] ?? []) {
          const root = sceneRegistry.nodes.get(id)
          if (!root) continue
          const scope = useInteractionScope.getState().scope
          const surfaceDraft = registeredDraftingConfig(scope)?.surfaceQuery === true
          if (surfaceDraft && useScene.getState().nodes[id as AnyNodeId]?.visible === false)
            continue
          if (surfaceDraft && !root.visible) continue
          const intersections =
            surfaceDraft && descriptor.raycast === 'underside'
              ? raycastCeilingUnderside(raycaster.current, root)
              : raycaster.current.intersectObject(root, true)
          const hit = intersections.find((candidate) => {
            if (!surfaceDraft) return true
            if (useScene.getState().nodes[id as AnyNodeId]?.visible === false) return false
            let object: Object3D | null = candidate.object
            while (object) {
              if (!object.visible || object.userData.wallHidden === true) return false
              object = object.parent
            }
            return true
          })
          if (!hit || hit.distance >= closestDistance) continue
          closestDistance = hit.distance
          const worldNormal = hit.face
            ? hit.face.normal
                .clone()
                .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
                .normalize()
            : undefined
          if (surfaceDraft && worldNormal && worldNormal.dot(raycaster.current.ray.direction) > 0)
            worldNormal.negate()
          closest = {
            point: hit.point.clone(),
            surface: {
              point: hit.point.clone(),
              object: hit.object,
              hostId: id as AnyNodeId,
              descriptor,
              worldNormal,
            },
          }
        }
      }

      return closest
    }

    const getIntersection = (nativeEvent: MouseEvent | PointerEvent): GridIntersection | null => {
      // Convert mouse position to normalized device coordinates (-1 to +1)
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1

      // Update raycaster
      raycaster.current.setFromCamera(pointer.current, camera)

      // R3F node events can be stopped by another mesh, so this canvas-level
      // raycast is the reliable architectural-surface source for placement and
      // drawing tools. Keep it separate from the ordinary grid point so tools
      // that intentionally place on the floor retain their existing behavior.
      // Architectural meshes are expensive to raycast and are meaningful only
      // to an active placement/drafting interaction. Floor tools retain the
      // ordinary terrain/grid intersection without scanning every wall.
      const surfaceHit = semanticSurfaceQueryRef.current ? getSurfaceIntersection() : null

      // A semantic architectural hit is the authoritative cursor position.
      // Do not replace it with the terrain/grid intersection below: that would
      // make a wall hit carry wall metadata while still placing at the ground
      // floor, especially in perspective views.
      if (surfaceHit) return surfaceHit

      const scope = useInteractionScope.getState().scope
      const surfaceDraft = registeredDraftingConfig(scope)?.surfaceQuery === true
      const workingSurface = getPlacementSurface()
      if (surfaceDraft && workingSurface) {
        const plane = new Plane().setFromNormalAndCoplanarPoint(
          workingSurface.normal,
          workingSurface.point,
        )
        const projected = raycaster.current.ray.intersectPlane(plane, intersectionPoint.current)
        return { point: (projected ?? workingSurface.point).clone() }
      }

      // Sculpted ground wins over the plane, but only while the plane IS the
      // ground (see `isSiteGroundPlane`): a plane riding a storey base or a slab
      // top is a real flat surface and must stay planar. The march is what removes
      // the perspective skew — a ray intersected at the datum instead of at the
      // hillside reports an XZ that slides along the ray, so every tool consuming
      // `position`/`localPosition` was placing short of the cursor on a slope.
      //
      // The plane's own height is the query height, not the `gridY` argument: this
      // effect is keyed on `[camera, gl]` (re-attaching listeners mid-drag would
      // drop the gesture), so the argument in this closure is the value from mount.
      // `constant = -gridY` by construction in the effect above.
      const { origin, direction } = raycaster.current.ray
      const fixedConstructionPlane = getPlacementSurface()?.projection === 'fixed-plane'
      const hit = fixedConstructionPlane
        ? null
        : resolveTerrainGroundHit(
            [origin.x, origin.y, origin.z],
            [direction.x, direction.y, direction.z],
            -groundPlane.current.constant,
          )
      if (hit) {
        return {
          point: intersectionPoint.current.set(hit.x, hit.y, hit.z).clone(),
        }
      }

      // Intersect with ground plane
      if (raycaster.current.ray.intersectPlane(groundPlane.current, intersectionPoint.current)) {
        return { point: intersectionPoint.current.clone() }
      }

      return surfaceHit
    }

    const emit = (suffix: EventSuffix, nativeEvent: MouseEvent | PointerEvent) => {
      const point = getIntersection(nativeEvent)
      if (!point) return

      // Convert world-space point to building-local for tools that live inside a building.
      const scope = useInteractionScope.getState().scope
      const surfaceDraft = registeredDraftingConfig(scope)?.surfaceQuery === true
      const buildingId = surfaceDraft
        ? useViewer.getState().selection.levelId
        : useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      const localPoint = buildingMesh ? buildingMesh.worldToLocal(point.point.clone()) : point.point
      const surfaceLocalPoint = point.surface
        ? buildingMesh
          ? buildingMesh.worldToLocal(point.surface.point.clone())
          : point.surface.point.clone()
        : undefined
      const localNormal = point.surface?.worldNormal
        ? buildingMesh
          ? buildingMesh
              .worldToLocal(point.surface.point.clone().add(point.surface.worldNormal))
              .sub(surfaceLocalPoint ?? localPoint)
              .normalize()
          : point.surface.worldNormal
        : undefined
      const surfaceNode = point.surface
        ? useScene.getState().nodes[point.surface.hostId]
        : undefined
      const classifiedFace =
        point.surface && localNormal
          ? point.surface.descriptor.classifyFace?.(surfaceNode, [
              localNormal.x,
              localNormal.y,
              localNormal.z,
            ])
          : null
      const { origin, direction } = raycaster.current.ray
      const localRayOrigin = buildingMesh
        ? buildingMesh.worldToLocal(origin.clone())
        : origin.clone()
      const localRayDirection = buildingMesh
        ? buildingMesh.worldToLocal(origin.clone().add(direction)).sub(localRayOrigin).normalize()
        : direction.clone()

      const eventKey = `grid:${suffix}` as `grid:${EventSuffix}`
      const payload: GridEvent = {
        localFrameId: buildingId ?? undefined,
        position: [point.point.x, point.point.y, point.point.z],
        localPosition: [localPoint.x, localPoint.y, localPoint.z],
        localRay: {
          origin: [localRayOrigin.x, localRayOrigin.y, localRayOrigin.z],
          direction: [localRayDirection.x, localRayDirection.y, localRayDirection.z],
        },
        surfaceLocalPosition: surfaceLocalPoint
          ? [surfaceLocalPoint.x, surfaceLocalPoint.y, surfaceLocalPoint.z]
          : undefined,
        surfaceNormal: localNormal ? [localNormal.x, localNormal.y, localNormal.z] : undefined,
        surfaceObject: point.surface?.object,
        surfaceHit:
          semanticSurfaceQueryRef.current && point.surface
            ? {
                kind: point.surface.descriptor.kind,
                hostId: point.surface.hostId,
                face: classifiedFace?.face ?? 'unknown',
                levelId: useViewer.getState().selection.levelId ?? undefined,
                side: classifiedFace?.side,
              }
            : undefined,
        nativeEvent: nativeEvent as any, // Type compatibility with ThreeEvent
      }

      emitter.emit(eventKey, payload)
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('pointerdown', e)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('pointerup', e)
    }

    const handleClick = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('click', e)
    }

    let lastCameraDragMove = Number.NEGATIVE_INFINITY
    const handlePointerMove = (e: PointerEvent) => {
      // Moves keep tool cursor snapshots current, including wheel zoom during a tool gesture.
      if (useViewer.getState().cameraDragging) {
        const now = performance.now()
        if (now - lastCameraDragMove < CAMERA_DRAG_MOVE_INTERVAL_MS) return
        lastCameraDragMove = now
      } else {
        lastCameraDragMove = Number.NEGATIVE_INFINITY
      }
      timeSpan('pointer', () => emit('move', e))
    }

    const handleDoubleClick = (e: MouseEvent) => {
      if (useViewer.getState().cameraDragging) return
      emit('double-click', e)
    }

    const handleContextMenu = (e: MouseEvent) => {
      if (useViewer.getState().cameraDragging) return
      emit('context-menu', e)
    }

    // Attach listeners to canvas
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('dblclick', handleDoubleClick)
    canvas.addEventListener('contextmenu', handleContextMenu)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('dblclick', handleDoubleClick)
      canvas.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [camera, gl])
}
