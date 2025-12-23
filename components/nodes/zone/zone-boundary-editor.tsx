'use client'

import { Line } from '@react-three/drei'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { FLOOR_SPACING, GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { type StoreState, useEditor } from '@/hooks/use-editor'

// Height offset to prevent z-fighting and ensure spheres are fully above the floor
// Needs to be at least the sphere radius (0.2 when hovered) to avoid clipping
const Y_OFFSET = 0.25

// Convert grid coordinates to world coordinates
const toWorld = (x: number, z: number): [number, number] => [x * TILE_SIZE, z * TILE_SIZE]

// Convert world coordinates to grid coordinates
const toGrid = (x: number, z: number): [number, number] => [
  Math.round(x / TILE_SIZE),
  Math.round(z / TILE_SIZE),
]

/**
 * Draggable handle for editing zone polygon vertices
 */
function DragHandle({
  position,
  index,
  onDragStart,
  onDrag,
  onDragEnd,
  onDelete,
  levelYOffset,
  color,
  canDelete,
}: {
  position: [number, number]
  index: number
  onDragStart: () => void
  onDrag: (index: number, newPosition: [number, number]) => void
  onDragEnd: () => void
  onDelete: (index: number) => void
  levelYOffset: number
  color: string
  canDelete: boolean
}) {
  const { gl, camera } = useThree()
  const meshRef = useRef<THREE.Mesh>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const raycaster = useRef(new THREE.Raycaster())

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (canDelete) {
        onDelete(index)
      }
    },
    [canDelete, index, onDelete],
  )

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setIsDragging(true)
      onDragStart()

      // Update drag plane to be at the current Y level
      dragPlane.current.set(new THREE.Vector3(0, 1, 0), -(levelYOffset + Y_OFFSET))

      // Capture pointer
      ;(e.target as any)?.setPointerCapture?.(e.nativeEvent.pointerId)

      const canvas = gl.domElement

      const handlePointerMove = (moveEvent: PointerEvent) => {
        // Convert pointer position to normalized device coordinates
        const rect = canvas.getBoundingClientRect()
        const x = ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1
        const y = -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1

        // Raycast to the drag plane
        raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)
        const intersection = new THREE.Vector3()
        raycaster.current.ray.intersectPlane(dragPlane.current, intersection)

        if (intersection) {
          // The intersection is in world coords (with grid offset applied)
          // Need to account for the parent group offset (-GRID_SIZE/2)
          const localX = intersection.x + GRID_SIZE / 2
          const localZ = intersection.z + GRID_SIZE / 2

          // Convert to grid coordinates (snap to grid)
          const [gridX, gridZ] = toGrid(localX, localZ)
          onDrag(index, [gridX, gridZ])
        }
      }

      const handlePointerUp = () => {
        setIsDragging(false)
        onDragEnd()
        canvas.removeEventListener('pointermove', handlePointerMove)
        canvas.removeEventListener('pointerup', handlePointerUp)
      }

      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
    },
    [gl, camera, index, onDragStart, onDrag, onDragEnd, levelYOffset],
  )

  // Convert grid position to world position for rendering
  const [worldX, worldZ] = toWorld(position[0], position[1])

  return (
    <mesh
      frustumCulled={false}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      position={[worldX, levelYOffset + Y_OFFSET, worldZ]}
      ref={meshRef}
      renderOrder={9_999_999_999}
    >
      <sphereGeometry args={[isHovered || isDragging ? 0.2 : 0.15, 16, 16]} />
      <meshBasicMaterial
        color={isDragging ? '#22c55e' : isHovered ? (canDelete ? '#ef4444' : '#ffffff') : color}
        depthTest={false}
        depthWrite={false}
        transparent
      />
    </mesh>
  )
}

/**
 * Mid-point handle for adding new vertices between existing ones
 * Creates the vertex on pointer down and immediately starts dragging
 */
