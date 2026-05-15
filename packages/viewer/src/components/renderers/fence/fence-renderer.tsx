import { type FenceNode, useRegistry, useScene } from '@pascal-app/core'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'

// Phase 5 verification log — see matching `[fence:registry]` log in
// nodes/src/fence/renderer.tsx. Fires once if the legacy path is active
// (flag off or kind not registered). Drop alongside the legacy file at
// Phase 6 cleanup.
let didLogFirstLegacyFenceMount = false

export const FenceRenderer = ({ node }: { node: FenceNode }) => {
  const ref = useRef<Mesh>(null!)
  const handlers = useNodeEvents(node, 'fence')
  const material = useMemo(() => DEFAULT_STAIR_MATERIAL, [])

  useRegistry(node.id, 'fence', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    if (didLogFirstLegacyFenceMount) return
    didLogFirstLegacyFenceMount = true
    console.info(
      '[fence:legacy] first legacy FenceRenderer mounted — registry-driven FenceRenderer is NOT in use',
    )
  }, [])

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
