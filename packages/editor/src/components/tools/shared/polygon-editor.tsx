import { emitter, type GridEvent, sceneRegistry } from '@pascal-app/core'
import { SCENE_LAYER } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Line,
  type Object3D,
  Shape,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  createMoveCrossHandleGeometry,
  ARROW_COLOR as EDGE_ARROW_COLOR,
  ARROW_HOVER_COLOR as EDGE_ARROW_HOVER_COLOR,
  ARROW_SCALE as EDGE_ARROW_SCALE,
  useArrowMaterial,
  useInvisibleHitAreaMaterial,
} from '../../editor/node-arrow-handles'
import { snapToHalf } from '../item/placement-math'

const Y_OFFSET = 0.02
// Per-side resize arrows: indigo chevrons that match the registry arrow
// handles (wall / column / fence). Each arrow sits just outside an edge
// midpoint, pointing along the edge's outward normal — dragging an arrow
// translates that edge only (its two vertices), leaving the opposite side
// fixed. Reuses the existing 'edge' drag mode in PolygonEditor.
const EDGE_ARROW_OFFSET = 0.34

// Disables R3F pointer-picking on a mesh. Used on the visual-only meshes —
// the edge bar and the border line — so they render without stealing pointer
// events that belong to the vertex/midpoint handles overlapping them. Mirrors
// the `NO_RAYCAST` sentinel in node-arrow-handles.tsx.
const NO_RAYCAST = () => null

function createEdgeArrowGeometry() {
  const shape = new Shape()
  shape.moveTo(0.22, 0)
  shape.lineTo(-0.04, 0.12)
  shape.lineTo(-0.04, 0.035)
  shape.lineTo(-0.2, 0.035)
  shape.lineTo(-0.2, -0.035)
  shape.lineTo(-0.04, -0.035)
  shape.lineTo(-0.04, -0.12)
  shape.lineTo(0.22, 0)
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.02,
    bevelOffset: 0,
    bevelSegments: 8,
    curveSegments: 16,
    steps: 1,
  })
  geometry.translate(0, 0, -0.0225)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

type DragState = {
  isDragging: boolean
  mode: 'vertex' | 'polygon' | 'edge'
  vertexIndex: number | null
  edgeIndex?: number
  edgeNormal?: [number, number]
  initialPosition: [number, number]
  initialPolygon: Array<[number, number]>
  pointerId: number
}

export interface PolygonEditorProps {
  polygon: Array<[number, number]>
  color?: string
  onPolygonChange: (polygon: Array<[number, number]>) => void
  /**
   * Fires on every drag tick with the in-flight polygon, then once with
   * `null` when the drag commits or is otherwise cleared. Hosts wire
   * this to `useLiveNodeOverrides` so the underlying mesh rebuilds at
   * pointer rate while `onPolygonChange` stays a single store commit
   * on release.
   */
  onPolygonPreview?: (polygon: ReadonlyArray<readonly [number, number]> | null) => void
  minVertices?: number
  /** Level ID to mount the editor to. If provided, uses createPortal for automatic level animation following. */
  levelId?: string
  /** Height of the surface being edited (e.g. slab elevation). Handles adapt to this. */
  surfaceHeight?: number
  /** Whether to show the center handle that moves the entire polygon. */
  allowPolygonMove?: boolean
  /** Whether polygon edges can be dragged along their perpendicular normal. */
  allowEdgeMove?: boolean
}

/**
 * Generic polygon editor component for editing polygon vertices
 * Used by zone and site boundary editors
 */
const MIN_HANDLE_HEIGHT = 0.15
const EDGE_HANDLE_HEIGHT = 0.06
const EDGE_HANDLE_THICKNESS = 0.12

function getEdgeNormal(start: [number, number], end: [number, number]): [number, number] | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null

  return [-dz / length, dx / length]
}

type HandleClickHandler = (event: ThreeEvent<MouseEvent>) => void
type HandlePointerHandler = (event: ThreeEvent<PointerEvent>) => void

type HandleHandlers = {
  onClick?: HandleClickHandler
  onDoubleClick?: HandleClickHandler
  onPointerDown?: HandlePointerHandler
  onPointerEnter?: HandlePointerHandler
  onPointerLeave?: HandlePointerHandler
}

