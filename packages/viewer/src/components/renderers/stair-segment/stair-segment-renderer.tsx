import { type StairSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_STAIR_MATERIAL
    return createMaterial(mat)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

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
