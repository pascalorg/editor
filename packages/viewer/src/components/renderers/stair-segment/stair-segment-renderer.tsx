import { type AnyNodeId, type StairNode, type StairSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { getStraightStairSegmentBodyMaterials } from '../../../systems/stair/stair-materials'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')
  const parentNode =
    node.parentId ? (nodes[node.parentId as AnyNodeId] as StairNode | undefined) : undefined

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
  ])

  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
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
