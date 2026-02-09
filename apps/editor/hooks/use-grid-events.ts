import { type EventSuffix, emitter, type GridEvent } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

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
        return intersectionPoint.current.clone()
      }

      return null
    }

    const emit = (suffix: EventSuffix, nativeEvent: MouseEvent | PointerEvent) => {
      const point = getIntersection(nativeEvent)
      if (!point) return

      const eventKey = `grid:${suffix}` as `grid:${EventSuffix}`
      const payload: GridEvent = {
        position: [point.x, point.y, point.z],
        nativeEvent: nativeEvent as any, // Type compatibility with ThreeEvent
      }

      emitter.emit(eventKey, payload)
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      emit('pointerdown', e)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      emit('pointerup', e)
    }

    const handleClick = (e: PointerEvent) => {
      if (e.button !== 0) return
      emit('click', e)
    }

    const handlePointerMove = (e: PointerEvent) => {
      emit('move', e)
    }

    const handleDoubleClick = (e: MouseEvent) => {
      emit('double-click', e)
    }

    const handleContextMenu = (e: MouseEvent) => {
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
  }, [camera, gl, gridY])
}
