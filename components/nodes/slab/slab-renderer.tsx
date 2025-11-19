'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { FloorNode } from '@/lib/scenegraph/schema/index'
import { WALL_THICKNESS } from '../wall/wall-renderer'

export const SLAB_THICKNESS = 0.2 // 20cm thickness

interface SlabRendererProps {
  nodeId: FloorNode['id']
}

const SLAB_SPILLOVER = WALL_THICKNESS

export function SlabRenderer({ nodeId }: SlabRendererProps) {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const { nodeSize, isPreview, levelId, canPlace } = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId) as FloorNode | undefined
      return {
        nodeSize: node?.size,
        isPreview: node?.editor?.preview === true,
        levelId: state.getLevelId(node!),
        canPlace: 'canPlace' in (node || {}) ? node?.canPlace !== false : true,
      }
    }),
  )

  // Create box geometry for the slab
  const [width, depth] = nodeSize || [0, 0]
  const slabGeometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        width * TILE_SIZE + SLAB_SPILLOVER,
        SLAB_THICKNESS,
        depth * TILE_SIZE + SLAB_SPILLOVER,
      ),
    [width, depth],
  )

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Position the slab at ground level (half of thickness above y=0)
  const yPosition = SLAB_THICKNESS / 2

  // Offset to position the bottom-left corner at the node's position
  // BoxGeometry is centered, so we need to shift by half the size
  const xOffset = (width * TILE_SIZE) / 2
  const zOffset = (depth * TILE_SIZE) / 2

  // Check if this preview can be placed
  const previewColor = canPlace ? '#44ff44' : '#ff4444'
  const previewEmissive = canPlace ? '#22aa22' : '#aa2222'

  return (
    <>
      {isPreview ? (
        <group>
          {/* Occluded/behind version - dimmer, shows through everything */}
          <mesh geometry={slabGeometry} position={[xOffset, yPosition, zOffset]} renderOrder={1}>
            <meshStandardMaterial
              color={previewColor}
              depthTest={false}
              depthWrite={false}
              emissive={previewEmissive}
              emissiveIntensity={0.1}
              opacity={0.15}
              transparent
            />
          </mesh>
          {/* Visible/front version - brighter, only shows when not occluded */}
          <mesh geometry={slabGeometry} position={[xOffset, yPosition, zOffset]} renderOrder={2}>
            <meshStandardMaterial
              color={previewColor}
              depthTest={true}
              depthWrite={false}
              emissive={previewEmissive}
              emissiveIntensity={0.4}
              opacity={0.5}
              transparent
            />
          </mesh>
        </group>
      ) : (
        <mesh
          castShadow
          geometry={slabGeometry}
          position={[xOffset, yPosition, zOffset]}
          receiveShadow
        >
          <meshStandardMaterial
            color="#808080"
            key={`slab-material-${opacity}`}
            metalness={0.2}
            opacity={opacity}
            roughness={0.8}
            transparent={transparent}
          />
        </mesh>
      )}
    </>
  )
}
