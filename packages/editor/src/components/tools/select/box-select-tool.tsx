import {
  type AnyNode,
  type AnyNodeId,
  isRegistrySelectable,
  type LevelNode,
  nodeRegistry,
  resolveBuildingForLevel,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { Box3, type Camera, type Object3D, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'

/**
 * Module-level flag to prevent the SelectionManager from deselecting
 * on the grid:click that fires right after a box-select drag completes.
 */
export let boxSelectHandled = false

type ScreenRect = { minX: number; minY: number; maxX: number; maxY: number }

const BOX_SELECT_FILL_COLOR = 'rgba(129, 140, 248, 0.14)'
const BOX_SELECT_BORDER_COLOR = 'rgba(129, 140, 248, 0.9)'
const BOX_SELECT_SHADOW_COLOR = 'rgba(129, 140, 248, 0.28)'
const DRAG_THRESHOLD_PX = 4

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

function createSelectionElement(): HTMLDivElement {
  const element = document.createElement('div')
  element.style.position = 'fixed'
  element.style.display = 'none'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '2147483647'
  element.style.border = `1px solid ${BOX_SELECT_BORDER_COLOR}`
  element.style.background = BOX_SELECT_FILL_COLOR
  element.style.boxShadow = `0 0 0 1px ${BOX_SELECT_SHADOW_COLOR} inset`
  element.style.contain = 'layout paint style'
  return element
}

function normalizeScreenRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): ScreenRect {
  return {
    minX: Math.min(startX, endX),
    minY: Math.min(startY, endY),
    maxX: Math.max(startX, endX),
    maxY: Math.max(startY, endY),
  }
}

function updateSelectionElement(element: HTMLDivElement, rect: ScreenRect) {
  element.style.display = 'block'
  element.style.left = `${rect.minX}px`
  element.style.top = `${rect.minY}px`
  element.style.width = `${Math.max(0, rect.maxX - rect.minX)}px`
  element.style.height = `${Math.max(0, rect.maxY - rect.minY)}px`
}

function hideSelectionElement(element: HTMLDivElement | null) {
  if (!element) return
  element.style.display = 'none'
  element.style.width = '0px'
  element.style.height = '0px'
}

function screenRectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return !(b.maxX < a.minX || b.minX > a.maxX || b.maxY < a.minY || b.minY > a.maxY)
}

function screenRectFromDomRect(rect: DOMRect): ScreenRect {
  return {
    minX: rect.left,
    minY: rect.top,
    maxX: rect.right,
    maxY: rect.bottom,
  }
}

function intersectScreenRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const rect = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }

  if (rect.maxX <= rect.minX || rect.maxY <= rect.minY) {
    return null
  }

  return rect
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

function isFurnishSelectableCandidate(node: AnyNode): boolean {
  if (node.type === 'item') {
    return node.asset.category !== 'door' && node.asset.category !== 'window'
  }

  const def = nodeRegistry.get(node.type)
  return Boolean(def?.category === 'furnish' && def.capabilities.selectable)
}

function isStructureSelectableCandidate(node: AnyNode): boolean {
  if (
    node.type === 'wall' ||
    node.type === 'fence' ||
    node.type === 'column' ||
    node.type === 'elevator' ||
    node.type === 'slab' ||
    node.type === 'ceiling' ||
    node.type === 'roof' ||
    node.type === 'stair' ||
    node.type === 'spawn' ||
    node.type === 'window' ||
    node.type === 'door'
  ) {
    return true
  }

  if (node.type === 'item') {
    return node.asset.category === 'door' || node.asset.category === 'window'
  }

  const def = nodeRegistry.get(node.type)
  return Boolean(def && def.category !== 'furnish' && def.capabilities.selectable)
}

