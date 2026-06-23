'use client'

import { type RoundedPanelNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  ensureWebGPUCompatibleGeometry,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function createRoundedPanelGeometry(
  length: number,
  width: number,
  thickness: number,
  cornerRadius: number,
  cornerSegments: number,
) {
  const radius = Math.max(0, Math.min(cornerRadius, Math.min(length, width) / 2 - 0.001))
  if (radius <= 0) {
    return new THREE.BoxGeometry(length, thickness, width)
  }

  const halfLength = length / 2
  const halfWidth = width / 2
  const shape = new THREE.Shape()
  shape.moveTo(-halfLength + radius, -halfWidth)
  shape.lineTo(halfLength - radius, -halfWidth)
  shape.quadraticCurveTo(halfLength, -halfWidth, halfLength, -halfWidth + radius)
  shape.lineTo(halfLength, halfWidth - radius)
  shape.quadraticCurveTo(halfLength, halfWidth, halfLength - radius, halfWidth)
  shape.lineTo(-halfLength + radius, halfWidth)
  shape.quadraticCurveTo(-halfLength, halfWidth, -halfLength, halfWidth - radius)
  shape.lineTo(-halfLength, -halfWidth + radius)
  shape.quadraticCurveTo(-halfLength, -halfWidth, -halfLength + radius, -halfWidth)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: Math.max(1, Math.round(cornerSegments)),
    depth: thickness,
  })
  geometry.translate(0, 0, -thickness / 2)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

export const RoundedPanelRenderer = ({ node }: { node: RoundedPanelNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'rounded-panel', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'rounded-panel')
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
    const length = node.length ?? 1
    const width = node.width ?? 0.5
    const thickness = node.thickness ?? 0.04
    return ensureWebGPUCompatibleGeometry(
      createRoundedPanelGeometry(
        length,
        width,
        thickness,
        node.cornerRadius ?? 0.04,
        node.cornerSegments ?? 4,
      ),
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
