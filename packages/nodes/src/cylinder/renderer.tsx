'use client'

import { type CylinderNode, useRegistry, useScene } from '@pascal-app/core'
import { createCylinderGeometry } from '@pascal-app/viewer/create-cylinder-geometry'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { ensureWebGPUCompatibleGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer from '@pascal-app/viewer/store'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import {
  applyInstanceMatrices,
  primitivePatternInstances,
} from '../shared/primitive-contract-rendering'

export const CylinderRenderer = ({ node }: { node: CylinderNode }) => {
  const ref = useRef<THREE.Group>(null!)
  const instancedRef = useRef<THREE.InstancedMesh>(null)

  useRegistry(node.id, 'cylinder', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'cylinder')
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
      ensureWebGPUCompatibleGeometry(
        createCylinderGeometry({
          radius: node.radius ?? 0.5,
          height: node.height ?? 1.0,
          radialSegments: node.radialSegments ?? 32,
          wallThickness: node.wallThickness,
        }),
      ),
    [node.radius, node.height, node.radialSegments, node.wallThickness],
  )
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
          name="cylinder-solid-instances"
          receiveShadow
          ref={instancedRef}
        />
      ) : (
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          name="cylinder-solid"
          receiveShadow
        />
      )}
    </group>
  )
}

export default CylinderRenderer
