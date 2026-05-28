'use client'

import { type SphereNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const SphereRenderer = ({ node }: { node: SphereNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'sphere', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'sphere')

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return new THREE.MeshStandardMaterial({ color: 0xcccccc })
    return createMaterial(mat)
  }, [node.materialPreset, node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  const geometry = useMemo(
    () => {
      const geo = new THREE.SphereGeometry(
        node.radius ?? 0.5,
        node.widthSegments ?? 32,
        node.heightSegments ?? 32,
      )
      const [sx, sy, sz] = node.scale
      if (sx !== 1 || sy !== 1 || sz !== 1) {
        geo.scale(sx, sy, sz)
      }
      return geo
    },
    [node.radius, node.widthSegments, node.heightSegments, node.scale[0], node.scale[1], node.scale[2]],
  )


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
        name="sphere-solid"
        receiveShadow
      />
    </group>
  )
}

export default SphereRenderer
