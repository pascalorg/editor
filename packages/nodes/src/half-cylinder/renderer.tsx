'use client'

import { type HalfCylinderNode, useRegistry, useScene } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function createHalfCylinderGeometry(
  radiusInput: number,
  heightInput: number,
  segmentsInput: number,
) {
  const radius = Math.max(0.01, radiusInput)
  const height = Math.max(0.01, heightInput)
  const segments = Math.max(3, Math.round(segmentsInput))
  const halfHeight = height / 2
  const vertices: number[] = []
  const indices: number[] = []

  const push = (x: number, y: number, z: number) => {
    vertices.push(x, y, z)
    return vertices.length / 3 - 1
  }

  const bottomArc: number[] = []
  const topArc: number[] = []
  for (let i = 0; i <= segments; i++) {
    const theta = (Math.PI * i) / segments
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    bottomArc.push(push(x, -halfHeight, z))
    topArc.push(push(x, halfHeight, z))
  }

  for (let i = 0; i < segments; i++) {
    const b0 = bottomArc[i]!
    const b1 = bottomArc[i + 1]!
    const t0 = topArc[i]!
    const t1 = topArc[i + 1]!
    indices.push(b0, b1, t1, b0, t1, t0)
  }

  const flatA = push(radius, -halfHeight, 0)
  const flatB = push(-radius, -halfHeight, 0)
  const flatC = push(-radius, halfHeight, 0)
  const flatD = push(radius, halfHeight, 0)
  indices.push(flatA, flatB, flatC, flatA, flatC, flatD)

  const bottomCenter = push(0, -halfHeight, 0)
  const topCenter = push(0, halfHeight, 0)
  for (let i = 0; i < segments; i++) {
    indices.push(bottomCenter, bottomArc[i + 1]!, bottomArc[i]!)
    indices.push(topCenter, topArc[i]!, topArc[i + 1]!)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

export const HalfCylinderRenderer = ({ node }: { node: HalfCylinderNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'half-cylinder', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'half-cylinder')

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
      createHalfCylinderGeometry(node.radius ?? 0.5, node.height ?? 1, node.radialSegments ?? 24),
    [node.radius, node.height, node.radialSegments],
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

export default HalfCylinderRenderer
