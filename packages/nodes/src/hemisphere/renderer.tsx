'use client'

import { type HemisphereNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function createHemisphereGeometry(
  radiusInput: number,
  scale: readonly [number, number, number],
  widthSegmentsInput: number,
  heightSegmentsInput: number,
) {
  const radius = Math.max(0.01, radiusInput)
  const widthSegments = Math.max(8, Math.round(widthSegmentsInput))
  const heightSegments = Math.max(4, Math.round(heightSegmentsInput))
  const [sx, sy, sz] = scale
  const geometry = new THREE.SphereGeometry(
    radius,
    widthSegments,
    heightSegments,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  )
  geometry.scale(sx, sy, sz)
  geometry.translate(0, -(radius * sy) / 2, 0)
  return geometry
}

function createHemisphereBaseGeometry(
  radiusInput: number,
  scale: readonly [number, number, number],
  segmentsInput: number,
) {
  const radius = Math.max(0.01, radiusInput)
  const segments = Math.max(8, Math.round(segmentsInput))
  const [sx, sy, sz] = scale
  const geometry = new THREE.CircleGeometry(radius, segments)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(sx, 1, sz)
  geometry.translate(0, -(radius * sy) / 2, 0)
  return geometry
}

export const HemisphereRenderer = ({ node }: { node: HemisphereNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'hemisphere', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'hemisphere')
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

  const domeGeometry = useMemo(
    () =>
      createHemisphereGeometry(
        node.radius ?? 0.5,
        node.scale,
        node.widthSegments ?? 32,
        node.heightSegments ?? 16,
      ),
    [node.radius, node.scale, node.widthSegments, node.heightSegments],
  )
  const baseGeometry = useMemo(
    () => createHemisphereBaseGeometry(node.radius ?? 0.5, node.scale, node.widthSegments ?? 32),
    [node.radius, node.scale, node.widthSegments],
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
        geometry={domeGeometry}
        material={material}
        name="hemisphere-dome"
        receiveShadow
      />
      <mesh
        castShadow
        geometry={baseGeometry}
        material={material}
        name="hemisphere-base"
        receiveShadow
      />
    </group>
  )
}

export default HemisphereRenderer
