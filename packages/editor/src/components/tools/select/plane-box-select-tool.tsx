import '../../../three-types'

import { Icon } from '@iconify/react'
import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { isBoxSelectPointerSuppressed, markBoxSelectHandled } from './box-select-state'
import { collectSelectableCandidateIds } from './select-candidates'

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

const BOX_SELECT_ACCENT_COLOR = '#818cf8'
const DRAG_THRESHOLD_PX = 4
const tempVec = new Vector3()
const tempBox = new Box3()

function pointInBounds(x: number, z: number, b: Bounds): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
}

function segmentsIntersect(
  ax1: number,
  az1: number,
  ax2: number,
  az2: number,
  bx1: number,
  bz1: number,
  bx2: number,
  bz2: number,
): boolean {
  const d1 = cross(bx1, bz1, bx2, bz2, ax1, az1)
  const d2 = cross(bx1, bz1, bx2, bz2, ax2, az2)
  const d3 = cross(ax1, az1, ax2, az2, bx1, bz1)
  const d4 = cross(ax1, az1, ax2, az2, bx2, bz2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  if (d1 === 0 && onSegment(bx1, bz1, bx2, bz2, ax1, az1)) return true
  if (d2 === 0 && onSegment(bx1, bz1, bx2, bz2, ax2, az2)) return true
  if (d3 === 0 && onSegment(ax1, az1, ax2, az2, bx1, bz1)) return true
  if (d4 === 0 && onSegment(ax1, az1, ax2, az2, bx2, bz2)) return true

  return false
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

function onSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  return (
    Math.min(ax, bx) <= cx &&
    cx <= Math.max(ax, bx) &&
    Math.min(az, bz) <= cz &&
    cz <= Math.max(az, bz)
  )
}

function segmentIntersectsBounds(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  b: Bounds,
): boolean {
  if (pointInBounds(x1, z1, b) || pointInBounds(x2, z2, b)) return true

  const edges: [number, number, number, number][] = [
    [b.minX, b.minZ, b.maxX, b.minZ],
    [b.maxX, b.minZ, b.maxX, b.maxZ],
    [b.maxX, b.maxZ, b.minX, b.maxZ],
    [b.minX, b.maxZ, b.minX, b.minZ],
  ]
  for (const [ex1, ez1, ex2, ez2] of edges) {
    if (segmentsIntersect(x1, z1, x2, z2, ex1, ez1, ex2, ez2)) return true
  }
  return false
}

function polygonIntersectsBounds(polygon: [number, number][], b: Bounds): boolean {
  if (polygon.some(([x, z]) => pointInBounds(x, z, b))) return true

  const corners: [number, number][] = [
    [b.minX, b.minZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
    [b.minX, b.maxZ],
  ]
  if (corners.some(([cx, cz]) => pointInPolygon(cx, cz, polygon))) return true

  const edges: [number, number, number, number][] = [
    [b.minX, b.minZ, b.maxX, b.minZ],
    [b.maxX, b.minZ, b.maxX, b.maxZ],
    [b.maxX, b.maxZ, b.minX, b.maxZ],
    [b.minX, b.maxZ, b.minX, b.minZ],
  ]
  for (let i = 0; i < polygon.length; i++) {
    const [px1, pz1] = polygon[i]!
    const [px2, pz2] = polygon[(i + 1) % polygon.length]!
    for (const [ex1, ez1, ex2, ez2] of edges) {
      if (segmentsIntersect(px1, pz1, px2, pz2, ex1, ez1, ex2, ez2)) return true
    }
  }

  return false
}

function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function getNodeWorldXZ(nodeId: string): [number, number] | null {
  const obj = sceneRegistry.nodes.get(nodeId)
  if (!obj) return null
  obj.getWorldPosition(tempVec)
  return [tempVec.x, tempVec.z]
}

function objectBoundsIntersectsBounds(nodeId: string, bounds: Bounds): boolean {
  const obj = sceneRegistry.nodes.get(nodeId)
  if (!obj) return false

  obj.updateWorldMatrix(true, true)
  tempBox.setFromObject(obj)

  if (tempBox.isEmpty()) {
    const xz = getNodeWorldXZ(nodeId)
    return Boolean(xz && pointInBounds(xz[0], xz[1], bounds))
  }

  return !(
    tempBox.max.x < bounds.minX ||
    tempBox.min.x > bounds.maxX ||
    tempBox.max.z < bounds.minZ ||
    tempBox.min.z > bounds.maxZ
  )
}

function collectNodeIdsInPlaneBounds(bounds: Bounds | null): string[] {
  const candidateIds = collectSelectableCandidateIds()
  if (!bounds) return candidateIds

  const { nodes } = useScene.getState()
  return candidateIds.filter((id) => {
    const node = nodes[id as AnyNodeId]
    if (!node) return false

    if (node.type === 'wall' || node.type === 'fence') {
      return segmentIntersectsBounds(node.start[0], node.start[1], node.end[0], node.end[1], bounds)
    }

    if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
      return polygonIntersectsBounds(node.polygon, bounds)
    }

    return objectBoundsIntersectsBounds(id, bounds)
  })
}

function haveSameIds(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length === nextIds.length &&
    currentIds.every((currentId, index) => currentId === nextIds[index])
  )
}

