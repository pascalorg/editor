import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'

const Y_OFFSET = 0.02

type DragState = {
  isDragging: boolean
  vertexIndex: number
  initialPosition: [number, number]
  pointerId: number
}

export interface PolygonEditorProps {
  polygon: Array<[number, number]>
  color?: string
  onPolygonChange: (polygon: Array<[number, number]>) => void
  minVertices?: number
  levelY?: number
  /** Height of the surface being edited (e.g. slab elevation). Handles adapt to this. */
  surfaceHeight?: number
}

/**
 * Generic polygon editor component for editing polygon vertices
 * Used by zone and site boundary editors
 */
const MIN_HANDLE_HEIGHT = 0.15

export const PolygonEditor: React.FC<PolygonEditorProps> = ({
  polygon,
  color = '#3b82f6',
  onPolygonChange,
  minVertices = 3,
  levelY = 0,
  surfaceHeight = 0,
}) => {
  const { gl, camera } = useThree()

  // Compute the editing plane height (level Y + small offset above floor)
  const editY = levelY + Y_OFFSET

  // Local state for dragging
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]> | null>(null)
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)

  // Refs for raycasting during drag
  const dragPlane = useRef(new Plane(new Vector3(0, 1, 0), -editY))
  dragPlane.current.constant = -editY
  const raycaster = useRef(new Raycaster())
  const lineRef = useRef<Mesh>(null!)

  // Track the last polygon prop to detect external changes (undo/redo)
  const lastPolygonRef = useRef(polygon)
  if (polygon !== lastPolygonRef.current) {
    lastPolygonRef.current = polygon
    // External change (e.g. undo/redo) — clear any stale preview/drag state
    if (previewPolygon) setPreviewPolygon(null)
    if (dragState) setDragState(null)
  }

  // The polygon to display (preview during drag, or actual polygon)
  const displayPolygon = previewPolygon ?? polygon

  // Calculate midpoints for adding new vertices
  const midpoints = useMemo(() => {
    if (displayPolygon.length < 2) return []
    return displayPolygon.map(([x1, z1], index) => {
      const nextIndex = (index + 1) % displayPolygon.length
      const [x2, z2] = displayPolygon[nextIndex]!
      return [(x1! + x2) / 2, (z1! + z2) / 2] as [number, number]
    })
  }, [displayPolygon])

  // Handle vertex drag
  const handleVertexDrag = useCallback(
    (clientX: number, clientY: number, vertexIndex: number) => {
      const canvas = gl.domElement
      const rect = canvas.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = -((clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(new Vector2(x, y), camera)
      const intersection = new Vector3()
      raycaster.current.ray.intersectPlane(dragPlane.current, intersection)

      if (intersection) {
        // Snap to 0.5 grid
        const gridX = Math.round(intersection.x * 2) / 2
        const gridZ = Math.round(intersection.z * 2) / 2

        const basePolygon = previewPolygon ?? polygon
        const newPolygon = [...basePolygon]
        newPolygon[vertexIndex] = [gridX, gridZ]
        setPreviewPolygon(newPolygon)
      }
    },
    [gl, camera, previewPolygon, polygon],
  )

  // Commit polygon changes
  const commitPolygonChange = useCallback(() => {
    if (previewPolygon) {
      onPolygonChange(previewPolygon)
    }
    setPreviewPolygon(null)
    setDragState(null)
  }, [previewPolygon, onPolygonChange])

  // Handle adding a new vertex at midpoint
  const handleAddVertex = useCallback(
    (afterIndex: number, position: [number, number]) => {
      const basePolygon = previewPolygon ?? polygon
      const newPolygon = [
        ...basePolygon.slice(0, afterIndex + 1),
        position,
        ...basePolygon.slice(afterIndex + 1),
      ]

      setPreviewPolygon(newPolygon)
      return afterIndex + 1 // Return new vertex index
    },
    [polygon, previewPolygon],
  )

  // Handle deleting a vertex
  const handleDeleteVertex = useCallback(
    (index: number) => {
      const basePolygon = previewPolygon ?? polygon
      if (basePolygon.length <= minVertices) return // Need at least minVertices points

      const newPolygon = basePolygon.filter((_, i) => i !== index)
      onPolygonChange(newPolygon)
      setPreviewPolygon(null)
    },
    [polygon, previewPolygon, onPolygonChange, minVertices],
  )

  // Set up pointer move/up listeners for dragging with pointer capture
  useEffect(() => {
    if (!dragState?.isDragging) return

    const canvas = gl.domElement
    const pointerId = dragState.pointerId

    // Capture pointer to prevent R3F events from firing on other objects (like the grid)
    canvas.setPointerCapture(pointerId)

    const handlePointerMove = (e: PointerEvent) => {
      handleVertexDrag(e.clientX, e.clientY, dragState.vertexIndex)
    }

    const handlePointerUp = (e: PointerEvent) => {
      // Stop the event from reaching R3F's handlers, which would otherwise
      // fire a grid:click and deselect the node being edited.
      e.stopImmediatePropagation()
      e.preventDefault()

      // Release pointer capture
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }

      // Suppress the follow-up click event that browsers fire after pointerup
      const suppressClick = (ce: MouseEvent) => {
        ce.stopImmediatePropagation()
        ce.preventDefault()
        canvas.removeEventListener('click', suppressClick, true)
      }
      canvas.addEventListener('click', suppressClick, true)
      // Safety cleanup in case no click fires
      requestAnimationFrame(() => {
        canvas.removeEventListener('click', suppressClick, true)
      })

      commitPolygonChange()
    }

    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp, true)

    return () => {
      // Release capture on cleanup
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp, true)
    }
  }, [dragState, gl, handleVertexDrag, commitPolygonChange])

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

  return (
    <group>
      {/* Border line */}
      {/* @ts-ignore */}
      <line ref={lineRef} frustumCulled={false} renderOrder={10}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color={color}
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.8}
        />
      </line>

      {/* Vertex handles - blue cylinders that match surface height */}
      {displayPolygon.map(([x, z], index) => {
        const isHovered = hoveredVertex === index
        const isDragging = dragState?.vertexIndex === index
        const radius = 0.1
        const height = Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02)

        return (
          <mesh
            key={`vertex-${index}`}
            position={[x!, editY + height / 2, z!]}
            castShadow
            onPointerEnter={(e) => {
              e.stopPropagation()
              setHoveredVertex(index)
            }}
            onPointerLeave={(e) => {
              e.stopPropagation()
              setHoveredVertex(null)
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              setDragState({
                isDragging: true,
                vertexIndex: index,
                initialPosition: [x!, z!],
                pointerId: e.nativeEvent.pointerId,
              })
            }}
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
          >
            <cylinderGeometry args={[radius, radius, height, 16]} />
            <meshStandardMaterial
              color={isDragging ? '#22c55e' : isHovered ? '#60a5fa' : '#3b82f6'}
            />
          </mesh>
        )
      })}

      {/* Midpoint handles - smaller green cylinders for adding vertices (hidden while dragging) */}
      {!dragState &&
        midpoints.map(([x, z], index) => {
          const isHovered = hoveredMidpoint === index
          const radius = 0.06
          const height = Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02)

          return (
            <mesh
              key={`midpoint-${index}`}
              position={[x!, editY + height / 2, z!]}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(index)
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(null)
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const newVertexIndex = handleAddVertex(index, [x!, z!])
                if (newVertexIndex >= 0) {
                  setDragState({
                    isDragging: true,
                    vertexIndex: newVertexIndex,
                    initialPosition: [x!, z!],
                    pointerId: e.nativeEvent.pointerId,
                  })
                  setHoveredMidpoint(null)
                }
              }}
              onClick={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
              }}
            >
              <cylinderGeometry args={[radius, radius, height, 16]} />
              <meshStandardMaterial
                color={isHovered ? '#4ade80' : '#22c55e'}
                transparent
                opacity={isHovered ? 1 : 0.7}
              />
            </mesh>
          )
        })}
    </group>
  )
}
