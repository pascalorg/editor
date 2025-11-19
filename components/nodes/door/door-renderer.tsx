'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useEditor } from '@/hooks/use-editor'
import type { DoorNode } from '@/lib/scenegraph/schema/index'
import { TILE_SIZE } from '../../editor'

interface DoorRendererProps {
  node: DoorNode
}

export const DoorRenderer = memo(({ node }: DoorRendererProps) => {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const doorRef = useRef<THREE.Group>(null)

  // Check if this is a preview node
  const isPreview = node.preview === true
  const canPlace = (node as any).canPlace !== false

  const levelId = useMemo(() => {
    const id = getLevelId(node)
    return id
  }, [getLevelId, node])

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  // Apply opacity to all materials in the door model
  useEffect(() => {
    if (!doorRef.current) return

    const applyOpacity = () => {
      if (!doorRef.current) return

      doorRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const material = child.material as THREE.Material
          if (material.name === 'glass') {
            return // Skip glass materials
          }
          if ('opacity' in material && 'transparent' in material && 'depthWrite' in material) {
            material.opacity = opacity
            material.transparent = opacity < 1
            material.depthWrite = true
            material.side = THREE.DoubleSide
          }
        }
      })
    }

    // Apply immediately
    applyOpacity()

    // Also apply after a short delay to catch late-loading GLTF materials
    const timeoutId = setTimeout(applyOpacity, 50)

    return () => clearTimeout(timeoutId)
  }, [opacity])

  // Create rectangle geometry for preview (2 cells along wall, 2 cells perpendicular)
  const rectangleGeometry = useMemo(() => {
    const width = TILE_SIZE * 2 // Width along the wall (2 cells)
    const depth = TILE_SIZE * 2 // Depth perpendicular to wall (1 cell front, 1 cell back)
    const geometry = new THREE.PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2) // Rotate to lie flat on ground
    return geometry
  }, [])

  return (
    <>
      {isPreview && (
        <>
          {/* Placement indicator rectangle on ground */}
          <mesh geometry={rectangleGeometry} position={[0, 0.01, 0]}>
            <meshStandardMaterial
              color={canPlace ? '#44ff44' : '#ff4444'}
              depthTest={false}
              depthWrite={false}
              opacity={0.3}
              transparent
            />
          </mesh>
        </>
      )}
      <group position={[0, 0, 0]} ref={doorRef} scale={[2, 2, 2]}>
        <Gltf src="/models/Door.glb" />
      </group>
    </>
  )
})

DoorRenderer.displayName = 'DoorRenderer'

// Preload GLTF
useGLTF.preload('/models/Door.glb')
