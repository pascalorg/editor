'use client'

import { Gltf } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import * as THREE from 'three'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { ItemNode } from '@/lib/scenegraph/schema/index'

interface ItemRendererProps {
  node: ItemNode
}

export function ItemRenderer({ node }: ItemRendererProps) {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Check if this is a preview node
  const isPreview = node.editor?.preview === true
  const canPlace = (node as any).canPlace !== false

  const levelId = useMemo(() => {
    const id = getLevelId(node)
    return id
  }, [getLevelId, node])

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Default box geometry for items without a model (scaled by TILE_SIZE for grid visualization)
  const boxGeometry = useMemo(
    () => new THREE.BoxGeometry(node.size[0] * TILE_SIZE, 0.8, node.size[1] * TILE_SIZE),
    [node.size],
  )

  // Determine color based on preview state and placement validity
  const getColor = () => {
    if (isPreview) {
      return canPlace ? '#44ff44' : '#ff4444'
    }
    // Color based on category
    switch (node.category) {
      case 'furniture':
        return '#8B4513' // Brown
      case 'appliance':
        return '#C0C0C0' // Silver
      case 'decoration':
        return '#FFD700' // Gold
      case 'lighting':
        return '#FFFF00' // Yellow
      case 'plumbing':
        return '#4169E1' // Blue
      case 'electric':
        return '#FF8C00' // Orange
      default:
        return '#808080' // Gray
    }
  }

  return (
    <>
      {isPreview && (
        // Preview rendering with X-ray effect
        <group>
          {/* Visible/in-front version - brighter, normal depth testing */}
          <mesh geometry={boxGeometry} position-y={0.4} renderOrder={2}>
            <meshStandardMaterial color={getColor()} depthWrite={false} opacity={0.3} transparent />
          </mesh>
        </group>
      )}

      <ErrorBoundary fallback={null}>
        <Suspense
          fallback={
            <mesh geometry={boxGeometry} position-y={0.4}>
              <meshStandardMaterial
                color={getColor()}
                opacity={opacity}
                transparent={transparent}
              />
            </mesh>
          }
        >
          <Gltf
            castShadow
            position={[node.position[0], 0, node.position[1]]}
            receiveShadow
            rotation={node.rotation}
            scale={node.scale || [1, 1, 1]}
            src={node.src}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}