function updateRectVisuals(
  fillMesh: Mesh,
  outline: LineSegments,
  start: Vector3,
  end: Vector3,
  y: number,
) {
  const cx = (start.x + end.x) / 2
  const cz = (start.z + end.z) / 2
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.z - start.z)

  if (w < 0.01 && h < 0.01) {
    fillMesh.visible = false
    outline.visible = false
    return
  }

  fillMesh.visible = true
  fillMesh.position.set(cx, y + 0.02, cz)
  fillMesh.scale.set(w, h, 1)

  outline.visible = true
  const oy = y + 0.03
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const z0 = cz - h / 2
  const z1 = cz + h / 2
  const pos = outline.geometry.attributes.position as BufferAttribute
  pos.setXYZ(0, x0, oy, z0)
  pos.setXYZ(1, x1, oy, z0)
  pos.setXYZ(2, x1, oy, z0)
  pos.setXYZ(3, x1, oy, z1)
  pos.setXYZ(4, x1, oy, z1)
  pos.setXYZ(5, x0, oy, z1)
  pos.setXYZ(6, x0, oy, z1)
  pos.setXYZ(7, x0, oy, z0)
  pos.needsUpdate = true
}

function createOutlineSegments(): LineSegments {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3), 3))

  const material = new LineBasicMaterial({
    color: BOX_SELECT_ACCENT_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.85,
  })

  const segments = new LineSegments(geometry, material)
  segments.layers.set(EDITOR_LAYER)
  segments.renderOrder = 2
  segments.visible = false
  segments.frustumCulled = false

  return segments
}

function getSnappedGridPosition(x: number, z: number): [number, number] {
  return [Math.round(x * 2) / 2, Math.round(z * 2) / 2]
}

function setSnappedPoint(target: Vector3, x: number, y: number, z: number) {
  const [snappedX, snappedZ] = getSnappedGridPosition(x, z)
  target.set(snappedX, y, snappedZ)
}

const BOX_SELECT_TOOLTIP = (
  <Icon
    color="currentColor"
    height={24}
    icon="mdi:select-drag"
    style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))' }}
    width={24}
  />
)

