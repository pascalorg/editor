import {
  type AnyNodeId,
  type EventSuffix,
  emitter,
  type GridEvent,
  sceneRegistry,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

/** Latest building-local cursor position from grid pointermove (for drag tool warm-start). */
export const lastGridMoveRef: {
  position: [number, number, number] | null
  localPosition: [number, number, number] | null
} = { position: null, localPosition: null }

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
  const localPoint = useRef(new Vector3())

  // Update ground plane when grid Y changes
  useEffect(() => {
    groundPlane.current.constant = -gridY
  }, [gridY])

  useEffect(() => {
    const canvas = gl.domElement

    const getIntersection = (nativeEvent: MouseEvent | PointerEvent): Vector3 | null => {
      // Convert mouse position to normalized device coordinates (-1 to +1)
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1

      // Update raycaster
      raycaster.current.setFromCamera(pointer.current, camera)

      // Intersect with ground plane
      if (raycaster.current.ray.intersectPlane(groundPlane.current, intersectionPoint.current)) {
        return intersectionPoint.current
      }

      return null
    }

    const emit = (suffix: EventSuffix, nativeEvent: MouseEvent | PointerEvent) => {
      const point = getIntersection(nativeEvent)
      if (!point) return

      // Convert world-space point to building-local for tools that live inside a building.
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      const local = buildingMesh ? buildingMesh.worldToLocal(localPoint.current.copy(point)) : point

      const eventKey = `grid:${suffix}` as `grid:${EventSuffix}`
      const payload: GridEvent = {
        position: [point.x, point.y, point.z],
        localPosition: [local.x, local.y, local.z],
        nativeEvent: nativeEvent as any, // Type compatibility with ThreeEvent
      }

      emitter.emit(eventKey, payload)
      if (suffix === 'move') {
        lastGridMoveRef.position = payload.position
        lastGridMoveRef.localPosition = payload.localPosition
      }
    }

    let pendingMoveEvent: PointerEvent | null = null
    let pendingMoveFrame: number | null = null

    const flushPointerMove = () => {
      if (pendingMoveFrame !== null) {
        cancelAnimationFrame(pendingMoveFrame)
      }
      pendingMoveFrame = null
      const event = pendingMoveEvent
      pendingMoveEvent = null
      if (event) {
        // Emit move even if camera is dragging, so tools like PolygonEditor still work
        emit('move', event)
      }
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      flushPointerMove()
      emit('pointerdown', e)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      flushPointerMove()
      emit('pointerup', e)
    }

    const handleClick = (e: PointerEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      flushPointerMove()
      emit('click', e)
    }

    const handlePointerMove = (e: PointerEvent) => {
      pendingMoveEvent = e
      if (pendingMoveFrame !== null) return
      pendingMoveFrame = requestAnimationFrame(flushPointerMove)
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
    window.addEventListener('pointerup', flushPointerMove, { capture: true })

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('dblclick', handleDoubleClick)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', flushPointerMove, { capture: true })
      if (pendingMoveFrame !== null) {
        cancelAnimationFrame(pendingMoveFrame)
      }
    }
  }, [camera, gl])
}
