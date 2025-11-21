'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { is } from 'zod/v4/locales'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { WindowNode } from '@/lib/scenegraph/schema/index'

interface WindowRendererProps {
  nodeId: WindowNode['id']
}

export const WindowRenderer = memo(({ nodeId }: WindowRendererProps) => {
  const windowRef = useRef<THREE.Group>(null)

  const { isPreview, selectedFloorId, canPlace, levelId } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as WindowNode | undefined
      return {
        selectedFloorId: state.selectedFloorId,
        isPreview: node?.editor?.preview === true,
        canPlace: node?.editor?.canPlace !== false,
        levelId: state.getLevelId(nodeId),
      }
    }),
  )

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
