'use client'

import { type SweepNode, useRegistry, useScene } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function centerGeometry(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox()
  const box = geo.boundingBox
  if (!box) return
  const center = new THREE.Vector3()
  box.getCenter(center)
  geo.translate(-center.x, -center.y, -center.z)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
}

export const SweepRenderer = ({ node }: { node: SweepNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'sweep', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'sweep')

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
    const points = (
      node.path ?? [
        [-0.5, 0, 0],
        [0.5, 0, 0],
      ]
    ).map(([x, y, z]) => new THREE.Vector3(x, y, z))
    const curve = new THREE.CatmullRomCurve3(points, node.closed ?? false)
    const geo = new THREE.TubeGeometry(
      curve,
      node.tubularSegments ?? 24,
      node.radius ?? 0.03,
      node.radialSegments ?? 12,
      node.closed ?? false,
    )
    centerGeometry(geo)
    return geo
  }, [node.path, node.radius, node.tubularSegments, node.radialSegments, node.closed])


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

export default SweepRenderer
