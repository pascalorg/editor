'use client'

import { type BoxNode, useRegistry, useScene } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

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
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  const geometry = useMemo(() => {
    const length = node.length ?? 1
    const height = node.height ?? 1
    const width = node.width ?? 1
    const maxRadius = Math.max(0, Math.min(length, height, width) / 2 - 0.001)
    const radius = Math.max(0, Math.min(node.cornerRadius ?? 0, maxRadius))

    if (radius <= 0) {
      return new THREE.BoxGeometry(length, height, width)
    }

    return new RoundedBoxGeometry(
      length,
      height,
      width,
      Math.max(1, Math.round(node.cornerSegments ?? 4)),
      radius,
    )
  }, [node.length, node.height, node.width, node.cornerRadius, node.cornerSegments])


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
      <mesh castShadow geometry={geometry} material={material} name="box-solid" receiveShadow />
    </group>
  )
}

export default BoxRenderer
