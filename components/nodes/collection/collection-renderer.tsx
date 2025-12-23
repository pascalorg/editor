'use client'

import { Billboard, Line } from '@react-three/drei'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { Container, Text } from '@react-three/uikit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { FLOOR_SPACING, TILE_SIZE } from '@/components/editor'
import { type CollectionPreviewEvent, emitter } from '@/events/bus'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'

// Height offset to prevent z-fighting with floor
const Y_OFFSET = 0.02

// Convert grid coordinates to world coordinates
const toWorld = (x: number, z: number): [number, number] => [x * TILE_SIZE, z * TILE_SIZE]

const tmpVec3 = new THREE.Vector3()
/**
 * Label displayed at the center of a collection zone
 */
function CollectionLabel({
  name,
  color,
  centerX,
  centerZ,
  levelYOffset,
}: {
  name: string
  color: string
  centerX: number
  centerZ: number
  levelYOffset: number
}) {
  const labelRef = useRef<THREE.Group>(null)

  useFrame(({ camera }) => {
    // Scale control panel based on camera distance to maintain consistent visual size
    if (labelRef.current && labelRef) {
      tmpVec3.set(centerX, levelYOffset + 2, centerZ)
      // Calculate distance from camera to the selection center
      const distance = camera.position.distanceTo(tmpVec3)
      // Use distance to calculate appropriate scale
      const scale = distance * 0.12 // Adjust multiplier for desired size
      const finalScale = Math.min(Math.max(scale, 0.5), 2) // Clamp between 0.5 and 2
      labelRef.current.scale.setScalar(finalScale)
    }
  })

  return (
    <group position={[centerX, levelYOffset + 2, centerZ]} ref={labelRef}>
      <Billboard>
        <Container
          alignItems="center"
          backgroundColor="#21222a"
          borderRadius={6}
          depthTest={false}
          flexDirection="row"
          gap={0}
          height={40}
          opacity={0.9}
          paddingRight={16}
          renderOrder={1000}
        >
          {/* Color circle */}
          <Container
            backgroundColor={color}
            borderRadius={1000}
            height={42}
            opacity={1}
            positionLeft={-12}
            width={42}
          />
          {/* Label text */}
          <Text color="white" fontSize={20} fontWeight="medium">
            {name}
          </Text>
        </Container>
      </Billboard>
    </group>
  )
}

/**
 * Renders a single collection as a colored polygon zone on the floor
 */