function usePolygonNodeMaterial(color: string, opacity = 1): MeshBasicNodeMaterial {
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(color),
        depthTest: false,
        depthWrite: true,
        opacity,
        transparent: true,
      }),
    [],
  )

  useEffect(() => {
    material.color.set(color)
    material.opacity = opacity
  }, [color, material, opacity])
  useEffect(() => () => material.dispose(), [material])

  return material
}

// One mesh per handle: lives on SCENE_LAYER with a node material so the
// post-processing ink-edge pass outlines it, and carries the pointer handlers
// directly so it stays grabbable — matching the registry arrow gizmos in
// node-arrow-handles.tsx. No paired hit mesh is needed; the R3F event
// raycaster picks SCENE_LAYER meshes too.
function OutlinedCylinderHandle({
  radius,
  height,
  color,
  opacity = 1,
  position,
  ...handlers
}: {
  radius: number
  height: number
  color: string
  opacity?: number
  position: [number, number, number]
} & HandleHandlers) {
  const geometry = useMemo(() => new CylinderGeometry(radius, radius, height, 16), [height, radius])
  const material = usePolygonNodeMaterial(color, opacity)
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={SCENE_LAYER}
      material={material}
      position={position}
      renderOrder={1010}
      {...handlers}
    />
  )
}

// Whole-polygon move grip — the generic 4-way cross-arrow (matching the node
// move handles) with an invisible cylinder hit area, replacing the old sphere.
// The cross sits on SCENE_LAYER (so the ink pass outlines it) while the
// cylinder hit mesh is on EDITOR_LAYER (grabbable, out of the MRT scene pass).
function OutlinedCrossHandle({
  color,
  position,
  ...handlers
}: {
  color: string
  position: [number, number, number]
} & HandleHandlers) {
  const geometry = useMemo(() => createMoveCrossHandleGeometry(), [])
  const material = usePolygonNodeMaterial(color)
  const hitGeometry = useMemo(() => new CylinderGeometry(0.24, 0.24, 0.18, 24), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])

  return (
    <group position={position}>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        layers={SCENE_LAYER}
        material={material}
        raycast={NO_RAYCAST}
        renderOrder={1010}
        scale={EDGE_ARROW_SCALE}
      />
      <mesh
        frustumCulled={false}
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        renderOrder={1011}
        {...handlers}
      />
    </group>
  )
}

function OutlinedEdgeArrowHandle({
  geometry,
  color,
  position,
  rotationY,
  scale,
  ...handlers
}: {
  geometry: BufferGeometry
  color: string
  position: [number, number, number]
  rotationY: number
  scale: number
} & HandleHandlers) {
  const material = useArrowMaterial()
  useEffect(() => {
    material.color.set(color)
  }, [color, material])
  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={SCENE_LAYER}
      material={material}
      position={position}
      renderOrder={1010}
      rotation={[0, rotationY, 0]}
      scale={scale}
      {...handlers}
    />
  )
}