function MidPointHandle({
  position,
  index,
  onAdd,
  onDrag,
  onDragEnd,
  levelYOffset,
  color,
}: {
  position: [number, number]
  index: number
  onAdd: (afterIndex: number, initialPosition: [number, number]) => number // Returns new vertex index
  onDrag: (index: number, newPosition: [number, number]) => void
  onDragEnd: () => void
  levelYOffset: number
  color: string
}) {
  const { gl, camera } = useThree()
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const raycaster = useRef(new THREE.Raycaster())
  const newVertexIndexRef = useRef<number>(-1)

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setIsDragging(true)

      // Create the new vertex and get its index
      newVertexIndexRef.current = onAdd(index, position)

      // Update drag plane to be at the current Y level
      dragPlane.current.set(new THREE.Vector3(0, 1, 0), -(levelYOffset + Y_OFFSET))

      // Capture pointer
      ;(e.target as any)?.setPointerCapture?.(e.nativeEvent.pointerId)

      const canvas = gl.domElement

      const handlePointerMove = (moveEvent: PointerEvent) => {
        // Convert pointer position to normalized device coordinates
        const rect = canvas.getBoundingClientRect()
        const x = ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1
        const y = -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1

        // Raycast to the drag plane
        raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)
        const intersection = new THREE.Vector3()
        raycaster.current.ray.intersectPlane(dragPlane.current, intersection)

        if (intersection && newVertexIndexRef.current >= 0) {
          // The intersection is in world coords (with grid offset applied)
          // Need to account for the parent group offset (-GRID_SIZE/2)
          const localX = intersection.x + GRID_SIZE / 2
          const localZ = intersection.z + GRID_SIZE / 2

          // Convert to grid coordinates (snap to grid)
          const [gridX, gridZ] = toGrid(localX, localZ)
          onDrag(newVertexIndexRef.current, [gridX, gridZ])
        }
      }

      const handlePointerUp = () => {
        setIsDragging(false)
        onDragEnd()
        newVertexIndexRef.current = -1
        canvas.removeEventListener('pointermove', handlePointerMove)
        canvas.removeEventListener('pointerup', handlePointerUp)
      }

      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
    },
    [gl, camera, index, position, onAdd, onDrag, onDragEnd, levelYOffset],
  )

  const [worldX, worldZ] = toWorld(position[0], position[1])

  return (
    <mesh
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      position={[worldX, levelYOffset + Y_OFFSET, worldZ]}
    >
      <sphereGeometry args={[isDragging ? 0.2 : isHovered ? 0.12 : 0.08, 16, 16]} />
      <meshBasicMaterial
        color={isDragging ? '#22c55e' : isHovered ? '#22c55e' : color}
        depthTest={false}
        depthWrite={false}
        opacity={isDragging ? 1 : isHovered ? 1 : 0.4}
        transparent
      />
    </mesh>
  )
}

/**
 * Zone boundary editor
 * Shows draggable handles at each polygon vertex when a zone is selected
 */
