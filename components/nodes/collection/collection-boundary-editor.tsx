'use client'

import { Line } from '@react-three/drei'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { type StoreState, useEditor } from '@/hooks/use-editor'

// Height offset to prevent z-fighting
const Y_OFFSET = 0.05

// Convert grid coordinates to world coordinates
const toWorld = (x: number, z: number): [number, number] => [x * TILE_SIZE, z * TILE_SIZE]

// Convert world coordinates to grid coordinates
const toGrid = (x: number, z: number): [number, number] => [Math.round(x / TILE_SIZE), Math.round(z / TILE_SIZE)]

/**
 * Draggable handle for editing collection polygon vertices
 */
function DragHandle({
  position,
  index,
  onDrag,
  onDragEnd,
  levelYOffset,
}: {
  position: [number, number]
  index: number
  onDrag: (index: number, newPosition: [number, number]) => void
  onDragEnd: () => void
  levelYOffset: number
}) {
  const { gl, camera } = useThree()
  const meshRef = useRef<THREE.Mesh>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const raycaster = useRef(new THREE.Raycaster())

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setIsDragging(true)

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
    [gl, camera, index, onDrag, onDragEnd, levelYOffset],
  )

  // Convert grid position to world position for rendering
  const [worldX, worldZ] = toWorld(position[0], position[1])

  return (
    <mesh
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      position={[worldX, levelYOffset + Y_OFFSET, worldZ]}
      ref={meshRef}
    >
      <sphereGeometry args={[isHovered || isDragging ? 0.2 : 0.15, 16, 16]} />
      <meshBasicMaterial color={isDragging ? '#22c55e' : isHovered ? '#60a5fa' : '#3b82f6'} />
    </mesh>
  )
}

/**
 * Collection boundary editor
 * Shows draggable handles at each polygon vertex when a collection is selected
 */
export function CollectionBoundaryEditor() {
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const updateCollectionPolygon = useEditor((state) => state.updateCollectionPolygon)
  const levelMode = useEditor((state) => state.levelMode)
  const currentLevel = useEditor((state) => state.currentLevel)

  // Get the selected collection's polygon
  const selectedCollection = useEditor(
    useShallow((state: StoreState) => {
      if (!selectedCollectionId) return null
      return (state.scene.collections || []).find((c) => c.id === selectedCollectionId) || null
    }),
  )

  // Track dragged polygon during drag (for preview)
  const [draggedPolygon, setDraggedPolygon] = useState<[number, number][] | null>(null)

  // Calculate Y offset for the current level
  const levelYOffset = useMemo(() => {
    if (levelMode === 'exploded') {
      return currentLevel * 5
    }
    return currentLevel * 3
  }, [levelMode, currentLevel])

  const handleDrag = useCallback(
    (index: number, newPosition: [number, number]) => {
      if (!selectedCollection) return

      const basePolygon = draggedPolygon || selectedCollection.polygon
      const newPolygon = [...basePolygon]
      newPolygon[index] = newPosition
      setDraggedPolygon(newPolygon)
    },
    [selectedCollection, draggedPolygon],
  )

  const handleDragEnd = useCallback(() => {
    if (draggedPolygon && selectedCollectionId) {
      updateCollectionPolygon(selectedCollectionId, draggedPolygon)
      setDraggedPolygon(null)
    }
  }, [draggedPolygon, selectedCollectionId, updateCollectionPolygon])

  if (!selectedCollection) return null

  const polygon = draggedPolygon || selectedCollection.polygon
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

  return (
    <group>
      {/* Highlighted border when editing */}
      <Line color="#ffffff" lineWidth={2} points={linePoints} />

      {/* Draggable handles at each vertex */}
      {polygon.map(([x, z], index) => (
        <DragHandle
          index={index}
          key={index}
          levelYOffset={levelYOffset}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          position={[x, z]}
        />
      ))}
    </group>
  )
}
