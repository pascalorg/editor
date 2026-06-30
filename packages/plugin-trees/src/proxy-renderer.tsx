'use client'

import { type AnyNodeId, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'
import type { TreeNode } from './schema'

/**
 * Per-node selection proxy. The visible tree pixels come from the instanced
 * `def.system`; this renderer mounts an INVISIBLE, raycastable collider per
 * node so the host's existing selection machinery keeps working unchanged:
 *
 *  - `useRegistry(id, type, ref)` makes `sceneRegistry.get(id)` return a real
 *    per-node Object3D, which the outline pass and zone-containment tests read.
 *  - `useNodeEvents(node, type)` wires the same `trees:tree:click/enter/leave`
 *    bus events every selectable kind uses — no instanceId bookkeeping.
 *
 * The collider writes neither colour nor depth, so it never paints, but
 * `visible` stays true so R3F still raycasts it. Sized to the tree's rough
 * canopy box. Mounted inside the parent level's group (like every node
 * renderer), so its transform — and thus the picked position — is correct
 * without composing the level matrix here.
 */
export default function TreeProxyRenderer({ node: tree }: { node: TreeNode }) {
  const ref = useRef<Group>(null!)
  // The bus event key is the kind literal at runtime; the cast is contained.
  const handlers = useNodeEvents(tree as never, tree.type as never)
  useRegistry(tree.id as AnyNodeId, tree.type, ref)

  const height = Math.max(0.5, tree.height ?? 5)
  const radius = Math.max(0.4, height * 0.18)

  return (
    <group
      position={tree.position ?? [0, 0, 0]}
      ref={ref}
      rotation={tree.rotation ?? [0, 0, 0]}
      visible={tree.visible !== false}
      {...handlers}
    >
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[radius * 2, height, radius * 2]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
      </mesh>
    </group>
  )
}
