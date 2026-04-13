import { Icon } from '@iconify/react'
import {
  type AnyNodeId,
  type CeilingNode,
  emitter,
  type GridEvent,
  type ItemNode,
  type LevelNode,
  type SlabNode,
  sceneRegistry,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
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

/**
 * Module-level flag to prevent the SelectionManager from deselecting
 * on the grid:click that fires right after a box-select drag completes.
 */
export let boxSelectHandled = false

// ── Geometry helpers ────────────────────────────────────────────────────────

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

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

  if (d1 === 0 && onSeg(bx1, bz1, bx2, bz2, ax1, az1)) return true
  if (d2 === 0 && onSeg(bx1, bz1, bx2, bz2, ax2, az2)) return true
  if (d3 === 0 && onSeg(ax1, az1, ax2, az2, bx1, bz1)) return true
  if (d4 === 0 && onSeg(ax1, az1, ax2, az2, bx2, bz2)) return true

  return false
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

function onSeg(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
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

// ── Node-in-bounds checks ───────────────────────────────────────────────────

const _tempVec = new Vector3()
const _tempBox = new Box3()

function getNodeWorldXZ(nodeId: string): [number, number] | null {
  const obj = sceneRegistry.nodes.get(nodeId)
  if (!obj) return null
  obj.getWorldPosition(_tempVec)
  return [_tempVec.x, _tempVec.z]
}

function objectBoundsIntersectsBounds(nodeId: string, bounds: Bounds): boolean {
  const obj = sceneRegistry.nodes.get(nodeId)
  if (!obj) return false

  obj.updateWorldMatrix(true, true)
  _tempBox.setFromObject(obj)

  if (_tempBox.isEmpty()) {
    const xz = getNodeWorldXZ(nodeId)
    return Boolean(xz && pointInBounds(xz[0], xz[1], bounds))
  }

  return !(
    _tempBox.max.x < bounds.minX ||
    _tempBox.min.x > bounds.maxX ||
    _tempBox.max.z < bounds.minZ ||
    _tempBox.min.z > bounds.maxZ
  )
}

function collectNodeIdsInBounds(bounds: Bounds): string[] {
  const { levelId } = useViewer.getState().selection
  const { nodes } = useScene.getState()
  const { phase, structureLayer } = useEditor.getState()

  if (!levelId) return []
  const levelNode = nodes[levelId] as LevelNode | undefined
  if (!levelNode || levelNode.type !== 'level') return []

  const result: string[] = []

  if (phase === 'structure' && structureLayer === 'elements') {
    for (const childId of levelNode.children) {
      const node = nodes[childId as AnyNodeId]
      if (!node) continue

      if (node.type === 'wall' || node.type === 'fence') {
        const wall = node as WallNode
        if (
          segmentIntersectsBounds(wall.start[0], wall.start[1], wall.end[0], wall.end[1], bounds)
        ) {
          result.push(wall.id)
        }
        // Check wall children (doors/windows)
        for (const itemId of Array.isArray(wall.children) ? wall.children : []) {
          const child = nodes[itemId as AnyNodeId]
          if (!child) continue
          if (
            child.type === 'window' ||
            child.type === 'door' ||
            (child.type === 'item' &&
              ((child as ItemNode).asset.category === 'door' ||
                (child as ItemNode).asset.category === 'window'))
          ) {
            const xz = getNodeWorldXZ(child.id)
            if (xz && pointInBounds(xz[0], xz[1], bounds)) {
              result.push(child.id)
            }
          }
        }
      } else if (node.type === 'slab') {
        const slab = node as SlabNode
        if (polygonIntersectsBounds(slab.polygon, bounds)) {
          result.push(slab.id)
        }
      } else if (node.type === 'ceiling') {
        const ceiling = node as CeilingNode
        if (polygonIntersectsBounds(ceiling.polygon, bounds)) {
          result.push(ceiling.id)
        }
      } else if (node.type === 'roof') {
        const xz = getNodeWorldXZ(node.id)
        if (xz && pointInBounds(xz[0], xz[1], bounds)) {
          result.push(node.id)
        }
      } else if (node.type === 'stair') {
        if (objectBoundsIntersectsBounds(node.id, bounds)) {
          result.push(node.id)
        }
      }
    }
  } else if (phase === 'structure' && structureLayer === 'zones') {
    for (const childId of levelNode.children) {
      const node = nodes[childId as AnyNodeId]
      if (!node || node.type !== 'zone') continue
      const zone = node as ZoneNode
      if (polygonIntersectsBounds(zone.polygon, bounds)) {
        result.push(zone.id)
      }
    }
  } else if (phase === 'furnish') {
    for (const childId of levelNode.children) {
      const node = nodes[childId as AnyNodeId]
      if (!node) continue
      if (node.type === 'item') {
        const item = node as ItemNode
        if (item.asset.category === 'door' || item.asset.category === 'window') continue
        const xz = getNodeWorldXZ(item.id)
        if (xz && pointInBounds(xz[0], xz[1], bounds)) {
          result.push(item.id)
        }
      }
    }
  }

  return result
}

function haveSameIds(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length === nextIds.length &&
    currentIds.every((currentId, index) => currentId === nextIds[index])
  )
}

// ── Visual helpers ──────────────────────────────────────────────────────────

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

  // Fill rect (unit plane scaled)
  fillMesh.visible = true
  fillMesh.position.set(cx, y + 0.02, cz)
  fillMesh.scale.set(w, h, 1)

  // Outline — 4 edges as line segment pairs (8 vertices)
  outline.visible = true
  const oy = y + 0.03
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const z0 = cz - h / 2
  const z1 = cz + h / 2
  const pos = outline.geometry.attributes.position as BufferAttribute
  // bottom: (x0,z0)→(x1,z0)
  pos.setXYZ(0, x0, oy, z0)
  pos.setXYZ(1, x1, oy, z0)
  // right: (x1,z0)→(x1,z1)
  pos.setXYZ(2, x1, oy, z0)
  pos.setXYZ(3, x1, oy, z1)
  // top: (x1,z1)→(x0,z1)
  pos.setXYZ(4, x1, oy, z1)
  pos.setXYZ(5, x0, oy, z1)
  // left: (x0,z1)→(x0,z0)
  pos.setXYZ(6, x0, oy, z1)
  pos.setXYZ(7, x0, oy, z0)
  pos.needsUpdate = true
}

