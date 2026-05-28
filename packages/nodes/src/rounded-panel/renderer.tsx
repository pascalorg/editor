'use client'

import { type RoundedPanelNode, useRegistry, useScene } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export const RoundedPanelRenderer = ({ node }: { node: RoundedPanelNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'rounded-panel', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'rounded-panel')

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

  const geometry = useMemo(() => {
    const length = node.length ?? 1
    const width = node.width ?? 0.5
    const thickness = node.thickness ?? 0.04
    const maxRadius = Math.max(0, Math.min(length, width, thickness) / 2 - 0.001)
    const radius = Math.max(0, Math.min(node.cornerRadius ?? 0.04, maxRadius))

    if (radius <= 0) {
      return new THREE.BoxGeometry(length, thickness, width)
    }

    return new RoundedBoxGeometry(
      length,
      thickness,
      width,
      Math.max(1, Math.round(node.cornerSegments ?? 4)),
      radius,
    )
  }, [node.length, node.width, node.thickness, node.cornerRadius, node.cornerSegments])


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

export default RoundedPanelRenderer
