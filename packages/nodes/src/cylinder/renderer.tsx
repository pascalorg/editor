'use client'

import { type CylinderNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createCylinderGeometry,
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const CylinderRenderer = ({ node }: { node: CylinderNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'cylinder', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'cylinder')

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return new THREE.MeshStandardMaterial({ color: 0xcccccc })
    return createMaterial(mat)
  }, [node.materialPreset, node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  const geometry = useMemo(
    () => createCylinderGeometry({
      radius: node.radius ?? 0.5,
      height: node.height ?? 1.0,
      radialSegments: node.radialSegments ?? 32,
      wallThickness: node.wallThickness,
    }),
    [node.radius, node.height, node.radialSegments, node.wallThickness],
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
        name="cylinder-solid"
        receiveShadow
      />
    </group>
  )
}

export default CylinderRenderer
