'use client'

import { useLiveTransforms, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import type { ShelfNode } from './schema'

/**
 * Thin shelf renderer. Mounts an empty `<group>`, registers it with
 * `sceneRegistry`, and marks the node dirty so `ShelfSystem` populates it
 * with geometry on the next frame.
 *
 * Mirrors the door/item pattern (see `wiki/architecture/renderers.md`):
 * "Renderers must not run geometry generation logic (that belongs in a
 * System)." Keeping the renderer tiny means parametric edits don't re-run
 * any React work — only the system's `useFrame` rebuilds the meshes.
 */
const ShelfRenderer = ({ node }: { node: ShelfNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'shelf')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))

  useRegistry(node.id, 'shelf', ref)

  // Mark dirty on mount and whenever the node identity changes so the system
  // builds (or rebuilds) geometry. Subsequent parametric edits set dirty via
  // the store's updateNode → dirtyNodes wiring.
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={liveTransform?.rotation ? [0, liveTransform.rotation, 0] : node.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}

export default ShelfRenderer
