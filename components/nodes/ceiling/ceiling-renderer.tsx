'use client'

import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { emitter } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import type { CeilingNode, GridPoint } from '@/lib/scenegraph/schema/index'

export const CEILING_THICKNESS = 0.15 // 15cm thickness
export const DEFAULT_CEILING_ELEVATION = 2.5 // 2.5m default height

interface CeilingRendererProps {
  nodeId: CeilingNode['id']
}

/**
 * Get closest grid point from a THREE.js intersection point
 */
function getClosestGridPoint(point: THREE.Vector3, object: THREE.Object3D): GridPoint {
  // Transform the world point to the ceiling mesh's local coordinate system
  // This automatically handles all parent transforms (level, building, etc.)
  const localPoint = object.worldToLocal(point.clone())

  // Convert to grid coordinates in local space
  const localGridX = localPoint.x / TILE_SIZE
  const localGridZ = localPoint.z / TILE_SIZE

  // Return the grid position rounded to nearest grid point
  return {
    x: Math.round(localGridX),
    z: Math.round(localGridZ),
  }
}

export function CeilingRenderer({ nodeId }: CeilingRendererProps) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const { nodeSize, isPreview, levelId, canPlace, node } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as CeilingNode | undefined
      return {
        node,
        nodeSize: node?.size,
        isPreview: node?.editor?.preview === true,
        levelId: state.getLevelId(nodeId),
        canPlace: node?.editor?.canPlace !== false,
      }
    }),
  )

  const [width, depth] = nodeSize || [0, 0]

  // Create plane geometry for the ceiling
  const ceilingGeometry = useMemo(
    () => new THREE.PlaneGeometry(width * TILE_SIZE, depth * TILE_SIZE),
    [width, depth],
  )

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Offset to position the bottom-left corner at the node's position
  // PlaneGeometry is centered, so we need to shift by half the size
  const xOffset = (width * TILE_SIZE) / 2
  const zOffset = (depth * TILE_SIZE) / 2

  // Check if this preview can be placed
  const previewColor = canPlace ? '#44ff44' : '#ff4444'
  const previewEmissive = canPlace ? '#22aa22' : '#aa2222'

  // Event handlers for custom events
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // e.stopPropagation()
    if (!node) return

    emitter.emit('ceiling:click', {
      node,
      gridPosition: getClosestGridPoint(e.point, e.object),
      position: [e.point.x, e.point.y, e.point.z],
    })
  }

  const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
    // e.stopPropagation()
    if (!node) return

    emitter.emit('ceiling:enter', {
      node,
      gridPosition: getClosestGridPoint(e.point, e.object),
      position: [e.point.x, e.point.y, e.point.z],
    })
  }

  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    // e.stopPropagation()
    if (!node) return

    emitter.emit('ceiling:leave', {
      node,
      gridPosition: getClosestGridPoint(e.point, e.object),
      position: [e.point.x, e.point.y, e.point.z],
    })
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    // e.stopPropagation()
    if (!node) return

    emitter.emit('ceiling:move', {
      node,
      gridPosition: getClosestGridPoint(e.point, e.object),
      position: [e.point.x, e.point.y, e.point.z],
    })
  }

  return (
    <group>
      {/* Top side (visible from above) - semi-transparent */}
      <mesh
        // castShadow={!isPreview}
        geometry={ceilingGeometry}
        onClick={isPreview ? undefined : handleClick}
        onPointerEnter={isPreview ? undefined : handlePointerEnter}
        onPointerLeave={isPreview ? undefined : handlePointerLeave}
        onPointerMove={isPreview ? undefined : handlePointerMove}
        position={[xOffset, 0.05, zOffset]}
        // receiveShadow={!isPreview}
        renderOrder={isPreview ? 1 : undefined}
        rotation={[-Math.PI / 2, 0, 0]} // Rotate to horizontal
      >
        <meshStandardMaterial
          color={isPreview ? previewColor : '#f0f0f0'}
          depthTest={!isPreview}
          emissive={isPreview ? previewEmissive : undefined}
          emissiveIntensity={isPreview ? 0.1 : 0}
          key={`ceiling-top-${opacity}-${isPreview}`}
          metalness={0.1}
          opacity={isPreview ? 0.15 : opacity * 0.5}
          roughness={0.9}
          side={THREE.FrontSide}
          transparent
        />
      </mesh>

      {/* Bottom side (visible from below) - opaque or brighter preview */}
      <mesh
        // castShadow={!isPreview}
        geometry={ceilingGeometry}
        onClick={isPreview ? undefined : handleClick}
        onPointerEnter={isPreview ? undefined : handlePointerEnter}
        onPointerLeave={isPreview ? undefined : handlePointerLeave}
        onPointerMove={isPreview ? undefined : handlePointerMove}
        position={[xOffset, -0.05, zOffset]} // Slight offset to avoid z-fighting
        // receiveShadow={!isPreview}
        renderOrder={isPreview ? 1 : undefined}
        rotation={[-Math.PI / 2, 0, 0]} // Rotate to horizontal
      >
        <meshStandardMaterial
          color={isPreview ? previewColor : '#ffffff'}
          depthTest={!isPreview}
          emissive={isPreview ? previewEmissive : undefined}
          emissiveIntensity={isPreview ? 0.4 : 0}
          key={`ceiling-bottom-${opacity}-${isPreview}`}
          metalness={0.1}
          opacity={isPreview ? 0.5 : opacity}
          roughness={0.8}
          side={THREE.BackSide}
          transparent={isPreview || transparent}
        />
      </mesh>
    </group>
  )
}
