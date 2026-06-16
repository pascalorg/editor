'use client'

import { type LatheNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const LatheRenderer = ({ node }: { node: LatheNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'lathe', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'lathe')
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
    const points = (
      node.profile ?? [
        [0, 0],
        [0.5, 1],
      ]
    ).map(([x, y]) => new THREE.Vector2(x, y))
    const arc = node.arc ?? Math.PI * 2
    const geo = new THREE.LatheGeometry(points, node.segments ?? 32, 0, arc)

    // Center geometry vertically so group position is the bounding-box center
    let minY = Infinity
    let maxY = -Infinity
    for (const [_, y] of node.profile ?? [
      [0, 0],
      [0.5, 1],
    ]) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const centerY = (minY + maxY) / 2
    if (Math.abs(centerY) > 0.0001) {
      geo.translate(0, -centerY, 0)
    }

    return geo
  }, [node.profile, node.segments, node.arc])

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
      <mesh castShadow geometry={geometry} material={material} name="lathe-solid" receiveShadow />
    </group>
  )
}

export default LatheRenderer
