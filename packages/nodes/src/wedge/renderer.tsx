'use client'

import { useRegistry, useScene, type WedgeNode } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { ensureWebGPUCompatibleGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer from '@pascal-app/viewer/store'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function createWedgeGeometry(
  lengthInput: number | undefined,
  widthInput: number | undefined,
  heightInput: number | undefined,
  slopeAxis: WedgeNode['slopeAxis'],
  slopeDirection: WedgeNode['slopeDirection'],
) {
  const hx = Math.max(0.01, lengthInput ?? 1) / 2
  const hz = Math.max(0.01, widthInput ?? 1) / 2
  const hy = Math.max(0.01, heightInput ?? 0.5) / 2
  const direction = slopeDirection === 'negative' ? -1 : 1
  const vertices: number[] = []
  const push = (x: number, y: number, z: number) => {
    vertices.push(x, y, z)
    return vertices.length / 3 - 1
  }
  let indices: number[]

  if (slopeAxis === 'x') {
    const lowX = -direction * hx
    const highX = direction * hx
    const lb = push(lowX, -hy, -hz)
    const lf = push(lowX, -hy, hz)
    const hb = push(highX, -hy, -hz)
    const hf = push(highX, -hy, hz)
    const hbt = push(highX, hy, -hz)
    const hft = push(highX, hy, hz)
    indices = [
      lb,
      hb,
      hf,
      lb,
      hf,
      lf,
      hb,
      hbt,
      hft,
      hb,
      hft,
      hf,
      lb,
      hbt,
      hb,
      lf,
      hf,
      hft,
      lb,
      lf,
      hft,
      lb,
      hft,
      hbt,
    ]
  } else {
    const lowZ = -direction * hz
    const highZ = direction * hz
    const ll = push(-hx, -hy, lowZ)
    const lr = push(hx, -hy, lowZ)
    const hl = push(-hx, -hy, highZ)
    const hr = push(hx, -hy, highZ)
    const hlt = push(-hx, hy, highZ)
    const hrt = push(hx, hy, highZ)
    indices = [
      ll,
      hr,
      lr,
      ll,
      hl,
      hr,
      hl,
      hlt,
      hrt,
      hl,
      hrt,
      hr,
      ll,
      lr,
      hrt,
      ll,
      hrt,
      hlt,
      ll,
      hlt,
      hl,
      lr,
      hr,
      hrt,
    ]
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return ensureWebGPUCompatibleGeometry(geometry)
}

export const WedgeRenderer = ({ node }: { node: WedgeNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'wedge', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'wedge')
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

  const geometry = useMemo(
    () =>
      createWedgeGeometry(
        node.length,
        node.width,
        node.height,
        node.slopeAxis,
        node.slopeDirection,
      ),
    [node.length, node.width, node.height, node.slopeAxis, node.slopeDirection],
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

export default WedgeRenderer
