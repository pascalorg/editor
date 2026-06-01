'use client'

import { type TorusNode, useRegistry, useScene } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const TorusRenderer = ({ node }: { node: TorusNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'torus', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'torus')

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return new THREE.MeshStandardMaterial({ color: 0xcccccc })
    return createMaterial(mat)
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  const geometry = useMemo(
    () =>
      new THREE.TorusGeometry(
        node.majorRadius ?? 0.5,
        node.tubeRadius ?? 0.08,
        node.radialSegments ?? 16,
        node.tubularSegments ?? 48,
        node.arc ?? Math.PI * 2,
      ),
    [node.majorRadius, node.tubeRadius, node.radialSegments, node.tubularSegments, node.arc],
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
        name="primitive-solid"
        receiveShadow
      />
    </group>
  )
}

export default TorusRenderer