// ── Outline geometry (allocated once, reused) ───────────────────────────────

function createOutlineSegments(): LineSegments {
  const geo = new BufferGeometry()
  // 4 edges × 2 vertices each = 8 vertices
  const positions = new Float32Array(8 * 3)
  geo.setAttribute('position', new BufferAttribute(positions, 3))

  const mat = new LineBasicMaterial({
    color: BOX_SELECT_ACCENT_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.85,
  })

  const segments = new LineSegments(geo, mat)
  segments.layers.set(EDITOR_LAYER)
  segments.renderOrder = 2
  segments.visible = false
  segments.frustumCulled = false

  return segments
}

// ── Drag threshold (pixels) ─────────────────────────────────────────────────

const BOX_SELECT_ACCENT_COLOR = '#818cf8'
const DRAG_THRESHOLD_PX = 4

function getSnappedGridPosition(x: number, z: number): [number, number] {
  return [Math.round(x * 2) / 2, Math.round(z * 2) / 2]
}

function setSnappedPoint(target: Vector3, x: number, y: number, z: number) {
  const [snappedX, snappedZ] = getSnappedGridPosition(x, z)
  target.set(snappedX, y, snappedZ)
}

// ── Component ───────────────────────────────────────────────────────────────

export const BoxSelectTool: React.FC = () => {
  const mode = useEditor((s) => s.mode)
  const selectionTool = useEditor((s) => s.floorplanSelectionTool)
  const isActive = mode === 'select' && selectionTool === 'marquee'

  if (!isActive) return null

  return <BoxSelectToolInner />
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

const BoxSelectToolInner: React.FC = () => {
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

  // Raycasting helpers (same technique as useGridEvents)
  const raycasterRef = useRef(new Raycaster())
  const pointerNDC = useRef(new Vector2())
  const groundPlane = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const hitPoint = useRef(new Vector3())

  // Cleanup outline geometry on unmount
  useEffect(() => {
    const outline = outlineRef.current
    return () => {
      previewSelectedIdsRef.current = []
      setPreviewSelectedIds([])
      outline.geometry.dispose()
      ;(outline.material as LineBasicMaterial).dispose()
    }
  }, [setPreviewSelectedIds])

  const syncPreviewSelectedIds = (nextIds: string[]) => {
    if (haveSameIds(previewSelectedIdsRef.current, nextIds)) {
      return
    }

    previewSelectedIdsRef.current = nextIds
    setPreviewSelectedIds(nextIds)
  }

  // Sync ground plane Y with the current level
  useEffect(() => {
    const unsubscribe = useViewer.subscribe((state) => {
      const levelId = state.selection.levelId
      if (!levelId) return
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) groundPlane.current.constant = -obj.position.y
    })
    // Set initial value
    const levelId = useViewer.getState().selection.levelId
    if (levelId) {
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) groundPlane.current.constant = -obj.position.y
    }
    return unsubscribe
  }, [])

  const raycastToGround = (e: PointerEvent): Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    pointerNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointerNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerNDC.current, camera)
    if (raycasterRef.current.ray.intersectPlane(groundPlane.current, hitPoint.current)) {
      return hitPoint.current
    }
    return null
  }

  useEffect(() => {
    const canvas = gl.domElement

    const onCanvasPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (useViewer.getState().cameraDragging) return

      const point = raycastToGround(e)
      if (!point) return

      setSnappedPoint(startPoint.current, point.x, point.y, point.z)
      setSnappedPoint(currentPoint.current, point.x, point.y, point.z)
      gridY.current = point.y
      pointerDown.current = true
      isDragging.current = false
      previousGridPosition.current = getSnappedGridPosition(point.x, point.z)
      startClientX.current = e.clientX
      startClientY.current = e.clientY
      syncPreviewSelectedIds([])
    }

    const onCanvasPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!pointerDown.current) return

      if (isDragging.current) {
        const point = raycastToGround(e)
        if (point) setSnappedPoint(currentPoint.current, point.x, point.y, point.z)

        const bounds: Bounds = {
          minX: Math.min(startPoint.current.x, currentPoint.current.x),
          maxX: Math.max(startPoint.current.x, currentPoint.current.x),
          minZ: Math.min(startPoint.current.z, currentPoint.current.z),
          maxZ: Math.max(startPoint.current.z, currentPoint.current.z),
        }

        const ids = collectNodeIdsInBounds(bounds)

        const shouldAppend = e.metaKey || e.ctrlKey
        const { phase, structureLayer } = useEditor.getState()

        if (phase === 'structure' && structureLayer === 'zones') {
          if (ids.length > 0) {
            useViewer.getState().setSelection({ zoneId: ids[0] as ZoneNode['id'] })
          } else if (!shouldAppend) {
            useViewer.getState().setSelection({ zoneId: null })
          }
        } else if (shouldAppend) {
          const currentIds = useViewer.getState().selection.selectedIds
          const merged = Array.from(new Set([...currentIds, ...ids]))
          useViewer.getState().setSelection({ selectedIds: merged })
        } else {
          useViewer.getState().setSelection({ selectedIds: ids })
        }

        // Prevent the subsequent grid:click from deselecting
        boxSelectHandled = true
        setTimeout(() => {
          boxSelectHandled = false
        }, 50)
      }
      // NOTE: Short clicks (no drag) fall through to the SelectionManager's
      // existing grid:click / node:click handlers — no extra logic needed here.

      // Hide visuals
      if (rectFillRef.current) rectFillRef.current.visible = false
      if (outlineRef.current) outlineRef.current.visible = false
      syncPreviewSelectedIds([])

      // Reset
      pointerDown.current = false
      isDragging.current = false
    }

    canvas.addEventListener('pointerdown', onCanvasPointerDown)
    canvas.addEventListener('pointerup', onCanvasPointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      canvas.removeEventListener('pointerup', onCanvasPointerUp)
    }
  }, [camera, gl])

  // grid:move for cursor tracking + rectangle update during drag
  useEffect(() => {
    const onMove = (event: GridEvent) => {
      const [snappedX, snappedZ] = getSnappedGridPosition(event.position[0], event.position[2])

      // Always update cursor position
      if (cursorRef.current) {
        cursorRef.current.position.set(snappedX, event.position[1], snappedZ)
      }

      if (!pointerDown.current) return

      currentPoint.current.set(snappedX, event.position[1], snappedZ)

      // Check drag threshold (screen pixels)
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
        syncPreviewSelectedIds(collectNodeIdsInBounds(bounds))
      }
    }

    emitter.on('grid:move', onMove)
    return () => {
      emitter.off('grid:move', onMove)
    }
  }, [])

  return (
    <group>
      {/* Cursor indicator */}
      <CursorSphere ref={cursorRef} tooltipContent={BOX_SELECT_TOOLTIP} />

      {/* Selection rectangle fill */}
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

      {/* Outline (LineLoop added as primitive — allocated once in ref) */}
      <primitive object={outlineRef.current} />
    </group>
  )
}
