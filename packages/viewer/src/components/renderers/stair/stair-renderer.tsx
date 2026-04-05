import { type StairNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'
import { NodeRenderer } from '../node-renderer'

export const StairRenderer = ({ node }: { node: StairNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'stair', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair')

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_STAIR_MATERIAL
    return createMaterial(mat)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  return (
    <group
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh castShadow material={material} name="merged-stair" receiveShadow>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}
