'use client'

import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createSafeEmptyGeometry,
  getStraightStairSegmentBodyMaterials,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as StairNode | undefined)
    : undefined

  const material = useMemo(() => {
    return getStraightStairSegmentBodyMaterials(node, parentNode)
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    parentNode?.materialPreset,
    parentNode?.material,
    parentNode?.material?.preset,
    parentNode?.material?.properties,
    parentNode?.material?.texture,
    parentNode?.railingMaterialPreset,
    parentNode?.railingMaterial,
    parentNode?.sideMaterialPreset,
    parentNode?.sideMaterial,
    parentNode?.treadMaterialPreset,
    parentNode?.treadMaterial,
    node,
    parentNode,
  ])

  const placeholderGeometry = useMemo(() => {
    const geometry = createSafeEmptyGeometry()
    geometry.clearGroups()
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    return geometry
  }, [])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <mesh
      geometry={placeholderGeometry}
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}

export default StairSegmentRenderer
