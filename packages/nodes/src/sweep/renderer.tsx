'use client'

import { type SweepNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { primitiveContractFromMetadata } from '../shared/primitive-contract-rendering'

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

function pathCenter(points: THREE.Vector3[]) {
  const box = new THREE.Box3().setFromPoints(points)
  const center = new THREE.Vector3()
  box.getCenter(center)
  return center
}

function rectangularDuctSegments(node: SweepNode) {
  const duct = primitiveContractFromMetadata(node.metadata)?.duct
  if (duct?.crossSection !== 'rectangular') return []
  const points = (
    node.path ?? [
      [-0.5, 0, 0],
      [0.5, 0, 0],
    ]
  ).map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const center = pathCenter(points)
  const width = Math.max(0.01, duct.width ?? node.radius * 2)
  const height = Math.max(0.01, duct.height ?? node.radius * 2)
  const segments: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion; length: number }> =
    []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end) continue
    const vector = end.clone().sub(start)
    const length = vector.length()
    if (length <= 0.001) continue
    const position = start.clone().add(end).multiplyScalar(0.5).sub(center)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      vector.normalize(),
    )
    segments.push({ position, quaternion, length })
  }
  return segments.map((segment) => ({ ...segment, width, height }))
}

export const SweepRenderer = ({ node }: { node: SweepNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'sweep', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'sweep')
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
  const ductSegments = useMemo(() => rectangularDuctSegments(node), [node])

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
      {ductSegments.length > 0 ? (
        ductSegments.map((segment, index) => (
          <mesh
            castShadow
            key={`${node.id}:duct:${index}`}
            material={material}
            name="rectangular-duct-segment"
            position={segment.position}
            quaternion={segment.quaternion}
            receiveShadow
          >
            <boxGeometry args={[segment.length, segment.height, segment.width]} />
          </mesh>
        ))
      ) : (
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          name="primitive-solid"
          receiveShadow
        />
      )}
    </group>
  )
}

export default SweepRenderer
