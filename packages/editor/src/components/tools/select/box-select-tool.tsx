import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import {
  Box3,
  type Camera,
  Matrix4,
  type Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  clearBoxSelectHandled,
  isBoxSelectPointerSuppressed,
  markBoxSelectHandled,
} from './box-select-state'
import {
  convexHull2D,
  type Point2,
  polygonsIntersect,
  rectIntersectsHull,
  segmentIntersectsPolygon,
} from './marquee-geometry'
import { PlaneBoxSelectTool } from './plane-box-select-tool'
import {
  createScreenRectangleSelectionElement,
  hideScreenRectangleSelectionElement,
  intersectScreenRects,
  normalizeScreenRect,
  SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX,
  type ScreenRect,
  screenRectFromDomRect,
  updateScreenRectangleSelectionElement,
} from './screen-rectangle-selection'
import { collectSelectableCandidateIds } from './select-candidates'

const tempBox = new Box3()
const tempChildBox = new Box3()
const tempInvWorld = new Matrix4()
const tempRelMatrix = new Matrix4()
const tempWorldPoint = new Vector3()
const tempScreenPoint = new Vector3()
const tempNDC = new Vector2()
const tempPlane = new Plane()
const tempRaycaster = new Raycaster()
const UP = new Vector3(0, 1, 0)
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

/**
 * Union bounding box of the object's mesh geometry in the OBJECT's OWN frame
 * (an oriented box). The world AABB the previous implementation used inflates
 * around rotated geometry — a diagonal wall's world AABB spans a whole square
 * — and projecting THAT to a screen AABB inflates again, which made the
 * marquee select objects visually far from the cursor.
 */
function computeLocalBox(object: Object3D): Box3 | null {
  tempBox.makeEmpty()
  tempInvWorld.copy(object.matrixWorld).invert()
  object.traverse((child) => {
    const mesh = child as {
      isMesh?: boolean
      geometry?: { boundingBox: Box3 | null; computeBoundingBox: () => void }
      matrixWorld: import('three').Matrix4
    }
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const bounds = mesh.geometry.boundingBox
    if (!bounds || bounds.isEmpty()) return
    tempChildBox.copy(bounds)
    tempRelMatrix.multiplyMatrices(tempInvWorld, mesh.matrixWorld)
    tempChildBox.applyMatrix4(tempRelMatrix)
    tempBox.union(tempChildBox)
  })
  return tempBox.isEmpty() ? null : tempBox
}

/** Screen-space convex hull of the object's oriented bounding box. */
function getObjectScreenHull(
  object: Object3D,
  camera: Camera,
  canvasRect: DOMRect,
): Point2[] | null {
  object.updateWorldMatrix(true, true)
  const localBox = computeLocalBox(object)

  if (!localBox) {
    object.getWorldPosition(tempWorldPoint)
    const projected = projectWorldPointToScreen(tempWorldPoint, camera, canvasRect)
    return projected ? [projected] : null
  }

  boxCorners[0]!.set(localBox.min.x, localBox.min.y, localBox.min.z)
  boxCorners[1]!.set(localBox.min.x, localBox.min.y, localBox.max.z)
  boxCorners[2]!.set(localBox.min.x, localBox.max.y, localBox.min.z)
  boxCorners[3]!.set(localBox.min.x, localBox.max.y, localBox.max.z)
  boxCorners[4]!.set(localBox.max.x, localBox.min.y, localBox.min.z)
  boxCorners[5]!.set(localBox.max.x, localBox.min.y, localBox.max.z)
  boxCorners[6]!.set(localBox.max.x, localBox.max.y, localBox.min.z)
  boxCorners[7]!.set(localBox.max.x, localBox.max.y, localBox.max.z)

  const projectedPoints: Point2[] = []
  for (const corner of boxCorners) {
    corner.applyMatrix4(object.matrixWorld)
    const projected = projectWorldPointToScreen(corner, camera, canvasRect)
    if (projected) projectedPoints.push(projected)
  }

  if (projectedPoints.length === 0) {
    object.getWorldPosition(tempWorldPoint)
    const projected = projectWorldPointToScreen(tempWorldPoint, camera, canvasRect)
    return projected ? [projected] : null
  }

  return convexHull2D(projectedPoints)
}

function isObjectVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

const isVec2 = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')
const isVec2Array = (v: unknown): v is [number, number][] =>
  Array.isArray(v) && v.length > 0 && v.every(isVec2)

/**
 * The marquee rect projected onto the active level's floor plane, in the
 * LEVEL frame — a convex quad (perspective keeps rect convexity). Null when
 * any corner ray misses the plane (camera near the horizon); callers fall
 * back to the screen-hull test then.
 */
function marqueeGroundQuad(rect: ScreenRect, camera: Camera, canvasRect: DOMRect): Point2[] | null {
  const levelId = useViewer.getState().selection.levelId
  const levelObject = levelId ? sceneRegistry.nodes.get(levelId) : null
  if (!levelObject) return null
  levelObject.updateWorldMatrix(true, false)
  tempInvWorld.copy(levelObject.matrixWorld).invert()
  levelObject.getWorldPosition(tempWorldPoint)
  tempPlane.set(UP, -tempWorldPoint.y)

  const corners: [number, number][] = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ]
  const quad: Point2[] = []
  for (const [cx, cy] of corners) {
    tempNDC.set(
      ((cx - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((cy - canvasRect.top) / canvasRect.height) * 2 + 1,
    )
    tempRaycaster.setFromCamera(tempNDC, camera)
    if (!tempRaycaster.ray.intersectPlane(tempPlane, tempWorldPoint)) return null
    tempWorldPoint.applyMatrix4(tempInvWorld)
    quad.push([tempWorldPoint.x, tempWorldPoint.z])
  }
  return quad
}

function collectNodeIdsInScreenRect(
  rect: ScreenRect,
  camera: Camera,
  canvas: HTMLCanvasElement,
): string[] {
  const canvasRect = canvas.getBoundingClientRect()
  const result: string[] = []

  // Plan-footprint membership for the data kinds (walls / fences by their
  // segment, slabs / ceilings / zones by their polygon) — exact under any
  // rotation, matching the plane-marquee tool's semantics. Kinds whose
  // placement lives in mesh transforms (items, columns, …) intersect the
  // marquee with their oriented bbox projected to a screen hull instead.
  const quad = marqueeGroundQuad(rect, camera, canvasRect)
  const nodes = useScene.getState().nodes

  for (const id of collectSelectableCandidateIds()) {
    const object = sceneRegistry.nodes.get(id)
    if (!object || !isObjectVisible(object)) continue

    if (quad) {
      const node = nodes[id as keyof typeof nodes] as
        | { start?: unknown; end?: unknown; polygon?: unknown }
        | undefined
      if (node) {
        const { start, end, polygon } = node
        if (isVec2(start) && isVec2(end)) {
          if (segmentIntersectsPolygon(start, end, quad)) result.push(id)
          continue
        }
        if (isVec2Array(polygon)) {
          if (polygonsIntersect(polygon, quad)) result.push(id)
          continue
        }
      }
    }

    const hull = getObjectScreenHull(object, camera, canvasRect)
    if (hull && rectIntersectsHull(rect, hull)) {
      result.push(id)
    }
  }

  return result
}

function commitBoxSelection(ids: string[], event: PointerEvent) {
  const shouldAppend = event.metaKey || event.ctrlKey || event.shiftKey
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
