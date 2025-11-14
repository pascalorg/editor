'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { WindowNode } from './window-node'

interface WindowRendererProps {
  node: WindowNode
}

export const WindowRenderer = memo(({ node }: WindowRendererProps) => {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const windowRef = useRef<THREE.Group>(null)

  const isPreview = node.preview === true
  const canPlace = (node as any).canPlace !== false

  const levelId = useMemo(() => getLevelId(node), [getLevelId, node])
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3

  useEffect(() => {
    if (!windowRef.current) return

    const applyOpacity = () => {
      if (!windowRef.current) return

      windowRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const material = child.material as THREE.MeshStandardMaterial
          if (material.name.toLowerCase() === 'glass') {
            return // Skip glass materials
          }
          material.opacity = opacity
          material.transparent = opacity < 1
          material.depthWrite = true
          material.side = THREE.DoubleSide
        }
      })
    }

    applyOpacity()
    const timeoutId = window.setTimeout(applyOpacity, 50)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [opacity])

  const placementIndicatorGeometry = useMemo(() => {
    const width = TILE_SIZE * 2
    const depth = TILE_SIZE * 2
    const geometry = new THREE.PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])

  return (
    <>
      {isPreview && (
        <>
          <mesh geometry={placementIndicatorGeometry} position={[0, 0.01, 0]}>
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

      <group position={[0, 0, 0]} ref={windowRef} scale={[1, 1, 1]}>
        <Gltf position-y={0.5} src="/models/Window.glb" />
      </group>
    </>
  )
})

WindowRenderer.displayName = 'WindowRenderer'

useGLTF.preload('/models/Window.glb')
