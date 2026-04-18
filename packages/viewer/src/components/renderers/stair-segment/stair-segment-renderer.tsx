import { type AnyNodeId, type StairNode, type StairSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef, DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'

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
    const effectiveMaterialPreset = node.materialPreset ?? parentNode?.materialPreset
    const effectiveMaterial = node.material ?? parentNode?.material

    const presetMaterial = createMaterialFromPresetRef(effectiveMaterialPreset)
    if (presetMaterial) return presetMaterial
    const mat = effectiveMaterial
    if (!mat) return DEFAULT_STAIR_MATERIAL
    return createMaterial(mat)
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
  ])

  return (
    <mesh
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      {/* StairSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
