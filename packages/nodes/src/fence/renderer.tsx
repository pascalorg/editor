'use client'

import { type FenceNode, useRegistry, useScene } from '@pascal-app/core'
import { DEFAULT_STAIR_MATERIAL, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'

/**
 * Thin fence renderer — registers an empty mesh, marks the node dirty so
 * `FenceSystem` (re-exported via `./system`) fills the geometry next
 * frame, and wires pointer events through `useNodeEvents`.
 *
 * Behaviorally identical to the legacy `FenceRenderer` in
 * `@pascal-app/viewer/components/renderers/fence/fence-renderer.tsx`.
 * Phase 0 shims pick which one mounts based on `nodeRegistry.has('fence')`.
 *
 * Material is `DEFAULT_STAIR_MATERIAL` (legacy reuse; fence and stairs
 * share the wood-tone preset).
 */
const FenceRenderer = ({ node }: { node: FenceNode }) => {
  const ref = useRef<Mesh>(null!)
  const handlers = useNodeEvents(node, 'fence')
  const material = useMemo(() => DEFAULT_STAIR_MATERIAL, [])

  useRegistry(node.id, 'fence', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  return (
    <mesh
      castShadow
      material={material}
      receiveShadow
      ref={ref}
      visible={node.visible}
      {...handlers}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}

export default FenceRenderer
