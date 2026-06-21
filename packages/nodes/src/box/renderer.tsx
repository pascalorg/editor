'use client'

import { type BoxNode, type PrimitiveCutoutInput, useRegistry, useScene } from '@pascal-app/core'
import {
  Brush,
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  csgEvaluator,
  csgGeometry,
  ensureRenderableGeometryAttributes,
  prepareBrushForCSG,
  SUBTRACTION,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  applyInstanceMatrices,
  primitiveContractFromMetadata,
  primitivePatternInstances,
} from '../shared/primitive-contract-rendering'

type BoxCutout = PrimitiveCutoutInput

function cutoutAxis(cutout: BoxCutout): 'x' | 'y' | 'z' {
  if (cutout.axis === 'x' || cutout.axis === 'y' || cutout.axis === 'z') return cutout.axis
  const normal = cutout.normal
  if (!normal) return 'z'
  const x = Math.abs(normal[0] ?? 0)
  const y = Math.abs(normal[1] ?? 0)
  const z = Math.abs(normal[2] ?? 0)
  if (x >= y && x >= z) return 'x'
  if (y >= x && y >= z) return 'y'
  return 'z'
}

function cutoutPosition(cutout: BoxCutout) {
  const [x = 0, y = 0, z = 0] = cutout.position ?? [0, 0, 0]
  return new THREE.Vector3(x, y, z)
}

function createCutoutBrush(cutout: BoxCutout, node: BoxNode) {
  const axis = cutoutAxis(cutout)
  const length = Math.max(0.01, cutout.length ?? (cutout.radius ?? 0.08) * 2)
  const height = Math.max(0.01, cutout.height ?? cutout.width ?? (cutout.radius ?? 0.08) * 2)
  const throughDepth =
    axis === 'x' ? node.length + 0.08 : axis === 'y' ? node.height + 0.08 : node.width + 0.08
  const depth = Math.max(cutout.depth ?? 0, throughDepth)
  let geometry: THREE.BufferGeometry

  if (cutout.kind === 'round' && cutout.radius != null) {
    geometry = new THREE.CylinderGeometry(cutout.radius, cutout.radius, depth, 32)
    if (axis === 'x') geometry.rotateZ(Math.PI / 2)
    if (axis === 'z') geometry.rotateX(Math.PI / 2)
  } else {
    const size =
      axis === 'x'
        ? [depth, height, length]
        : axis === 'y'
          ? [length, depth, height]
          : [length, height, depth]
    geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  }

  const brush = new Brush(geometry)
  brush.position.copy(cutoutPosition(cutout))
  prepareBrushForCSG(brush)
  return brush
}

function shouldSubtractCutout(cutout: BoxCutout, node: BoxNode) {
  if (cutout.through === true) return true
  const axis = cutoutAxis(cutout)
  const bodyDepth = axis === 'x' ? node.length : axis === 'y' ? node.height : node.width
  return (cutout.depth ?? 0) >= bodyDepth * 0.8
}

function applyBoxCutouts(baseGeometry: THREE.BufferGeometry, node: BoxNode) {
  const cutouts = primitiveContractFromMetadata(node.metadata)?.cutouts?.filter((cutout) =>
    shouldSubtractCutout(cutout, node),
  )
  if (!cutouts?.length) return baseGeometry

  const baseBrush = new Brush(baseGeometry)
  prepareBrushForCSG(baseBrush)
  let resultBrush = baseBrush
  const cutoutBrushes = cutouts.map((cutout) => createCutoutBrush(cutout, node))

  for (const cutoutBrush of cutoutBrushes) {
    const next = csgEvaluator.evaluate(resultBrush, cutoutBrush, SUBTRACTION)
    if (resultBrush !== baseBrush) csgGeometry(resultBrush).dispose()
    resultBrush = next
  }

  const resultGeometry = ensureRenderableGeometryAttributes(csgGeometry(resultBrush).clone())
  resultGeometry.computeVertexNormals()
  csgGeometry(baseBrush).dispose()
  for (const cutoutBrush of cutoutBrushes) csgGeometry(cutoutBrush).dispose()
  if (resultBrush !== baseBrush) csgGeometry(resultBrush).dispose()
  return resultGeometry
}

export const BoxRenderer = ({ node }: { node: BoxNode }) => {
  const ref = useRef<THREE.Group>(null!)
  const instancedRef = useRef<THREE.InstancedMesh>(null)

  useRegistry(node.id, 'box', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'box')
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
    const height = node.height ?? 1
    const width = node.width ?? 1
    const maxRadius = Math.max(0, Math.min(length, height, width) / 2 - 0.001)
    const radius = Math.max(0, Math.min(node.cornerRadius ?? 0, maxRadius))

    const baseGeometry =
      radius <= 0
        ? new THREE.BoxGeometry(length, height, width)
        : new RoundedBoxGeometry(
            length,
            height,
            width,
            Math.max(1, Math.round(node.cornerSegments ?? 4)),
            radius,
          )

    return applyBoxCutouts(baseGeometry, node)
  }, [node])

  const instances = primitivePatternInstances(node.metadata)

  useLayoutEffect(() => {
    applyInstanceMatrices(instancedRef.current, instances)
  }, [instances])

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
      {instances.length > 1 ? (
        <instancedMesh
          args={[geometry, material, instances.length]}
          castShadow
          name="box-solid-instances"
          receiveShadow
          ref={instancedRef}
        />
      ) : (
        <mesh castShadow geometry={geometry} material={material} name="box-solid" receiveShadow />
      )}
    </group>
  )
}

export default BoxRenderer
