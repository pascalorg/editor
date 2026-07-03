'use client'

import { type CapsuleNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import useViewer from '@pascal-app/viewer/store'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const CapsuleRenderer = ({ node }: { node: CapsuleNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'capsule', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'capsule')
  const shading = useViewer((state) => state.shading)

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset, shading)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return createDefaultMaterial('#cccccc', 1, shading)
    return createMaterial(mat, shading)
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    shading,
  ])

  const geometry = useMemo(() => {
    const radius = Math.max(0.01, node.radius ?? 0.25)
    const totalHeight = Math.max(radius * 2 + 0.001, node.height ?? 1)
    const cylinderHeight = Math.max(0.001, totalHeight - radius * 2)
    return new THREE.CapsuleGeometry(
      radius,
      cylinderHeight,
      node.capSegments ?? 6,
      node.radialSegments ?? 32,
    )
  }, [node.radius, node.height, node.capSegments, node.radialSegments])

  return (
    <group
      position-x={node.position[0]}
      position-y={node.position[1]}
      position-z={node.position[2]}
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        castShadow
        geometry={geometry}
        material={material}
        name="primitive-solid"
        receiveShadow
      />
    </group>
  )
}

export default CapsuleRenderer