function CollectionZone({
  collection,
  isSelected,
  levelYOffset,
  isInteractive,
  onSelect,
  showLabel,
}: {
  collection: Collection
  isSelected: boolean
  levelYOffset: number
  isInteractive?: boolean
  onSelect?: (collectionId: string) => void
  showLabel?: boolean
}) {
  const polygon = collection.polygon
  const color = collection.color || '#3b82f6'
  const [isHovered, setIsHovered] = useState(false)

  // Create the polygon shape (convert grid coords to world coords)
  const { shape, linePoints, center } = useMemo(() => {
    if (!polygon || polygon.length < 3) return { shape: null, linePoints: [], center: null }

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

    // Calculate centroid of polygon
    let sumX = 0
    let sumZ = 0
    for (const [x, z] of worldPts) {
      sumX += x
      sumZ += z
    }
    const center = { x: sumX / worldPts.length, z: sumZ / worldPts.length }

    return { shape, linePoints, center }
  }, [polygon, levelYOffset])

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!isInteractive) return
      e.stopPropagation()
      onSelect?.(collection.id)
    },
    [isInteractive, onSelect, collection.id],
  )

  const handlePointerEnter = useCallback(() => {
    if (isInteractive) setIsHovered(true)
  }, [isInteractive])

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  if (!shape) return null

  // Determine visual state based on selection and hover
  const isHighlighted = isSelected || isHovered
  const fillOpacity = isSelected ? 0.4 : isHovered ? 0.35 : 0.25

  return (
    <group>
      {/* Filled polygon */}
      <mesh
        frustumCulled={false}
        onClick={handleClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        position={[0, levelYOffset + Y_OFFSET, 0]}
        renderOrder={999}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          opacity={fillOpacity}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      {/* Border line */}
      <Line
        color={isHighlighted ? '#ffffff' : color}
        lineWidth={isHighlighted ? 2 : 1}
        points={linePoints}
      />

      {/* Label at center */}
      {showLabel && center && (
        <CollectionLabel
          centerX={center.x}
          centerZ={center.z}
          color={color}
          levelYOffset={levelYOffset}
          name={collection.name}
        />
      )}
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
export function CollectionRenderer({ isViewer = false }: { isViewer?: boolean }) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const selectCollection = useEditor((state) => state.selectCollection)
  const levelMode = useEditor((state) => state.levelMode)
  const viewMode = useEditor((state) => state.viewMode)

  // Determine if a collection should be interactive
  // Only collections on the currently selected level are interactive in viewer mode
  const getIsInteractive = useCallback(
    (collectionLevelId: string) =>
      isViewer && !!selectedFloorId && collectionLevelId === selectedFloorId,
    [isViewer, selectedFloorId],
  )

  const handleSelectCollection = useCallback(
    (collectionId: string) => {
      selectCollection(collectionId)
    },
    [selectCollection],
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

  // Get all collections from the store
  const allCollections = useEditor(useShallow((state: StoreState) => state.scene.collections || []))

  // Filter collections based on view mode and selection
  const collections = useMemo(() => {
    // In viewer mode with a collection selected, only show the selected collection
    if (isViewer && selectedCollectionId) {
      return allCollections.filter((c) => c.id === selectedCollectionId)
    }
    // In full view mode (no floor selected), show all collections
    if (viewMode === 'full' || !selectedFloorId) {
      return allCollections
    }
    // In level view mode, show only collections for the selected floor
    return allCollections.filter((c) => c.levelId === selectedFloorId)
  }, [allCollections, viewMode, selectedFloorId, isViewer, selectedCollectionId])

  // Calculate Y offset for the current level (used for preview)
  const previewLevelYOffset = useMemo(() => {
    if (!selectedFloorId) return 0
    const data = levelData[selectedFloorId]
    if (!data) return 0
    // Elevation is always applied, levelOffset only in exploded mode
    const levelOffset = levelMode === 'exploded' ? data.level * FLOOR_SPACING : 0
    return (data.elevation || 0) + levelOffset
  }, [levelMode, selectedFloorId, levelData])

  // Calculate Y offset for a specific level (matches node-renderer logic)
  const getLevelYOffset = useCallback(
    (levelId: string) => {
      const data = levelData[levelId]
      if (!data) return 0
      // Elevation is always applied, levelOffset only in exploded mode
      const levelOffset = levelMode === 'exploded' ? data.level * FLOOR_SPACING : 0
      return (data.elevation || 0) + levelOffset
    },
    [levelMode, levelData],
  )

  // Determine if labels should be shown for a collection
  // Show labels in viewer mode when on the selected floor and no collection is selected
  const getShowLabel = useCallback(
    (collectionLevelId: string) =>
      isViewer &&
      !!selectedFloorId &&
      collectionLevelId === selectedFloorId &&
      !selectedCollectionId,
    [isViewer, selectedFloorId, selectedCollectionId],
  )

  return (
    <group>
      {/* Render all collections */}
      {collections.map((collection) => (
        <CollectionZone
          collection={collection}
          isInteractive={getIsInteractive(collection.levelId)}
          isSelected={selectedCollectionId === collection.id}
          key={collection.id}
          levelYOffset={getLevelYOffset(collection.levelId)}
          onSelect={handleSelectCollection}
          showLabel={getShowLabel(collection.levelId)}
        />
      ))}

      {/* Render the drawing preview */}
      <CollectionPreview levelYOffset={previewLevelYOffset} />
    </group>
  )
}