export const PolygonEditor: React.FC<PolygonEditorProps> = ({
  polygon,
  color = '#3b82f6',
  onPolygonChange,
  onPolygonPreview,
  minVertices = 3,
  levelId,
  surfaceHeight = 0,
  allowPolygonMove = false,
  allowEdgeMove = false,
}) => {
  const [levelNode, setLevelNode] = useState<Object3D | null>(() =>
    levelId ? (sceneRegistry.nodes.get(levelId) ?? null) : null,
  )

  useEffect(() => {
    if (!levelId) {
      setLevelNode(null)
      return
    }

    let frameId = 0

    const resolveLevelNode = () => {
      const nextLevelNode = sceneRegistry.nodes.get(levelId) ?? null
      setLevelNode((currentLevelNode) => {
        if (currentLevelNode === nextLevelNode) {
          return currentLevelNode
        }
        return nextLevelNode
      })

      if (!nextLevelNode) {
        frameId = window.requestAnimationFrame(resolveLevelNode)
      }
    }

    resolveLevelNode()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [levelId])

  // When using portal, edit at Y_OFFSET (local to level)
  // When not using portal, edit at world origin
  const editY = levelNode ? Y_OFFSET : 0

  // Local state for dragging
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]> | null>(null)
  const previewPolygonRef = useRef<Array<[number, number]> | null>(null)

  const onPolygonPreviewRef = useRef(onPolygonPreview)
  useEffect(() => {
    onPolygonPreviewRef.current = onPolygonPreview
  }, [onPolygonPreview])

  const updatePreviewPolygon = useCallback((nextPolygon: Array<[number, number]> | null) => {
    previewPolygonRef.current = nextPolygon
    setPreviewPolygon(nextPolygon)
    // Notify the host so it can mirror the in-flight polygon onto
    // `useLiveNodeOverrides` (drag rebuilds the mesh at pointer rate)
    // and clear that override when we hand `null` back at commit /
    // cancel / external-undo time.
    onPolygonPreviewRef.current?.(nextPolygon)
  }, [])

  // Keep ref in sync
  useEffect(() => {
    previewPolygonRef.current = previewPolygon
  }, [previewPolygon])

  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])

  const lineRef = useRef<Line>(null!)
  const previousPositionRef = useRef<[number, number] | null>(null)

  // Track the last polygon prop to detect external changes (undo/redo) or
  // our own post-commit prop update arriving while a preview is still in
  // flight. Either way, drop the stale preview/drag.
  //
  // This block runs during render, so it may only touch THIS component's
  // own state (setPreviewPolygon / setDragState — React re-renders in
  // place, which is the sanctioned "adjust state on prop change" pattern).
  // The host `onPolygonPreview(null)` notification clears
  // `useLiveNodeOverrides` — a store OTHER components subscribe to (e.g.
  // NodeArrowHandles) — so calling it here throws "Cannot update a
  // component while rendering a different component". Defer it to the
  // effect below.
  const lastPolygonRef = useRef(polygon)
  const pendingPreviewClearRef = useRef(false)
  if (polygon !== lastPolygonRef.current) {
    lastPolygonRef.current = polygon
    // `previewPolygonRef` is the synchronously-updated source of truth for
    // an in-flight preview (state can lag it by a render).
    if (previewPolygonRef.current !== null || previewPolygon !== null) {
      previewPolygonRef.current = null
      setPreviewPolygon(null)
      pendingPreviewClearRef.current = true
    }
    if (dragState) setDragState(null)
  }

  // Flush the deferred host preview-clear (see note above) after the
  // commit, where writing to other stores is allowed.
  useEffect(() => {
    if (pendingPreviewClearRef.current) {
      pendingPreviewClearRef.current = false
      onPolygonPreviewRef.current?.(null)
    }
  })

  // The polygon to display (preview during drag, or actual polygon)
  const displayPolygon = previewPolygon ?? polygon

  const polygonCenter = useMemo(() => {
    if (displayPolygon.length === 0) return [0, 0] as [number, number]
    let sumX = 0
    let sumZ = 0
    for (const [x, z] of displayPolygon) {
      sumX += x
      sumZ += z
    }
    return [sumX / displayPolygon.length, sumZ / displayPolygon.length] as [number, number]
  }, [displayPolygon])

  // Calculate midpoints for adding new vertices
  const midpoints = useMemo(() => {
    if (displayPolygon.length < 2) return []
    return displayPolygon.map(([x1, z1], index) => {
      const nextIndex = (index + 1) % displayPolygon.length
      const [x2, z2] = displayPolygon[nextIndex]!
      return [(x1! + x2) / 2, (z1! + z2) / 2] as [number, number]
    })
  }, [displayPolygon])

  const edgeHandles = useMemo(() => {
    if (displayPolygon.length < 2) return []

    let cx = 0
    let cz = 0
    for (const [x, z] of displayPolygon) {
      cx += x
      cz += z
    }
    cx /= displayPolygon.length
    cz /= displayPolygon.length

    return displayPolygon.flatMap(([x1, z1], index) => {
      const nextIndex = (index + 1) % displayPolygon.length
      const [x2, z2] = displayPolygon[nextIndex]!
      const dx = x2 - x1
      const dz = z2 - z1
      const length = Math.hypot(dx, dz)
      if (length < 1e-6) return []

      const midpoint: [number, number] = [(x1 + x2) / 2, (z1 + z2) / 2]
      // Outward normal: edge perpendicular flipped to point away from the
      // polygon centroid. Independent of winding order so arrows always
      // face outward even on hand-traced (mixed-winding) polygons.
      let nx = -dz / length
      let nz = dx / length
      if (nx * (midpoint[0] - cx) + nz * (midpoint[1] - cz) < 0) {
        nx = -nx
        nz = -nz
      }

      return [
        {
          index,
          length,
          midpoint,
          rotationY: -Math.atan2(dz, dx),
          outwardNormal: [nx, nz] as [number, number],
          outwardAngle: -Math.atan2(nz, nx),
        },
      ]
    })
  }, [displayPolygon])

  const arrowGeometry = useMemo(() => createEdgeArrowGeometry(), [])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])

  // Update vertex position using grid cursor position
  const handleVertexDrag = useCallback(
    (vertexIndex: number, position: [number, number]) => {
      const basePolygon = previewPolygonRef.current ?? polygon
      const newPolygon = [...basePolygon]
      newPolygon[vertexIndex] = position
      updatePreviewPolygon(newPolygon)
    },
    [polygon, updatePreviewPolygon],
  )

  // Commit polygon changes
  const commitPolygonChange = useCallback(() => {
    if (previewPolygonRef.current) {
      onPolygonChange(previewPolygonRef.current)
    }
    updatePreviewPolygon(null)
    setDragState(null)
  }, [onPolygonChange, updatePreviewPolygon])

  // Handle adding a new vertex at midpoint
  const handleAddVertex = useCallback(
    (afterIndex: number, position: [number, number]) => {
      const basePolygon = previewPolygon ?? polygon
      const newPolygon = [
        ...basePolygon.slice(0, afterIndex + 1),
        position,
        ...basePolygon.slice(afterIndex + 1),
      ]

      updatePreviewPolygon(newPolygon)
      return {
        polygon: newPolygon,
        vertexIndex: afterIndex + 1,
      }
    },
    [polygon, previewPolygon, updatePreviewPolygon],
  )

  // Handle deleting a vertex
  const handleDeleteVertex = useCallback(
    (index: number) => {
      const basePolygon = previewPolygon ?? polygon
      if (basePolygon.length <= minVertices) return // Need at least minVertices points

      const newPolygon = basePolygon.filter((_, i) => i !== index)
      onPolygonChange(newPolygon)
      updatePreviewPolygon(null)
    },
    [polygon, previewPolygon, onPolygonChange, minVertices, updatePreviewPolygon],
  )

  // Listen to grid:move events to track cursor position
  useEffect(() => {
    const onGridMove = (event: GridEvent) => {
      const gridX = snapToHalf(event.localPosition[0])
      const gridZ = snapToHalf(event.localPosition[2])
      const newPosition: [number, number] = [gridX, gridZ]

      // Play snap sound when cursor moves to a new grid cell during drag
      if (
        dragState?.isDragging &&
        previousPositionRef.current &&
        (newPosition[0] !== previousPositionRef.current[0] ||
          newPosition[1] !== previousPositionRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousPositionRef.current = newPosition
      setCursorPosition(newPosition)

      // Update vertex position during drag
      if (dragState?.isDragging) {
        if (dragState.mode === 'vertex' && dragState.vertexIndex !== null) {
          handleVertexDrag(dragState.vertexIndex, newPosition)
        } else if (dragState.mode === 'polygon') {
          const deltaX = newPosition[0] - dragState.initialPosition[0]
          const deltaZ = newPosition[1] - dragState.initialPosition[1]
          updatePreviewPolygon(
            dragState.initialPolygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number]),
          )
        } else if (
          dragState.mode === 'edge' &&
          dragState.edgeIndex !== undefined &&
          dragState.edgeNormal
        ) {
          const [normalX, normalZ] = dragState.edgeNormal
          const pointerDeltaX = newPosition[0] - dragState.initialPosition[0]
          const pointerDeltaZ = newPosition[1] - dragState.initialPosition[1]
          const normalDistance = pointerDeltaX * normalX + pointerDeltaZ * normalZ
          const edgeStartIndex = dragState.edgeIndex
          const edgeEndIndex = (edgeStartIndex + 1) % dragState.initialPolygon.length
          const nextPolygon = dragState.initialPolygon.map((point, index) => {
            if (index !== edgeStartIndex && index !== edgeEndIndex) {
              return point
            }

            return [point[0] + normalX * normalDistance, point[1] + normalZ * normalDistance] as [
              number,
              number,
            ]
          })
          updatePreviewPolygon(nextPolygon)
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    return () => {
      emitter.off('grid:move', onGridMove)
    }
  }, [dragState, handleVertexDrag, updatePreviewPolygon])

  // Set up pointer up listener for ending drag
  useEffect(() => {
    if (!dragState?.isDragging) return

    const handlePointerUp = (e: PointerEvent | MouseEvent) => {
      // Only handle the specific pointer that started the drag, if it's a PointerEvent
      if (
        'pointerId' in e &&
        dragState.pointerId !== undefined &&
        e.pointerId !== dragState.pointerId
      )
        return

      // Stop the event from propagating to prevent grid click
      e.stopImmediatePropagation()
      e.preventDefault()

      // Suppress the follow-up click event that browsers fire after pointerup
      const suppressClick = (ce: MouseEvent) => {
        ce.stopImmediatePropagation()
        ce.preventDefault()
        window.removeEventListener('click', suppressClick, true)
      }
      window.addEventListener('click', suppressClick, true)

      // Safety cleanup in case no click fires
      requestAnimationFrame(() => {
        window.removeEventListener('click', suppressClick, true)
      })

      commitPolygonChange()
    }

    window.addEventListener('pointerup', handlePointerUp as EventListener, true)
    window.addEventListener('pointercancel', handlePointerUp as EventListener, true)
    return () => {
      window.removeEventListener('pointerup', handlePointerUp as EventListener, true)
      window.removeEventListener('pointercancel', handlePointerUp as EventListener, true)
    }
  }, [dragState, commitPolygonChange])

  // Update line geometry when polygon changes
  useEffect(() => {
    if (!lineRef.current || displayPolygon.length < 2) return

    const positions: number[] = []
    for (const [x, z] of displayPolygon) {
      positions.push(x!, editY + 0.01, z!)
    }
    // Close the loop
    const first = displayPolygon[0]!
    positions.push(first[0]!, editY + 0.01, first[1]!)

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

    lineRef.current.geometry.dispose()
    lineRef.current.geometry = geometry
  }, [displayPolygon, editY])

  if (displayPolygon.length < minVertices) return null

  const canDelete = displayPolygon.length > minVertices
  const handleHeight = Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02)
  const edgeHandleY = editY + handleHeight - EDGE_HANDLE_HEIGHT / 2

  // Interactive handles are single SCENE_LAYER node-material meshes (like the
  // registry arrow gizmos) so the ink-edge pass outlines them while they stay
  // grabbable. The edge BAR and border line stay on EDITOR_LAYER, visual-only
  // (raycast disabled) so they never steal clicks from the vertex/midpoint
  // handles overlapping them — edge dragging starts from the chevron arrow
  // outside the polygon edge.
  const editorContent = (
    <group>
      {/* Border line */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        // @ts-expect-error R3F <line> element conflicts with SVG <line> type
        ref={lineRef}
        renderOrder={10}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.8}
          transparent
        />
      </line>

      {/* Vertex handles - blue cylinders that match surface height */}
      {displayPolygon.map(([x, z], index) => {
        const isHovered = hoveredVertex === index
        const isDragging = dragState?.mode === 'vertex' && dragState.vertexIndex === index
        const radius = 0.1
        const height = handleHeight

        return (
          <OutlinedCylinderHandle
            color={isDragging || isHovered ? EDGE_ARROW_HOVER_COLOR : EDGE_ARROW_COLOR}
            height={height}
            key={`vertex-${index}`}
            onClick={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
            }}
            onDoubleClick={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              if (canDelete) {
                handleDeleteVertex(index)
              }
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              setHoveredEdge(null)
              setDragState({
                isDragging: true,
                mode: 'vertex',
                vertexIndex: index,
                initialPosition: [x!, z!],
                initialPolygon: displayPolygon.map(([px, pz]) => [px, pz] as [number, number]),
                pointerId: e.pointerId,
              })
            }}
            onPointerEnter={(e) => {
              e.stopPropagation()
              setHoveredVertex(index)
            }}
            onPointerLeave={(e) => {
              e.stopPropagation()
              setHoveredVertex(null)
            }}
            position={[x!, editY + height / 2, z!]}
            radius={radius}
          />
        )
      })}

      {allowPolygonMove && (
        <OutlinedCrossHandle
          color={dragState?.mode === 'polygon' ? EDGE_ARROW_HOVER_COLOR : EDGE_ARROW_COLOR}
          onClick={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            setHoveredEdge(null)
            setDragState({
              isDragging: true,
              mode: 'polygon',
              vertexIndex: null,
              initialPosition: polygonCenter,
              initialPolygon: displayPolygon.map(([px, pz]) => [px, pz] as [number, number]),
              pointerId: e.pointerId,
            })
          }}
          position={[polygonCenter[0], editY + handleHeight + 0.08, polygonCenter[1]]}
        />
      )}

      {allowEdgeMove &&
        edgeHandles.map(({ index, length, midpoint, rotationY, outwardNormal, outwardAngle }) => {
          const isHovered = hoveredEdge === index
          const isDragging = dragState?.mode === 'edge' && dragState.edgeIndex === index
          const arrowX = midpoint[0] + outwardNormal[0] * EDGE_ARROW_OFFSET
          const arrowZ = midpoint[1] + outwardNormal[1] * EDGE_ARROW_OFFSET

          const beginEdgeDrag = (e: { button: number; pointerId: number }) => {
            const start = displayPolygon[index]
            const end = displayPolygon[(index + 1) % displayPolygon.length]
            if (!(start && end)) return

            const edgeNormal = getEdgeNormal(start, end)
            if (!edgeNormal) return

            setHoveredEdge(null)
            setDragState({
              isDragging: true,
              mode: 'edge',
              vertexIndex: null,
              edgeIndex: index,
              edgeNormal,
              initialPosition: cursorPosition,
              initialPolygon: displayPolygon.map(([px, pz]) => [px, pz] as [number, number]),
              pointerId: e.pointerId,
            })
          }

          return (
            <group key={`edge-${index}`}>
              {/* Edge bar — VISUAL ONLY (raycast disabled). It runs the full
                  length of the edge and overlaps the vertex/midpoint handles at
                  its ends + centre, so making it pickable let edges steal those
                  clicks. Edge dragging runs through the chevron arrow below,
                  which sits outside the polygon and never overlaps a
                  vertex/midpoint handle. */}
              <mesh
                layers={EDITOR_LAYER}
                position={[midpoint[0], edgeHandleY, midpoint[1]]}
                raycast={NO_RAYCAST}
                rotation={[0, rotationY, 0]}
              >
                <boxGeometry args={[length, EDGE_HANDLE_HEIGHT, EDGE_HANDLE_THICKNESS]} />
                <meshBasicMaterial
                  color={isDragging ? EDGE_ARROW_HOVER_COLOR : EDGE_ARROW_COLOR}
                  opacity={isDragging ? 0.5 : isHovered ? 0.38 : 0.14}
                  transparent
                />
              </mesh>
              {/* Per-side resize arrow — the interactive edge-drag handle.
                  Points outward from the edge; dragging it translates only this
                  edge's two vertices along the outward normal. */}
              <OutlinedEdgeArrowHandle
                color={isDragging || isHovered ? EDGE_ARROW_HOVER_COLOR : EDGE_ARROW_COLOR}
                geometry={arrowGeometry}
                onClick={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  beginEdgeDrag(e)
                }}
                onPointerEnter={(e) => {
                  e.stopPropagation()
                  setHoveredEdge(index)
                }}
                onPointerLeave={(e) => {
                  e.stopPropagation()
                  setHoveredEdge(null)
                }}
                position={[arrowX, edgeHandleY, arrowZ]}
                rotationY={outwardAngle}
                scale={EDGE_ARROW_SCALE}
              />
            </group>
          )
        })}

      {/* Midpoint handles - smaller green cylinders for adding vertices (hidden while dragging) */}
      {!dragState &&
        midpoints.map(([x, z], index) => {
          const isHovered = hoveredMidpoint === index
          const radius = 0.06
          const height = handleHeight

          return (
            <OutlinedCylinderHandle
              color={isHovered ? EDGE_ARROW_HOVER_COLOR : EDGE_ARROW_COLOR}
              height={height}
              key={`midpoint-${index}`}
              onClick={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const insertedVertex = handleAddVertex(index, [x!, z!])
                if (insertedVertex.vertexIndex >= 0) {
                  setDragState({
                    isDragging: true,
                    mode: 'vertex',
                    vertexIndex: insertedVertex.vertexIndex,
                    initialPosition: [x!, z!],
                    initialPolygon: insertedVertex.polygon,
                    pointerId: e.pointerId,
                  })
                  setHoveredMidpoint(null)
                }
              }}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(index)
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(null)
              }}
              opacity={isHovered ? 1 : 0.7}
              position={[x!, editY + height / 2, z!]}
              radius={radius}
            />
          )
        })}
    </group>
  )

  // Mount to level node if available, otherwise render at world origin
  return levelNode ? createPortal(editorContent, levelNode) : editorContent
}
