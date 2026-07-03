'use client'

import { type ExtrudeNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import useViewer from '@pascal-app/viewer/store'
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

export const ExtrudeRenderer = ({ node }: { node: ExtrudeNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'extrude', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'extrude')
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
    const profile = node.profile ?? [
      [-0.5, -0.25],
      [0.5, -0.25],
      [0.5, 0.25],
      [-0.5, 0.25],
    ]
    const first = profile[0] ?? [-0.5, -0.25]
    const shape = new THREE.Shape()
    shape.moveTo(first[0], first[1])
    for (const [x, y] of profile.slice(1)) shape.lineTo(x, y)
    shape.closePath()
    for (const hole of node.holes ?? []) {
      const holeFirst = hole[0]
      if (!holeFirst) continue
      const path = new THREE.Path()
      path.moveTo(holeFirst[0], holeFirst[1])
      for (const [x, y] of hole.slice(1)) path.lineTo(x, y)
      path.closePath()
      shape.holes.push(path)
    }

    const bevelSize = node.bevelSize ?? 0.01
    const bevelThickness = node.bevelThickness ?? bevelSize
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: node.depth ?? 0.1,
      bevelEnabled: bevelSize > 0 || bevelThickness > 0,
      bevelSize,
      bevelThickness,
      bevelSegments: node.bevelSegments ?? 2,
      curveSegments: node.curveSegments ?? 8,
    })
    centerGeometry(geo)
    return geo
  }, [
    node.profile,
    node.holes,
    node.depth,
    node.bevelSize,
    node.bevelThickness,
    node.bevelSegments,
    node.curveSegments,
  ])

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

export default ExtrudeRenderer