function collectSelectableCandidateIds(): string[] {
  const { levelId } = useViewer.getState().selection
  const { nodes } = useScene.getState()
  const { phase, structureLayer } = useEditor.getState()
  const result: string[] = []
  const seen = new Set<string>()
  const addNode = (node: AnyNode | undefined) => {
    if (!node || seen.has(node.id)) return
    seen.add(node.id)
    result.push(node.id)
  }

  if (phase === 'site') {
    for (const node of Object.values(nodes)) {
      if (node.type === 'building') addNode(node)
    }
    return result
  }

  if (!levelId) return []
  const levelNode = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (!levelNode || levelNode.type !== 'level') return []

  if (phase === 'structure' && structureLayer === 'zones') {
    for (const childId of levelNode.children) {
      const node = nodes[childId as AnyNodeId]
      if (node?.type === 'zone') addNode(node)
    }
    return result
  }

  for (const childId of levelNode.children) {
    const node = nodes[childId as AnyNodeId]
    if (!node) continue

    if (phase === 'furnish') {
      if (isFurnishSelectableCandidate(node)) addNode(node)
      continue
    }

    if (node.type === 'wall' || node.type === 'fence') {
      addNode(node)
      const hostedChildren = 'children' in node && Array.isArray(node.children) ? node.children : []
      for (const hostedChildId of hostedChildren) {
        const child = nodes[hostedChildId as AnyNodeId]
        if (!child) continue
        if (
          child.type === 'window' ||
          child.type === 'door' ||
          (child.type === 'item' &&
            (child.asset.category === 'door' || child.asset.category === 'window'))
        ) {
          addNode(child)
        }
      }
      continue
    }

    if (isStructureSelectableCandidate(node)) {
      addNode(node)
    }
  }

  const buildingId = resolveBuildingForLevel(levelId as AnyNodeId, nodes)
  const buildingNode = buildingId ? nodes[buildingId] : undefined
  const buildingChildren =
    buildingNode && 'children' in buildingNode && Array.isArray(buildingNode.children)
      ? (buildingNode.children as AnyNodeId[])
      : []
  for (const childId of buildingChildren) {
    const node = nodes[childId]
    if (!node || node.type === 'level' || !isRegistrySelectable(node.type)) continue
    if (phase === 'furnish') {
      if (isFurnishSelectableCandidate(node)) addNode(node)
    } else if (isStructureSelectableCandidate(node)) {
      addNode(node)
    }
  }

  return result
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
  const isActive = mode === 'select' && (phase === 'structure' || phase === 'furnish')

  if (!isActive) return null

  return <BoxSelectToolInner />
}

const BoxSelectToolInner: React.FC = () => {
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
  const handledResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spaceDownRef = useRef(false)

  const markBoxSelectHandled = useCallback(() => {
    boxSelectHandled = true
    if (handledResetTimeoutRef.current) {
      clearTimeout(handledResetTimeoutRef.current)
    }
    handledResetTimeoutRef.current = setTimeout(() => {
      boxSelectHandled = false
      handledResetTimeoutRef.current = null
    }, 50)
  }, [])

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
    hideSelectionElement(elementRef.current)
    syncPreviewSelectedIds([])

    if (ownsInputDraggingRef.current) {
      useViewer.getState().setInputDragging(false)
      ownsInputDraggingRef.current = false
    }
  }, [syncPreviewSelectedIds])

  useEffect(() => {
    const element = createSelectionElement()
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
  }, [markBoxSelectHandled, resetDrag])

  useEffect(() => {
    const canvas = gl.domElement

    const updateDrag = (event: PointerEvent) => {
      if (!pointerDownRef.current) return
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return

      const viewer = useViewer.getState()
      if (
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

      if (!isDraggingRef.current && dragDistance >= DRAG_THRESHOLD_PX) {
        isDraggingRef.current = true
        ownsInputDraggingRef.current = true
        useViewer.getState().setInputDragging(true)
        markBoxSelectHandled()
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
        hideSelectionElement(elementRef.current)
        syncPreviewSelectedIds([])
        return
      }

      updateSelectionElement(elementRef.current!, clampedRect)
      syncPreviewSelectedIds(collectNodeIdsInScreenRect(clampedRect, camera, canvas))
    }

    const finishDrag = (event: PointerEvent) => {
      if (!pointerDownRef.current) return
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return

      if (useViewer.getState().inputDragging && !ownsInputDraggingRef.current) {
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

      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {}
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
  }, [camera, gl, markBoxSelectHandled, resetDrag, syncPreviewSelectedIds])

  useEffect(() => {
    return () => {
      if (handledResetTimeoutRef.current) {
        clearTimeout(handledResetTimeoutRef.current)
      }
      boxSelectHandled = false
      resetDrag()
    }
  }, [resetDrag])

  return null
}
