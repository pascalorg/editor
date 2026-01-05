'use client'

import type { ItemNode } from '@pascal/core'
import {
  getMaterial,
  getMaterialPreset,
  type MaterialName,
  useMaterial,
} from '@pascal/core/materials'
import { Clone, Gltf, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import * as THREE from 'three'
import type { GLTF } from 'three-stdlib'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '../../../constants'
import { useEditor } from '../../../hooks'

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
        0.05,
        (nodeSize?.[1] ?? 0) * TILE_SIZE,
      ),
    [nodeSize],
  )

  const previewMaterial = useMaterial(canPlace ? 'preview-valid' : 'preview-invalid')
  const ghostMaterial = useMaterial('ghost')
  const triangleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3((-TILE_SIZE / 2) * 0.95, 0, (TILE_SIZE / 2) * 0.95),
      new THREE.Vector3((TILE_SIZE / 2) * 0.95, 0, (TILE_SIZE / 2) * 0.95),
      new THREE.Vector3(0, 0, (-TILE_SIZE / 2) * 0.95),
    ])
    geometry.setIndex([0, 1, 2])
    geometry.computeVertexNormals()
    return geometry
  }, [])

  return (
    <>
      {isPreview && (
        // Preview rendering with X-ray effect
        <group>
          <group position-x={(-(nodeSize?.[0] || 1) * TILE_SIZE) / 2}>
            {[...new Array(nodeSize?.[0] || 1).keys()].map((x) => (
              <mesh
                frustumCulled={false}
                geometry={triangleGeometry}
                key={`triangle-${x}`}
                material={previewMaterial}
                position-x={(x + 0.5) * TILE_SIZE}
                position-y={0.05}
                position-z={((nodeSize?.[1] || 1) * TILE_SIZE) / 2 + TILE_SIZE}
                rotation-y={Math.PI}
              />
            ))}
          </group>
          <mesh
            frustumCulled={false}
            geometry={boxGeometry}
            material={previewMaterial}
            position-y={0}
          />
        </group>
      )}

      <ErrorBoundary fallback={null}>
        <Suspense fallback={<LoadingItem />}>
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

function LoadingItem() {
  const previewMaterial = useMaterial('preview-valid')
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 2
    }
  })
  return (
    <group ref={group}>
      <mesh material={previewMaterial} position-y={0.5} scale-y={1.5}>
        <octahedronGeometry args={[TILE_SIZE / 1.5, 0]} />
      </mesh>
    </group>
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
  const baseURL = useEditor((state) => state.baseURL)
  const { scene } = useGLTF(`${baseURL}${src}`)
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
            const materialName = child.material.name
              .toLowerCase()
              .replace('color_', '') as MaterialName
            const materialPreset = getMaterialPreset(materialName)
            if (materialPreset) {
              const material = getMaterial(materialName)
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
            deleteMaterial ? (
              <primitive attach="material" object={deleteMaterial} />
            ) : undefined
          ) : isActiveFloor ? undefined : ghostMaterial ? (
            <primitive attach="material" object={ghostMaterial} />
          ) : undefined
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