export const PlaneBoxSelectTool: React.FC = () => {
  const { camera, gl } = useThree()
  const setPreviewSelectedIds = useViewer((state) => state.setPreviewSelectedIds)
  const cursorRef = useRef<Group>(null)
  const rectFillRef = useRef<Mesh>(null!)
  const outlineRef = useRef(createOutlineSegments())
  const startPoint = useRef(new Vector3())
  const currentPoint = useRef(new Vector3())
  const pointerDown = useRef(false)
  const isDragging = useRef(false)
  const startClientX = useRef(0)
  const startClientY = useRef(0)
  const gridY = useRef(0)
  const previousGridPosition = useRef<[number, number] | null>(null)
  const previewSelectedIdsRef = useRef<string[]>([])
  const spaceDownRef = useRef(false)
  const raycasterRef = useRef(new Raycaster())
  const pointerNDC = useRef(new Vector2())
  const groundPlane = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const hitPoint = useRef(new Vector3())

  const syncPreviewSelectedIds = useCallback(
    (nextIds: string[]) => {
      if (haveSameIds(previewSelectedIdsRef.current, nextIds)) return
      previewSelectedIdsRef.current = nextIds
      setPreviewSelectedIds(nextIds)
    },
    [setPreviewSelectedIds],
  )

  const resetDrag = useCallback(() => {
    pointerDown.current = false
    isDragging.current = false
    rectFillRef.current.visible = false
    outlineRef.current.visible = false
    syncPreviewSelectedIds([])
  }, [syncPreviewSelectedIds])

  const raycastToGround = useCallback(
    (event: PointerEvent): Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect()
      pointerNDC.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointerNDC.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(pointerNDC.current, camera)
      if (raycasterRef.current.ray.intersectPlane(groundPlane.current, hitPoint.current)) {
        return hitPoint.current
      }
      return null
    },
    [camera, gl],
  )

  useEffect(() => {
    const outline = outlineRef.current
    return () => {
      previewSelectedIdsRef.current = []
      setPreviewSelectedIds([])
      outline.geometry.dispose()
      ;(outline.material as LineBasicMaterial).dispose()
    }
  }, [setPreviewSelectedIds])

  useEffect(() => {
    const unsubscribe = useViewer.subscribe((state) => {
      const levelId = state.selection.levelId
      if (!levelId) return
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) groundPlane.current.constant = -obj.position.y
    })
    const levelId = useViewer.getState().selection.levelId
    if (levelId) {
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) groundPlane.current.constant = -obj.position.y
    }
    return unsubscribe
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceDownRef.current = true
      if (pointerDown.current) {
        resetDrag()
      }
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

    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (spaceDownRef.current) return
      if (isBoxSelectPointerSuppressed(event)) return
      if (useViewer.getState().cameraDragging) return
      if (useViewer.getState().inputDragging) return

      const point = raycastToGround(event)
      if (!point) return

      setSnappedPoint(startPoint.current, point.x, point.y, point.z)
      setSnappedPoint(currentPoint.current, point.x, point.y, point.z)
      gridY.current = point.y
      pointerDown.current = true
      isDragging.current = false
      previousGridPosition.current = getSnappedGridPosition(point.x, point.z)
      startClientX.current = event.clientX
      startClientY.current = event.clientY
      syncPreviewSelectedIds([])
    }

    const onCanvasPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isBoxSelectPointerSuppressed(event) || useViewer.getState().inputDragging) {
        markBoxSelectHandled()
        resetDrag()
        return
      }
      if (!pointerDown.current) return

      if (isDragging.current) {
        const point = raycastToGround(event)
        if (point) setSnappedPoint(currentPoint.current, point.x, point.y, point.z)

        const bounds: Bounds = {
          minX: Math.min(startPoint.current.x, currentPoint.current.x),
          maxX: Math.max(startPoint.current.x, currentPoint.current.x),
          minZ: Math.min(startPoint.current.z, currentPoint.current.z),
          maxZ: Math.max(startPoint.current.z, currentPoint.current.z),
        }

        const ids = collectNodeIdsInPlaneBounds(bounds)
        const shouldAppend = event.metaKey || event.ctrlKey || event.shiftKey
        const { phase, structureLayer } = useEditor.getState()

        if (phase === 'structure' && structureLayer === 'zones') {
          if (ids.length > 0) {
            useViewer.getState().setSelection({ zoneId: ids[0] as ZoneNode['id'] })
          } else if (!shouldAppend) {
            useViewer.getState().setSelection({ zoneId: null })
          }
        } else if (shouldAppend) {
          const currentIds = useViewer.getState().selection.selectedIds
          useViewer.getState().setSelection({
            selectedIds: Array.from(new Set([...currentIds, ...ids])),
          })
        } else {
          const allOnLevel = collectNodeIdsInPlaneBounds(null)
          const { buildingId } = useViewer.getState().selection
          const selectedEntireLevel = allOnLevel.length > 0 && ids.length === allOnLevel.length

          if (selectedEntireLevel && buildingId) {
            useViewer.getState().setSelection({ buildingId })
          } else {
            useViewer.getState().setSelection({ selectedIds: ids })
          }
        }

        markBoxSelectHandled()
      }

      resetDrag()
    }

    canvas.addEventListener('pointerdown', onCanvasPointerDown)
    canvas.addEventListener('pointerup', onCanvasPointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      canvas.removeEventListener('pointerup', onCanvasPointerUp)
    }
  }, [gl, raycastToGround, resetDrag, syncPreviewSelectedIds])

  useEffect(() => {
    const onMove = (event: GridEvent) => {
      const [snappedX, snappedZ] = getSnappedGridPosition(event.position[0], event.position[2])

      if (cursorRef.current) {
        cursorRef.current.position.set(snappedX, event.position[1], snappedZ)
      }

      if (!pointerDown.current) return
      if (isBoxSelectPointerSuppressed(event.nativeEvent)) {
        markBoxSelectHandled()
        resetDrag()
        return
      }
      if (spaceDownRef.current || useViewer.getState().inputDragging) {
        markBoxSelectHandled()
        resetDrag()
        return
      }

      currentPoint.current.set(snappedX, event.position[1], snappedZ)

      const nativeEvent = event.nativeEvent as unknown as PointerEvent
      const dx = nativeEvent.clientX - startClientX.current
      const dy = nativeEvent.clientY - startClientY.current
      if (!isDragging.current && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        isDragging.current = true
      }

      if (isDragging.current && rectFillRef.current && outlineRef.current) {
        updateRectVisuals(
          rectFillRef.current,
          outlineRef.current,
          startPoint.current,
          currentPoint.current,
          gridY.current,
        )

        const nextGridPosition: [number, number] = [snappedX, snappedZ]
        if (
          previousGridPosition.current &&
          (nextGridPosition[0] !== previousGridPosition.current[0] ||
            nextGridPosition[1] !== previousGridPosition.current[1])
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousGridPosition.current = nextGridPosition

        const bounds: Bounds = {
          minX: Math.min(startPoint.current.x, currentPoint.current.x),
          maxX: Math.max(startPoint.current.x, currentPoint.current.x),
          minZ: Math.min(startPoint.current.z, currentPoint.current.z),
          maxZ: Math.max(startPoint.current.z, currentPoint.current.z),
        }
        syncPreviewSelectedIds(collectNodeIdsInPlaneBounds(bounds))
      }
    }

    emitter.on('grid:move', onMove)
    return () => {
      emitter.off('grid:move', onMove)
    }
  }, [resetDrag, syncPreviewSelectedIds])

  return (
    <group>
      <CursorSphere ref={cursorRef} tooltipContent={BOX_SELECT_TOOLTIP} />
      <mesh
        layers={EDITOR_LAYER}
        ref={rectFillRef}
        renderOrder={1}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={BOX_SELECT_ACCENT_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.14}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <primitive object={outlineRef.current} />
    </group>
  )
}
