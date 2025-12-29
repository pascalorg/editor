'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import { useMaterial } from '@/lib/materials'
import type { SlabNode } from '@/lib/scenegraph/schema/index'
import { WALL_THICKNESS } from '../wall/wall-renderer'

export const SLAB_THICKNESS = 0.2 // 20cm thickness

interface SlabRendererProps {
  nodeId: SlabNode['id']
}

const SLAB_SPILLOVER = WALL_THICKNESS

export function SlabRenderer({ nodeId }: SlabRendererProps) {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const { nodeSize, isPreview, levelId, canPlace, material } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as SlabNode | undefined
      return {
        nodeSize: node?.size,
        isPreview: node?.editor?.preview === true,
        levelId: state.getLevelId(nodeId),
        canPlace: node?.editor?.canPlace !== false,
        material: node?.material || 'tile',
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

  // Position the slab at ground level (half of thickness above y=0)
  const yPosition = SLAB_THICKNESS / 2

  // Offset to position the bottom-left corner at the node's position
  // BoxGeometry is centered, so we need to shift by half the size
  const xOffset = (width * TILE_SIZE) / 2
  const zOffset = (depth * TILE_SIZE) / 2

  const slabMaterial = useMaterial(
    isActiveFloor
      ? isPreview
        ? canPlace
          ? 'preview-valid'
          : 'preview-invalid'
        : material
      : 'ghost',
  )

  return (
    <>
      <mesh
        castShadow
        geometry={slabGeometry}
        material={slabMaterial}
        position={[xOffset, yPosition, zOffset]}
        receiveShadow
      />
      {/* <meshPhysicalMaterial
            color="#dcdcf7"
            key={`slab-material-${opacity}`}
            metalness={0.2}
            opacity={opacity}
            roughness={0.8}
            transparent={transparent}
          /> */}
    </>
  )
}
