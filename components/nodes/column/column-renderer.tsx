'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import type { ColumnNode } from '@/lib/scenegraph/schema/index'
import { TILE_SIZE, WALL_HEIGHT } from '../../editor'

const COLUMN_RADIUS = 0.15 // 15cm radius

interface ColumnRendererProps {
  nodeId: ColumnNode['id']
}

export function ColumnRenderer({ nodeId }: ColumnRendererProps) {
  const { selectedFloorId, isPreview, levelId } = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId) as ColumnNode | undefined
      return {
        selectedFloorId: state.selectedFloorId,
        isPreview: node?.editor?.preview === true,
        levelId: node ? state.getLevelId(node!) : null,
      }
    }),
  )

  // Create cylinder geometry
  const cylinderGeometry = useMemo(
    () => new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, WALL_HEIGHT, 16),
    [],
  )

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Position is handled by parent group in NodeRenderer
  // We only need to position the column vertically (Y axis)
  const yPosition = WALL_HEIGHT / 2

  return (
    <>
      {isPreview ? (
        <group>
          {/* Occluded/behind version - dimmer, shows through everything */}
          <mesh geometry={cylinderGeometry} position-y={yPosition} renderOrder={1}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={false}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.1}
              opacity={0.15}
              transparent
            />
          </mesh>
          {/* Visible/front version - brighter, only shows when not occluded */}
          <mesh geometry={cylinderGeometry} position-y={yPosition} renderOrder={2}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={true}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.4}
              opacity={0.5}
              transparent
            />
          </mesh>
        </group>
      ) : (
        <mesh castShadow geometry={cylinderGeometry} position-y={yPosition} receiveShadow>
          <meshStandardMaterial
            color="beige"
            metalness={0.1}
            opacity={opacity}
            roughness={0.7}
            transparent={transparent}
          />
        </mesh>
      )}
    </>
  )
}
