import { emitter, type GridEvent, sceneRegistry } from '@pascal-app/core'
import { createPortal } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Line, type Object3D } from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { snapToHalf } from '../item/placement-math'

const Y_OFFSET = 0.02

type DragState = {
  isDragging: boolean
  mode: 'vertex' | 'polygon'
  vertexIndex: number | null
  initialPosition: [number, number]
  initialPolygon: Array<[number, number]>
  pointerId: number
}

export interface PolygonEditorProps {
  polygon: Array<[number, number]>
  color?: string
  onPolygonChange: (polygon: Array<[number, number]>) => void
  minVertices?: number
  /** Level ID to mount the editor to. If provided, uses createPortal for automatic level animation following. */
  levelId?: string
  /** Height of the surface being edited (e.g. slab elevation). Handles adapt to this. */
  surfaceHeight?: number
  /** Whether to show the center handle that moves the entire polygon. */
  allowPolygonMove?: boolean
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
  levelId,
  surfaceHeight = 0,
  allowPolygonMove = false,
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

  // Keep ref in sync
  useEffect(() => {
    previewPolygonRef.current = previewPolygon
  }, [previewPolygon])

  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])

  const lineRef = useRef<Line>(null!)
  const previousPositionRef = useRef<[number, number] | null>(null)

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

  // Update vertex position using grid cursor position
  const handleVertexDrag = useCallback(
    (vertexIndex: number, position: [number, number]) => {
      setPreviewPolygon((prev) => {
        const basePolygon = prev ?? polygon
        const newPolygon = [...basePolygon]
        newPolygon[vertexIndex] = position
        return newPolygon
      })
    },
    [polygon],
  )

  // Commit polygon changes
  const commitPolygonChange = useCallback(() => {
    if (previewPolygonRef.current) {
      onPolygonChange(previewPolygonRef.current)
    }
    setPreviewPolygon(null)
    setDragState(null)
  }, [onPolygonChange])

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
          setPreviewPolygon(
            dragState.initialPolygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number]),
          )
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    return () => {
      emitter.off('grid:move', onGridMove)
    }
  }, [dragState, handleVertexDrag])

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

  const editorContent = (
    <group>
      {/* Border line */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        raycast={() => {}}
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
        const height = Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02)

        return (
          <mesh
            castShadow
            key={`vertex-${index}`}
            layers={EDITOR_LAYER}
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
          >
            <cylinderGeometry args={[radius, radius, height, 16]} />
            <meshStandardMaterial
              color={isDragging ? '#22c55e' : isHovered ? '#60a5fa' : '#3b82f6'}
            />
          </mesh>
        )
      })}

      {allowPolygonMove && (
        <mesh
          castShadow
          layers={EDITOR_LAYER}
          onClick={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            setDragState({
              isDragging: true,
              mode: 'polygon',
              vertexIndex: null,
              initialPosition: polygonCenter,
              initialPolygon: displayPolygon.map(([px, pz]) => [px, pz] as [number, number]),
              pointerId: e.pointerId,
            })
          }}
          position={[
            polygonCenter[0],
            editY + Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02) + 0.08,
            polygonCenter[1],
          ]}
        >
          <sphereGeometry args={[0.09, 20, 20]} />
          <meshStandardMaterial color={dragState?.mode === 'polygon' ? '#22c55e' : '#f59e0b'} />
        </mesh>
      )}

      {/* Midpoint handles - smaller green cylinders for adding vertices (hidden while dragging) */}
      {!dragState &&
        midpoints.map(([x, z], index) => {
          const isHovered = hoveredMidpoint === index
          const radius = 0.06
          const height = Math.max(MIN_HANDLE_HEIGHT, surfaceHeight + 0.02)

          return (
            <mesh
              key={`midpoint-${index}`}
              layers={EDITOR_LAYER}
              onClick={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const newVertexIndex = handleAddVertex(index, [x!, z!])
                if (newVertexIndex >= 0) {
                  setDragState({
                    isDragging: true,
                    mode: 'vertex',
                    vertexIndex: newVertexIndex,
                    initialPosition: [x!, z!],
                    initialPolygon: previewPolygon ?? polygon,
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
              position={[x!, editY + height / 2, z!]}
            >
              <cylinderGeometry args={[radius, radius, height, 16]} />
              <meshStandardMaterial
                color={isHovered ? '#4ade80' : '#22c55e'}
                opacity={isHovered ? 1 : 0.7}
                transparent
              />
            </mesh>
          )
        })}
    </group>
  )

  // Mount to level node if available, otherwise render at world origin
  return levelNode ? createPortal(editorContent, levelNode) : editorContent
}
