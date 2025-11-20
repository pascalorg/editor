'use client'

import { Gltf } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { ItemNode } from '@/lib/scenegraph/schema/index'

interface ItemRendererProps {
  nodeId: ItemNode['id']
}

export function ItemRenderer({ nodeId }: ItemRendererProps) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const {
    nodeSize,
    isPreview,
    levelId,
    canPlace,
    nodeCategory,
    nodeScale,
    nodeSrc,
    nodePosition,
    nodeRotation,
  } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as ItemNode | undefined
      return {
        nodeSize: node?.size,
        isPreview: node?.editor?.preview === true,
        levelId: handle?.meta.levelId,
        canPlace: node?.editor?.canPlace !== false,
        nodePosition: node?.position,
        nodeRotation: node?.rotation,
        nodeCategory: node?.category,
        nodeScale: node?.scale,
        nodeSrc: node?.src,
      }
    }),
  )

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Default box geometry for items without a model (scaled by TILE_SIZE for grid visualization)
  const boxGeometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        (nodeSize?.[0] ?? 0) * TILE_SIZE,
        0.8,
        (nodeSize?.[1] ?? 0) * TILE_SIZE,
      ),
    [nodeSize],
  )

  // Determine color based on preview state and placement validity
  const getColor = () => {
    if (isPreview) {
      return canPlace ? '#44ff44' : '#ff4444'
    }
    // Color based on category
    switch (nodeCategory) {
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
            position={[nodePosition?.[0] ?? 0, 0, nodePosition?.[1] ?? 0]}
            receiveShadow
            rotation={nodeRotation}
            scale={nodeScale || [1, 1, 1]}
            src={nodeSrc ?? ''}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}
