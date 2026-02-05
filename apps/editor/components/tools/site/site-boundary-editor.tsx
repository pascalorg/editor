import { type SiteNode, useScene } from '@pascal-app/core'
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

/** Find the site node ID from rootNodeIds (runs once, stable result) */
function useSiteNodeId() {
  return useScene((state) => {
    for (const id of state.rootNodeIds) {
      if (state.nodes[id]?.type === 'site') return id
    }
    return null
  })
}

/**
 * Site boundary editor - allows editing site polygon vertices when in site/edit mode
 */
export const SiteBoundaryEditor: React.FC = () => {
  const { gl, camera, invalidate } = useThree()
  const siteId = useSiteNodeId()
  // Direct selector for the site node (same pattern as ZoneBoundaryEditor)
  const siteNode = useScene((state) =>
    siteId ? (state.nodes[siteId] as SiteNode | undefined) ?? null : null,
  )
  const updateNode = useScene((state) => state.updateNode)

  const polygon = siteNode?.polygon?.points ?? []

  // Local state for dragging
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]> | null>(null)
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)

  // Refs for raycasting during drag
  const dragPlane = useRef(new Plane(new Vector3(0, 1, 0), -Y_OFFSET))
  const raycaster = useRef(new Raycaster())
  const lineRef = useRef<Mesh>(null!)

  // The polygon to display (preview during drag, or actual site polygon)
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
      if (!siteNode) return

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
    [siteNode, gl, camera, previewPolygon, polygon],
  )

  // Commit polygon changes
  const commitPolygonChange = useCallback(() => {
    if (previewPolygon && siteId) {
      updateNode(siteId, {
        polygon: { type: 'polygon' as const, points: previewPolygon },
      })
    }
    setPreviewPolygon(null)
    setDragState(null)
  }, [previewPolygon, siteId, updateNode])

  // Handle adding a new vertex at midpoint
  const handleAddVertex = useCallback(
    (afterIndex: number, position: [number, number]) => {
      if (!siteNode) return -1

      const basePolygon = previewPolygon ?? polygon
      const newPolygon = [
        ...basePolygon.slice(0, afterIndex + 1),
        position,
        ...basePolygon.slice(afterIndex + 1),
      ]

      setPreviewPolygon(newPolygon)
      return afterIndex + 1
    },
    [siteNode, previewPolygon, polygon],
  )

  // Handle deleting a vertex
  const handleDeleteVertex = useCallback(
    (index: number) => {
      if (!siteNode || !siteId) return

      const basePolygon = previewPolygon ?? polygon
      if (basePolygon.length <= 3) return

      const newPolygon = basePolygon.filter((_, i) => i !== index)
      updateNode(siteId, {
        polygon: { type: 'polygon' as const, points: newPolygon },
      })
      setPreviewPolygon(null)
    },
    [siteNode, siteId, previewPolygon, polygon, updateNode],
  )

  // Set up pointer move/up listeners for dragging with pointer capture
  useEffect(() => {
    if (!dragState?.isDragging) return

    const canvas = gl.domElement
    const pointerId = dragState.pointerId

    canvas.setPointerCapture(pointerId)

    const handlePointerMove = (e: PointerEvent) => {
      handleVertexDrag(e.clientX, e.clientY, dragState.vertexIndex)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
      commitPolygonChange()
    }

    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)

    return () => {
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragState, gl, handleVertexDrag, commitPolygonChange])

  // Update line geometry when polygon changes
  useEffect(() => {
    if (!lineRef.current || displayPolygon.length < 2) return

    const positions: number[] = []
    for (const [x, z] of displayPolygon) {
      positions.push(x!, Y_OFFSET + 0.01, z!)
    }
    // Close the loop
    const first = displayPolygon[0]!
    positions.push(first[0]!, Y_OFFSET + 0.01, first[1]!)

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

    lineRef.current.geometry.dispose()
    lineRef.current.geometry = geometry

    // Force R3F to re-render the frame
    invalidate()
  }, [displayPolygon, invalidate])

  if (!siteNode || displayPolygon.length < 3) return null

  const canDelete = displayPolygon.length > 3

  return (
    <group>
      {/* Border line */}
      {/* @ts-ignore */}
      <line ref={lineRef} frustumCulled={false} renderOrder={10}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color={'#10b981'}
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.8}
        />
      </line>

      {/* Vertex handles */}
      {displayPolygon.map(([x, z], index) => {
        const isHovered = hoveredVertex === index
        const isDragging = dragState?.vertexIndex === index

        return (
          <mesh
            key={`vertex-${index}`}
            position={[x!, Y_OFFSET, z!]}
            onPointerEnter={(e) => {
              e.stopPropagation()
              setHoveredVertex(index)
            }}
            onPointerLeave={(e) => {
              e.stopPropagation()
              setHoveredVertex(null)
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setDragState({
                isDragging: true,
                vertexIndex: index,
                initialPosition: [x!, z!],
                pointerId: e.nativeEvent.pointerId,
              })
            }}
            onClick={(e) => {
              e.stopPropagation()
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (canDelete) {
                handleDeleteVertex(index)
              }
            }}
          >
            <sphereGeometry args={[isHovered || isDragging ? 0.3 : 0.2, 16, 16]} />
            <meshBasicMaterial
              color={
                isDragging ? '#fbbf24' : isHovered ? (canDelete ? '#ef4444' : '#ffffff') : '#10b981'
              }
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )
      })}

      {/* Midpoint handles for adding vertices (hidden while dragging) */}
      {!dragState &&
        midpoints.map(([x, z], index) => {
          const isHovered = hoveredMidpoint === index

          return (
            <mesh
              key={`midpoint-${index}`}
              position={[x!, Y_OFFSET, z!]}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(index)
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(null)
              }}
              onPointerDown={(e) => {
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
                e.stopPropagation()
              }}
            >
              <sphereGeometry args={[isHovered ? 0.15 : 0.1, 16, 16]} />
              <meshBasicMaterial
                color={isHovered ? '#10b981' : '#ffffff'}
                depthTest={false}
                depthWrite={false}
                transparent
                opacity={isHovered ? 1 : 0.4}
              />
            </mesh>
          )
        })}
    </group>
  )
}
