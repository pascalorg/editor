'use client'

import { type TrapezoidPrismNode, useRegistry, useScene } from '@pascal-app/core'
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

function createTrapezoidPrismGeometry(
  lengthInput: number | undefined,
  widthInput: number | undefined,
  heightInput: number | undefined,
  topLengthScaleInput: number | undefined,
  topWidthScaleInput: number | undefined,
) {
  const hx = Math.max(0.01, lengthInput ?? 1) / 2
  const hz = Math.max(0.01, widthInput ?? 1) / 2
  const hy = Math.max(0.01, heightInput ?? 0.5) / 2
  const tx = hx * Math.max(0.01, topLengthScaleInput ?? 0.7)
  const tz = hz * Math.max(0.01, topWidthScaleInput ?? 0.7)
  const vertices = new Float32Array([
    -hx,
    -hy,
    -hz,
    hx,
    -hy,
    -hz,
    hx,
    -hy,
    hz,
    -hx,
    -hy,
    hz,
    -tx,
    hy,
    -tz,
    tx,
    hy,
    -tz,
    tx,
    hy,
    tz,
    -tx,
    hy,
    tz,
  ])
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2,
    6, 1, 6, 5,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return ensureWebGPUCompatibleGeometry(geometry)
}

export const TrapezoidPrismRenderer = ({ node }: { node: TrapezoidPrismNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'trapezoid-prism', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'trapezoid-prism')
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
      createTrapezoidPrismGeometry(
        node.length,
        node.width,
        node.height,
        node.topLengthScale,
        node.topWidthScale,
      ),
    [node.length, node.width, node.height, node.topLengthScale, node.topWidthScale],
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

export default TrapezoidPrismRenderer
