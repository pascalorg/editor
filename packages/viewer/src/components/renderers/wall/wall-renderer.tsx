import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_WALL_MATERIAL } from '../../../lib/materials'
import { NodeRenderer } from '../node-renderer'

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'wall')

  const material = useMemo(() => {
    return node.material ? createMaterial(node.material) : DEFAULT_WALL_MATERIAL
  }, [node.material])

  return (
    <mesh castShadow receiveShadow ref={ref} visible={node.visible} material={material}>
      <boxGeometry args={[0, 0, 0]} />
      <mesh name="collision-mesh" visible={false} {...handlers}>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>

      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
