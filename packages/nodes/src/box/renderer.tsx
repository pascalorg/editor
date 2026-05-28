'use client'

import { type BoxNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const BoxRenderer = ({ node }: { node: BoxNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'box', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'box')

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return new THREE.MeshStandardMaterial({ color: 0xcccccc })
    return createMaterial(mat)
  }, [node.materialPreset, node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  const geometry = useMemo(
    () => new THREE.BoxGeometry(node.length ?? 1, node.height ?? 1, node.width ?? 1),
    [node.length, node.height, node.width],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

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
        name="box-solid"
        receiveShadow
      />
    </group>
  )
}

export default BoxRenderer
