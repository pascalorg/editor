'use client'

import { Line } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { type CollectionPreviewEvent, emitter } from '@/events/bus'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'

// Height offset to prevent z-fighting with floor
const Y_OFFSET = 0.02

// Convert grid coordinates to world coordinates
const toWorld = (x: number, z: number): [number, number] => [x * TILE_SIZE, z * TILE_SIZE]

/**
 * Renders a single collection as a colored polygon zone on the floor
 */
function CollectionZone({
  collection,
  isSelected,
  levelYOffset,
}: {
  collection: Collection
  isSelected: boolean
  levelYOffset: number
}) {
  const polygon = collection.polygon
  const color = collection.color || '#3b82f6'

  // Create the polygon shape (convert grid coords to world coords)
  const { shape, linePoints } = useMemo(() => {
    if (!polygon || polygon.length < 3) return { shape: null, linePoints: [] }

    // Convert to world coordinates
    const worldPts = polygon.map(([x, z]) => toWorld(x, z))

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const shape = new THREE.Shape()
    shape.moveTo(worldPts[0][0], -worldPts[0][1])

    for (let i = 1; i < worldPts.length; i++) {
      shape.lineTo(worldPts[i][0], -worldPts[i][1])
    }
    shape.closePath()

    // Create line points for the border (close the loop)
    const linePoints = [
      ...worldPts.map(([x, z]) => new THREE.Vector3(x, levelYOffset + Y_OFFSET + 0.01, z)),
      new THREE.Vector3(worldPts[0][0], levelYOffset + Y_OFFSET + 0.01, worldPts[0][1]),
    ]

    return { shape, linePoints }
  }, [polygon, levelYOffset])

  if (!shape) return null

  return (
    <group>
      {/* Filled polygon */}
      <mesh position={[0, levelYOffset + Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={color}
          opacity={isSelected ? 0.4 : 0.25}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      {/* Border line */}
      <Line
        color={isSelected ? '#ffffff' : color}
        lineWidth={isSelected ? 2 : 1}
        points={linePoints}
      />
    </group>
  )
}

/**
 * Renders the collection preview while drawing
 */
function CollectionPreview({ levelYOffset }: { levelYOffset: number }) {
  const [previewState, setPreviewState] = useState<CollectionPreviewEvent>({ points: [] })

  useEffect(() => {
    const handlePreview = (event: CollectionPreviewEvent) => {
      setPreviewState(event)
    }

    emitter.on('collection:preview', handlePreview)
    return () => {
      emitter.off('collection:preview', handlePreview)
    }
  }, [])

  const { points, cursorPoint } = previewState

  // Create line points including cursor (convert grid coords to world coords)
  const linePoints = useMemo(() => {
    if (points.length === 0) return []

    const pts = points.map(([x, z]) => {
      const [wx, wz] = toWorld(x, z)
      return new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.02, wz)
    })

    // Add cursor point if available
    if (cursorPoint) {
      const [wx, wz] = toWorld(cursorPoint[0], cursorPoint[1])
      pts.push(new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.02, wz))
    }

    return pts
  }, [points, cursorPoint, levelYOffset])

  // Create closing line to first point when we have 3+ points
  const closingLinePoints = useMemo(() => {
    if (points.length < 3 || !cursorPoint) return []

    const [cwx, cwz] = toWorld(cursorPoint[0], cursorPoint[1])
    const [fwx, fwz] = toWorld(points[0][0], points[0][1])
    return [
      new THREE.Vector3(cwx, levelYOffset + Y_OFFSET + 0.02, cwz),
      new THREE.Vector3(fwx, levelYOffset + Y_OFFSET + 0.02, fwz),
    ]
  }, [points, cursorPoint, levelYOffset])

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const allPoints = [...points]
    if (cursorPoint) {
      allPoints.push(cursorPoint)
    }

    // Convert to world coordinates
    const worldPts = allPoints.map(([x, z]) => toWorld(x, z))

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const shape = new THREE.Shape()
    shape.moveTo(worldPts[0][0], -worldPts[0][1])

    for (let i = 1; i < worldPts.length; i++) {
      shape.lineTo(worldPts[i][0], -worldPts[i][1])
    }
    shape.closePath()

    return shape
  }, [points, cursorPoint])

  if (points.length === 0) return null

  return (
    <group>
      {/* Preview fill */}
      {previewShape && (
        <mesh position={[0, levelYOffset + Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#3b82f6"
            depthTest={false}
            opacity={0.15}
            side={THREE.DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line */}
      {linePoints.length >= 2 && (
        <Line color="#3b82f6" depthTest={false} lineWidth={2} points={linePoints} />
      )}

      {/* Closing line (dashed) */}
      {closingLinePoints.length === 2 && (
        <Line
          color="#3b82f6"
          dashed
          dashScale={10}
          depthTest={false}
          lineWidth={1}
          points={closingLinePoints}
        />
      )}

      {/* Point markers */}
      {points.map(([x, z], index) => {
        const [wx, wz] = toWorld(x, z)
        return (
          <mesh key={index} position={[wx, levelYOffset + Y_OFFSET + 0.03, wz]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color={index === 0 ? '#22c55e' : '#3b82f6'} depthTest={false} />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Main collection renderer component
 * Renders all collections for the current level and the drawing preview
 */
export function CollectionRenderer() {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const levelMode = useEditor((state) => state.levelMode)
  const currentLevel = useEditor((state) => state.currentLevel)

  // Get all collections for the current level
  const collections = useEditor(
    useShallow((state: StoreState) => {
      if (!selectedFloorId) return []
      return (state.scene.collections || []).filter((c) => c.levelId === selectedFloorId)
    }),
  )

  // Calculate Y offset for the current level
  const levelYOffset = useMemo(() => {
    if (levelMode === 'exploded') {
      // In exploded mode, levels are separated by FLOOR_SPACING (5 units)
      return currentLevel * 5
    }
    // In stacked mode, levels stack at their actual height
    return currentLevel * 3 // WALL_HEIGHT
  }, [levelMode, currentLevel])

  return (
    <group>
      {/* Render all collections for the current level */}
      {collections.map((collection) => (
        <CollectionZone
          collection={collection}
          isSelected={selectedCollectionId === collection.id}
          key={collection.id}
          levelYOffset={levelYOffset}
        />
      ))}

      {/* Render the drawing preview */}
      <CollectionPreview levelYOffset={levelYOffset} />
    </group>
  )
}
