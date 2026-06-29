import { sceneRegistry, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { Box3, type Camera, type Object3D, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  clearBoxSelectHandled,
  isBoxSelectPointerSuppressed,
  markBoxSelectHandled,
} from './box-select-state'
import { PlaneBoxSelectTool } from './plane-box-select-tool'
import {
  createScreenRectangleSelectionElement,
  hideScreenRectangleSelectionElement,
  intersectScreenRects,
  normalizeScreenRect,
  SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX,
  type ScreenRect,
  screenRectFromDomRect,
  screenRectsIntersect,
  updateScreenRectangleSelectionElement,
} from './screen-rectangle-selection'
import { collectSelectableCandidateIds } from './select-candidates'

const tempBox = new Box3()
const tempWorldPoint = new Vector3()
const tempScreenPoint = new Vector3()
const boxCorners = [
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
]

function haveSameIds(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length === nextIds.length &&
    currentIds.every((currentId, index) => currentId === nextIds[index])
  )
}

function projectWorldPointToScreen(
  point: Vector3,
  camera: Camera,
  canvasRect: DOMRect,
): [number, number] | null {
  tempScreenPoint.copy(point).project(camera)
  if (tempScreenPoint.z < -1 || tempScreenPoint.z > 1) return null

  return [
    canvasRect.left + (tempScreenPoint.x * 0.5 + 0.5) * canvasRect.width,
    canvasRect.top + (-tempScreenPoint.y * 0.5 + 0.5) * canvasRect.height,
  ]
}

function getObjectScreenRect(
  object: Object3D,
  camera: Camera,
  canvasRect: DOMRect,
): ScreenRect | null {
  object.updateWorldMatrix(true, true)
  tempBox.setFromObject(object)

  if (tempBox.isEmpty()) {
    object.getWorldPosition(tempWorldPoint)
    const projected = projectWorldPointToScreen(tempWorldPoint, camera, canvasRect)
    if (!projected) return null
    const [x, y] = projected
    return { minX: x, minY: y, maxX: x, maxY: y }
  }

  boxCorners[0]!.set(tempBox.min.x, tempBox.min.y, tempBox.min.z)
  boxCorners[1]!.set(tempBox.min.x, tempBox.min.y, tempBox.max.z)
  boxCorners[2]!.set(tempBox.min.x, tempBox.max.y, tempBox.min.z)
  boxCorners[3]!.set(tempBox.min.x, tempBox.max.y, tempBox.max.z)
  boxCorners[4]!.set(tempBox.max.x, tempBox.min.y, tempBox.min.z)
  boxCorners[5]!.set(tempBox.max.x, tempBox.min.y, tempBox.max.z)
  boxCorners[6]!.set(tempBox.max.x, tempBox.max.y, tempBox.min.z)
  boxCorners[7]!.set(tempBox.max.x, tempBox.max.y, tempBox.max.z)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const corner of boxCorners) {
    const projected = projectWorldPointToScreen(corner, camera, canvasRect)
    if (!projected) continue
    const [x, y] = projected
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  if (minX !== Number.POSITIVE_INFINITY) {
    return { minX, minY, maxX, maxY }
  }

  object.getWorldPosition(tempWorldPoint)
  const projected = projectWorldPointToScreen(tempWorldPoint, camera, canvasRect)
  if (!projected) return null
  const [x, y] = projected
  return { minX: x, minY: y, maxX: x, maxY: y }
}

function isObjectVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function collectNodeIdsInScreenRect(
  rect: ScreenRect,
  camera: Camera,
  canvas: HTMLCanvasElement,
): string[] {
  const canvasRect = canvas.getBoundingClientRect()
  const result: string[] = []

  for (const id of collectSelectableCandidateIds()) {
    const object = sceneRegistry.nodes.get(id)
    if (!object || !isObjectVisible(object)) continue
    const objectRect = getObjectScreenRect(object, camera, canvasRect)
    if (objectRect && screenRectsIntersect(rect, objectRect)) {
      result.push(id)
    }
  }

  return result
}

