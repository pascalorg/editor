import { type FenceNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'

export const FenceRenderer = ({ node }: { node: FenceNode }) => {
  const ref = useRef<Mesh>(null!)
  const handlers = useNodeEvents(node, 'fence')
  const material = useMemo(() => DEFAULT_STAIR_MATERIAL, [])

  useRegistry(node.id, 'fence', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  return (
    <mesh castShadow material={material} receiveShadow ref={ref} visible={node.visible} {...handlers}>
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