export function ZoneBoundaryEditor() {
  const selectedZoneId = useEditor((state) => state.selectedZoneId)
  const updateZonePolygon = useEditor((state) => state.updateZonePolygon)
  const levelMode = useEditor((state) => state.levelMode)

  // Get the selected zone's polygon
  const selectedZone = useEditor(
    useShallow((state: StoreState) => {
      if (!selectedZoneId) return null
      return (state.scene.zones || []).find((c) => c.id === selectedZoneId) || null
    }),
  )

  // Get building levels for Y offset calculation
  const buildingLevels = useEditor((state) => {
    const site = state.scene.root.children?.[0]
    const building = site?.children?.find((c) => c.type === 'building')
    return building?.children ?? []
  })

  // Memoize level data to avoid recalculating on every render
  const levelData = useMemo(() => {
    const data: Record<string, { level: number; elevation: number }> = {}
    for (const lvl of buildingLevels) {
      if (lvl.type === 'level') {
        data[lvl.id] = {
          level: (lvl as any).level ?? 0,
          elevation: (lvl as any).elevation ?? 0,
        }
      }
    }
    return data
  }, [buildingLevels])

  // Track dragged polygon during drag (for preview)
  const [draggedPolygon, setDraggedPolygon] = useState<[number, number][] | null>(null)
  // Track if we're currently dragging (to hide mid-point handles)
  const [isDragging, setIsDragging] = useState(false)
  // Use ref to access latest value in callbacks without stale closures
  const draggedPolygonRef = useRef<[number, number][] | null>(null)
  draggedPolygonRef.current = draggedPolygon

  // Reset dragged polygon when switching zones to prevent stale state
  useEffect(() => {
    setDraggedPolygon(null)
  }, [selectedZoneId])

  // Calculate Y offset for the zone's level (matches node-renderer logic)
  const levelYOffset = useMemo(() => {
    if (!selectedZone) return 0
    const data = levelData[selectedZone.levelId]
    if (!data) return 0
    // Elevation is always applied, levelOffset only in exploded mode
    const levelOffset = levelMode === 'exploded' ? data.level * FLOOR_SPACING : 0
    return (data.elevation || 0) + levelOffset
  }, [selectedZone, levelData, levelMode])

  const handleDragStart = useCallback(() => {
    setIsDragging(true)
  }, [])

  const handleDrag = useCallback(
    (index: number, newPosition: [number, number]) => {
      if (!selectedZone) return

      // Use ref to get latest dragged polygon, avoiding stale closure issues
      const basePolygon = draggedPolygonRef.current || selectedZone.polygon
      const newPolygon = [...basePolygon]
      newPolygon[index] = newPosition
      setDraggedPolygon(newPolygon)
    },
    [selectedZone],
  )

  const handleDragEnd = useCallback(() => {
    // Use ref to get latest value, avoiding stale closure issues
    const currentDraggedPolygon = draggedPolygonRef.current
    if (currentDraggedPolygon && selectedZoneId) {
      updateZonePolygon(selectedZoneId, currentDraggedPolygon)
      setDraggedPolygon(null)
    }
    setIsDragging(false)
  }, [selectedZoneId, updateZonePolygon])

  const handleDeleteVertex = useCallback(
    (index: number) => {
      if (!selectedZoneId) return
      const basePolygon = draggedPolygon ?? selectedZone?.polygon
      if (!basePolygon || basePolygon.length <= 3) return // Need at least 3 points

      const newPolygon = basePolygon.filter((_, i) => i !== index)
      updateZonePolygon(selectedZoneId, newPolygon)
      setDraggedPolygon(null)
    },
    [selectedZone?.polygon, selectedZoneId, draggedPolygon, updateZonePolygon],
  )

  const handleAddVertex = useCallback(
    (afterIndex: number, initialPosition: [number, number]): number => {
      if (!selectedZoneId) return -1
      const basePolygon = draggedPolygon ?? selectedZone?.polygon
      if (!basePolygon) return -1

      // Insert new point after afterIndex at the mid-point position
      const newPolygon = [
        ...basePolygon.slice(0, afterIndex + 1),
        initialPosition,
        ...basePolygon.slice(afterIndex + 1),
      ]

      // Set dragged polygon so dragging can continue on the new vertex
      setDraggedPolygon(newPolygon)
      // Mark as dragging to hide mid-point handles
      setIsDragging(true)

      // Return the index of the newly created vertex
      return afterIndex + 1
    },
    [selectedZone?.polygon, selectedZoneId, draggedPolygon],
  )

  if (!selectedZone) return null

  const polygon = draggedPolygon || selectedZone.polygon
  if (!polygon || polygon.length < 3) return null

  // Create line points for the editing border (convert to world coords)
  const linePoints = [
    ...polygon.map(([x, z]) => {
      const [wx, wz] = toWorld(x, z)
      return new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.01, wz)
    }),
    (() => {
      const [wx, wz] = toWorld(polygon[0][0], polygon[0][1])
      return new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.01, wz)
    })(),
  ]

  // Calculate mid-points for each edge
  const midPoints = polygon.map(([x1, z1], index) => {
    const nextIndex = (index + 1) % polygon.length
    const [x2, z2] = polygon[nextIndex]
    return [(x1 + x2) / 2, (z1 + z2) / 2] as [number, number]
  })

  const canDelete = polygon.length > 3

  return (
    <group>
      {/* Highlighted border when editing */}
      <Line color="#ffffff" depthTest={false} lineWidth={2} points={linePoints} />

      {/* Draggable handles at each vertex */}
      {polygon.map(([x, z], index) => (
        <DragHandle
          canDelete={canDelete}
          color={selectedZone.color || '#3b82f6'}
          index={index}
          key={`vertex-${index}`}
          levelYOffset={levelYOffset}
          onDelete={handleDeleteVertex}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          position={[x, z]}
        />
      ))}

      {/* Mid-point handles for adding new vertices (hidden while dragging) */}
      {!isDragging &&
        midPoints.map((pos, index) => (
          <MidPointHandle
            color={selectedZone.color || '#3b82f6'}
            index={index}
            key={`midpoint-${index}`}
            levelYOffset={levelYOffset}
            onAdd={handleAddVertex}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            position={pos}
          />
        ))}
    </group>
  )
}