function commitBoxSelection(ids: string[], event: PointerEvent) {
  const shouldAppend = event.metaKey || event.ctrlKey
  const { phase, structureLayer } = useEditor.getState()
  const viewer = useViewer.getState()

  if (phase === 'structure' && structureLayer === 'zones') {
    if (ids.length > 0) {
      viewer.setSelection({ zoneId: ids[0] as ZoneNode['id'] })
    } else if (!shouldAppend) {
      viewer.setSelection({ zoneId: null })
    }
    return
  }

  if (shouldAppend) {
    viewer.setSelection({
      selectedIds: Array.from(new Set([...viewer.selection.selectedIds, ...ids])),
    })
    return
  }

  viewer.setSelection({ selectedIds: ids })
}

export const BoxSelectTool: React.FC = () => {
  const phase = useEditor((s) => s.phase)
  const mode = useEditor((s) => s.mode)
  const selectionTool = useEditor((s) => s.floorplanSelectionTool)
  const isActive = mode === 'select' && (phase === 'structure' || phase === 'furnish')

  if (!isActive) return null

  if (selectionTool === 'marquee') {
    return <PlaneBoxSelectTool />
  }

  return <ScreenRectangleSelectTool />
}

const ScreenRectangleSelectTool: React.FC = () => {
  const { camera, gl } = useThree()
  const setPreviewSelectedIds = useViewer((state) => state.setPreviewSelectedIds)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const previewSelectedIdsRef = useRef<string[]>([])
  const pointerDownRef = useRef(false)
  const isDraggingRef = useRef(false)
  const ownsInputDraggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const startClientXRef = useRef(0)
  const startClientYRef = useRef(0)
  const currentClientXRef = useRef(0)
  const currentClientYRef = useRef(0)
  const spaceDownRef = useRef(false)
  // rAF throttle for the expensive marquee preview pass. pointermove can fire
  // several times per animation frame; the per-node AABB projection in
  // `collectNodeIdsInScreenRect` only needs to run once per frame. We stash the
  // latest clamped rect and process it inside the rAF callback.
  const previewRafRef = useRef<number | null>(null)
  const pendingPreviewRectRef = useRef<ScreenRect | null>(null)

  const syncPreviewSelectedIds = useCallback(
    (nextIds: string[]) => {
      if (haveSameIds(previewSelectedIdsRef.current, nextIds)) return

      previewSelectedIdsRef.current = nextIds
      setPreviewSelectedIds(nextIds)
    },
    [setPreviewSelectedIds],
  )

  const resetDrag = useCallback(() => {
    pointerDownRef.current = false
    isDraggingRef.current = false
    pointerIdRef.current = null
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current)
      previewRafRef.current = null
    }
    pendingPreviewRectRef.current = null
    hideScreenRectangleSelectionElement(elementRef.current)
    syncPreviewSelectedIds([])

    if (ownsInputDraggingRef.current) {
      useViewer.getState().setInputDragging(false)
      ownsInputDraggingRef.current = false
    }
    useInteractionScope.getState().endIf((s) => s.kind === 'box-select')
  }, [syncPreviewSelectedIds])

  useEffect(() => {
    const element = createScreenRectangleSelectionElement()
    document.body.appendChild(element)
    elementRef.current = element

    return () => {
      element.remove()
      elementRef.current = null
    }
  }, [])

  useEffect(() => {
    const cancelForSpace = () => {
      if (!pointerDownRef.current) return
      markBoxSelectHandled()
      resetDrag()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceDownRef.current = true
      cancelForSpace()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceDownRef.current = false
    }

    const onBlur = () => {
      spaceDownRef.current = false
      resetDrag()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [resetDrag])

  useEffect(() => {
    const canvas = gl.domElement

    const flushPreview = () => {
      previewRafRef.current = null
      const rect = pendingPreviewRectRef.current
      if (!rect) return
      pendingPreviewRectRef.current = null
      syncPreviewSelectedIds(collectNodeIdsInScreenRect(rect, camera, canvas))
    }

    const updateDrag = (event: PointerEvent) => {
      if (!pointerDownRef.current) return
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return

      const viewer = useViewer.getState()
      if (
        isBoxSelectPointerSuppressed(event) ||
        spaceDownRef.current ||
        viewer.cameraDragging ||
        (viewer.inputDragging && !ownsInputDraggingRef.current)
      ) {
        markBoxSelectHandled()
        resetDrag()
        return
      }

      currentClientXRef.current = event.clientX
      currentClientYRef.current = event.clientY

      const dragDistance = Math.hypot(
        currentClientXRef.current - startClientXRef.current,
        currentClientYRef.current - startClientYRef.current,
      )

      if (!isDraggingRef.current && dragDistance >= SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX) {
        isDraggingRef.current = true
        ownsInputDraggingRef.current = true
        useViewer.getState().setInputDragging(true)
        useInteractionScope.getState().begin({ kind: 'box-select' })
        markBoxSelectHandled()
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {}
      }

      if (!isDraggingRef.current) return

      event.preventDefault()
      const rect = normalizeScreenRect(
        startClientXRef.current,
        startClientYRef.current,
        currentClientXRef.current,
        currentClientYRef.current,
      )
      const clampedRect = intersectScreenRects(
        rect,
        screenRectFromDomRect(canvas.getBoundingClientRect()),
      )
      if (!clampedRect) {
        if (previewRafRef.current !== null) {
          cancelAnimationFrame(previewRafRef.current)
          previewRafRef.current = null
        }
        pendingPreviewRectRef.current = null
        hideScreenRectangleSelectionElement(elementRef.current)
        syncPreviewSelectedIds([])
        return
      }

      updateScreenRectangleSelectionElement(elementRef.current!, clampedRect)
      // Coalesce the per-node AABB projection to one run per animation frame.
      pendingPreviewRectRef.current = clampedRect
      if (previewRafRef.current === null) {
        previewRafRef.current = requestAnimationFrame(flushPreview)
      }
    }

    const finishDrag = (event: PointerEvent) => {
      if (!pointerDownRef.current) return
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return

      if (
        isBoxSelectPointerSuppressed(event) ||
        (useViewer.getState().inputDragging && !ownsInputDraggingRef.current)
      ) {
        markBoxSelectHandled()
        resetDrag()
        return
      }

      if (isDraggingRef.current) {
        event.preventDefault()
        event.stopPropagation()
        markBoxSelectHandled()

        const rect = normalizeScreenRect(
          startClientXRef.current,
          startClientYRef.current,
          event.clientX,
          event.clientY,
        )
        const clampedRect = intersectScreenRects(
          rect,
          screenRectFromDomRect(canvas.getBoundingClientRect()),
        )
        const ids = clampedRect ? collectNodeIdsInScreenRect(clampedRect, camera, canvas) : []
        commitBoxSelection(ids, event)
      }

      try {
        canvas.releasePointerCapture(event.pointerId)
      } catch {}

      resetDrag()
    }

    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (spaceDownRef.current) return
      if (isBoxSelectPointerSuppressed(event)) return

      const viewer = useViewer.getState()
      if (viewer.cameraDragging || viewer.inputDragging) return

      pointerDownRef.current = true
      isDraggingRef.current = false
      pointerIdRef.current = event.pointerId
      startClientXRef.current = event.clientX
      startClientYRef.current = event.clientY
      currentClientXRef.current = event.clientX
      currentClientYRef.current = event.clientY
      syncPreviewSelectedIds([])
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return
      resetDrag()
    }

    canvas.addEventListener('pointerdown', onCanvasPointerDown)
    window.addEventListener('pointermove', updateDrag, { passive: false })
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', onPointerCancel)

    return () => {
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      window.removeEventListener('pointermove', updateDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', onPointerCancel)
      resetDrag()
    }
  }, [camera, gl, resetDrag, syncPreviewSelectedIds])

  useEffect(() => {
    return () => {
      clearBoxSelectHandled()
      resetDrag()
    }
  }, [resetDrag])

  return null
}
