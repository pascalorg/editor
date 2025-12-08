'use client'

import { Clone, Gltf, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import * as THREE from 'three'
import type { GLTF } from 'three-stdlib'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import { getMaterial, useMaterial } from '@/lib/materials'
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
    modelPosition,
    nodeSrc,
    modelScale,
    modelRotation,
    deletePreview,
  } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as ItemNode | undefined
      return {
        nodeSize: node?.size,
        deletePreview: node?.editor?.deletePreview === true,
        isPreview: node?.editor?.preview === true,
        levelId: state.graph.index.byId.get(nodeId)?.levelId,
        canPlace: node?.editor?.canPlace !== false,
        modelPosition: node?.modelPosition,
        modelRotation: node?.modelRotation,
        nodeCategory: node?.category,
        modelScale: node?.modelScale,
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
        0.1,
        (nodeSize?.[1] ?? 0) * TILE_SIZE,
      ),
    [nodeSize],
  )

  // Determine color based on preview state and placement validity
  const color = useMemo(() => {
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
  }, [isPreview, canPlace, nodeCategory])

  return (
    <>
      {isPreview && (
        // Preview rendering with X-ray effect
        <group>
          {/* Visible/in-front version - brighter, normal depth testing */}
          <mesh geometry={boxGeometry} position-y={0} renderOrder={2}>
            <meshStandardMaterial color={color} depthWrite={false} opacity={0.3} transparent />
          </mesh>
        </group>
      )}

      <ErrorBoundary fallback={null}>
        <Suspense
          fallback={
            <mesh geometry={boxGeometry} position-y={0.4}>
              <meshStandardMaterial color={color} opacity={opacity} transparent={transparent} />
            </mesh>
          }
        >
          {nodeSrc && (
            <ModelItemRenderer
              deletePreview={deletePreview}
              isActiveFloor={isActiveFloor}
              position={modelPosition || [0, 0, 0]}
              rotation={modelRotation}
              scale={modelScale || [1, 1, 1]}
              src={nodeSrc}
            />
          )}
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

type GLTFResult = GLTF & {
  nodes: {
    cutout?: THREE.Mesh
  }
}

const ModelItemRenderer = ({
  position,
  rotation,
  scale,
  src,
  deletePreview,
  isActiveFloor,
}: {
  position?: ItemNode['modelPosition']
  rotation?: ItemNode['modelRotation']
  scale?: ItemNode['modelScale']
  src: ItemNode['src']
  deletePreview?: boolean
  isActiveFloor: boolean
}) => {
  const { scene } = useGLTF(src)
  const ref = useRef<THREE.Group>(null)

  const deleteMaterial = useMaterial('delete')
  const ghostMaterial = useMaterial('ghost')

  useEffect(() => {
    ref.current?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (
          child.material instanceof THREE.Material &&
          child.material.name.toLowerCase().includes('glass')
        ) {
          child.material = getMaterial('glass')
          child.castShadow = false
          child.receiveShadow = false
        } else {
          if (
            child.material instanceof THREE.Material &&
            child.material.name.toLowerCase().includes('color_')
          ) {
            const material = getMaterial(child.material.name.toLowerCase().replace('color_', ''))
            if (material) {
              child.material = material
            }
          }
          child.castShadow = true
          child.receiveShadow = true
        }
      }
      if (child.name === 'cutout') {
        child.visible = false
      }
    })
  }, [])

  return (
    <>
      <Clone
        inject={
          deletePreview ? (
            <primitive attach="material" object={deleteMaterial} />
          ) : isActiveFloor ? undefined : (
            <primitive attach="material" object={ghostMaterial} />
          )
        }
        object={scene}
        position={position}
        ref={ref}
        rotation={rotation}
        scale={scale}
      />
    </>
  )
}
