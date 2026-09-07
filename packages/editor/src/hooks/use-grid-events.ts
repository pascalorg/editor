import {
  type AnyNodeId,
  type EventSuffix,
  emitter,
  type GridEvent,
  sceneRegistry,
} from '@pascal-app/core'
import { timeSpan, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Matrix3, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { getPlacementSurface } from '../lib/active-placement-surface'
import { resolveTerrainGroundHit } from '../lib/ground-surface'

/**
 * Custom grid events hook that uses manual raycasting instead of mesh events.
 * This ensures grid events work even when other meshes block pointer events with stopPropagation.
 */
export function useGridEvents(gridY: number) {
  const { camera, gl } = useThree()
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const groundPlane = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const intersectionPoint = useRef(new Vector3())

  type GridIntersection = {
    point: Vector3
    surface?: {
      point: Vector3
      object: Object3D
      worldNormal?: Vector3
    }
  }

  // Update ground plane when grid Y changes
  useEffect(() => {
    groundPlane.current.constant = -gridY
  }, [gridY])

  useEffect(() => {
    const canvas = gl.domElement

    const getSurfaceIntersection = (): GridIntersection | null => {
      const surfaceTypes = ['wall', 'ceiling', 'slab', 'roof'] as const
      let closest: GridIntersection | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      for (const type of surfaceTypes) {
        for (const id of sceneRegistry.byType[type] ?? []) {
          const root = sceneRegistry.nodes.get(id)
          if (!root) continue
          const hit = raycaster.current.intersectObject(root, true)[0]
          if (!hit || hit.distance >= closestDistance) continue
          closestDistance = hit.distance
          const worldNormal = hit.face
            ? hit.face.normal
                .clone()
                .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
                .normalize()
            : undefined
          closest = {
            point: hit.point.clone(),
            surface: { point: hit.point.clone(), object: hit.object, worldNormal },
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
      const surfaceHit = getSurfaceIntersection()

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
          surface: surfaceHit?.surface,
        }
      }

      // Intersect with ground plane
      if (raycaster.current.ray.intersectPlane(groundPlane.current, intersectionPoint.current)) {
        return { point: intersectionPoint.current.clone(), surface: surfaceHit?.surface }
      }

      return surfaceHit
    }

    const emit = (suffix: EventSuffix, nativeEvent: MouseEvent | PointerEvent) => {
      const point = getIntersection(nativeEvent)
      if (!point) return

      // Convert world-space point to building-local for tools that live inside a building.
      const buildingId = useViewer.getState().selection.buildingId
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
      const { origin, direction } = raycaster.current.ray
      const localRayOrigin = buildingMesh
        ? buildingMesh.worldToLocal(origin.clone())
        : origin.clone()
      const localRayDirection = buildingMesh
        ? buildingMesh.worldToLocal(origin.clone().add(direction)).sub(localRayOrigin).normalize()
        : direction.clone()

      const eventKey = `grid:${suffix}` as `grid:${EventSuffix}`
      const payload: GridEvent = {
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

    const handlePointerMove = (e: PointerEvent) => {
      // Emit move even if camera is dragging, so tools like PolygonEditor still work
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
