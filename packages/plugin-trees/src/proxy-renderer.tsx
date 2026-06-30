'use client'

import { type AnyNodeId, useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import { type Group, MeshBasicMaterial } from 'three'
import { getVariantData } from './geometry'
import type { TreeNode } from './schema'

// One shared invisible material for every silhouette mesh: writes neither
// colour nor depth, so it paints nothing in the main passes — but the host's
// outline pass renders it with its OWN depth-override material, so the true
// tree shape still outlines.
const INVISIBLE = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })

/**
 * Per-node selection proxy for the instanced trees. The visible pixels come
 * from the `def.system` InstancedMeshes; this gives the host's existing
 * selection machinery the per-node `Object3D` it needs:
 *
 *  - Outer group: carries the `useNodeEvents` pointer handlers and a cheap
 *    invisible BOX collider — the stable raycast target for hover/select.
 *  - Inner group (the one registered with `useRegistry`): empty until the tree
 *    is hovered/selected, then it holds the real ez-tree geometry (invisible,
 *    non-raycasting). The outline pass reads exactly this registered object, so
 *    the highlight traces the true silhouette — not the box — while picking
 *    still goes through the steady outer collider.
 */
export default function TreeProxyRenderer({ node: tree }: { node: TreeNode }) {
  const outlineRef = useRef<Group>(null!)
  // The bus event key is the kind literal at runtime; the cast is contained.
  const handlers = useNodeEvents(tree as never, tree.type as never)
  useRegistry(tree.id as AnyNodeId, tree.type, outlineRef)

  const active = useViewer(
    (s) => s.hoveredId === tree.id || s.selection.selectedIds.includes(tree.id as never),
  )

  const height = Math.max(0.5, tree.height ?? 5)
  const radius = Math.max(0.4, height * 0.18)

  // Real geometry for the silhouette, only built when actually highlighted.
  const variant = useMemo(
    () => (active ? getVariantData(tree.preset, tree.seed) : null),
    [active, tree.preset, tree.seed],
  )
  const silhouetteScale = variant ? height / variant.naturalHeight : 1

  return (
    <group
      position={tree.position ?? [0, 0, 0]}
      rotation={tree.rotation ?? [0, 0, 0]}
      visible={tree.visible !== false}
      {...handlers}
    >
      {/* Stable invisible pick collider (NOT under the registered group, so it
          is never outlined). */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[radius * 2, height, radius * 2]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      {/* Registered outline target — real geometry appears only when active. */}
      <group ref={outlineRef}>
        {variant && (
          <group scale={silhouetteScale}>
            {variant.subMeshes.map((subMesh, i) => (
              <mesh
                dispose={null}
                geometry={subMesh.geometry}
                key={i}
                material={INVISIBLE}
                raycast={NO_RAYCAST}
              />
            ))}
          </group>
        )}
      </group>
    </group>
  )
}

// Silhouette meshes must not steal pointer hits from the box collider.
const NO_RAYCAST = () => {}
