import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useLayoutEffect, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'wall', ref)

  // Mark dirty on mount so WallSystem rebuilds geometry when wall (re)appears
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'wall')

  return (
    <mesh castShadow receiveShadow ref={ref} visible={node.visible}>
      {/* WallSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      {/* Collision mesh: full-wall geometry (no cutouts) for pointer events */}
      <mesh name="collision-mesh" visible={false} {...handlers}>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>

      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
