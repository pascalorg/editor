'use client'

import { useLiveNodeOverrides, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { LUMBER_COLOR, lumberBoxDims } from './lumber'
import type { LumberNode } from './schema'

/**
 * Per-node parametric renderer for a loose lumber member: one box at actual
 * dressed dimensions, wood-toned. Registered via `useRegistry` so the host's
 * selection / outline / floor-elevation machinery works unchanged.
 */
export const LumberRenderer = ({ node: rawNode }: { node: LumberNode }) => {
  const ref = useRef<Group>(null!)
  // Merge any live drag override so inspector arrows update the mesh on every
  // pointer move, with zustand only hearing the commit on release.
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<LumberNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as LumberNode) : rawNode),
    [rawNode, liveOverride],
  )
  const handlers = useNodeEvents(node as never, node.type as never)
  const liveTransform = useLiveTransforms((state) => state.get(node.id))

  useRegistry(node.id, node.type, ref)

  const dims = lumberBoxDims(node.size, node.length, node.orientation)
  const [rx, ry, rz] = node.rotation

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={[rx, liveTransform?.rotation ?? ry, rz]}
      visible={node.visible}
      {...handlers}
    >
      {/* Base sits at y=0; the box is centered, so lift by half its height. */}
      <mesh castShadow position={[0, dims[1] / 2, 0]} receiveShadow>
        <boxGeometry args={dims} />
        <meshStandardMaterial color={LUMBER_COLOR} roughness={0.85} />
      </mesh>
    </group>
  )
}

export default LumberRenderer
