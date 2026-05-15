'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  nodeRegistry,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh } from 'three'

/**
 * Generic geometry system.
 *
 * For every node in `dirtyNodes` whose definition exposes `def.geometry`,
 * this system:
 *  1. Looks up the registered `Group` from `sceneRegistry` (mounted by the
 *     framework's `<ParametricNodeRenderer>`, or a custom renderer that
 *     opts into the same mount contract).
 *  2. Builds a `GeometryContext` from the current scene snapshot.
 *  3. Calls `def.geometry(node, ctx)` to get the new `Object3D`.
 *  4. Disposes the registered group's existing children + their geometries
 *     and materials.
 *  5. Reparents the returned object's children onto the registered group.
 *  6. Clears the dirty flag.
 *
 * This is the "no per-kind system needed" path documented in
 * `wiki/architecture/node-definitions.md`. A kind that only rebuilds on
 * dirty (shelf, item, fence segment, etc.) ships nothing more than a pure
 * `geometry` function — no `renderer.tsx`, no `system.tsx`.
 *
 * Kinds with `def.system` declared run their own systems *in addition* to
 * this one — animation + cascade + named-mesh material poking stay
 * kind-specific.
 *
 * Frame priority 2 mirrors the per-kind shelf system it replaces. Door
 * animation systems run at priority 2 today too, marking dirty so the
 * geometry rebuild lands at priority 3-4 next frame. Door/window/wall
 * still have their own systems (they need cross-cutting work this system
 * doesn't cover) — they coexist; this system only acts on kinds that
 * declare `def.geometry`.
 */
export const GeometrySystem = () => {
  const dirtyNodes = useScene((s) => s.dirtyNodes)
  const clearDirty = useScene((s) => s.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      const def = nodeRegistry.get(node.type)
      const builder = def?.geometry
      if (!builder) return

      const group = sceneRegistry.nodes.get(id) as Group | undefined
      if (!group) return // mount hasn't run — keep dirty for next frame

      const ctx = buildGeometryContext(node, nodes)

      // The builder is typed against the kind's specific node — at the
      // generic system level we lose that refinement, so the cast lands
      // here. Builders are responsible for trusting their schema.
      const built = (builder as (n: AnyNode, c: GeometryContext) => { children: unknown[] })(
        node,
        ctx,
      ) as unknown as Group

      disposeChildren(group)
      for (const child of [...built.children]) {
        group.add(child)
      }

      clearDirty(id as AnyNodeId)
    })
  }, 2)

  return null
}

function buildGeometryContext(node: AnyNode, nodes: Record<string, AnyNode>): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined

  const childIds = (node as unknown as { children?: AnyNodeId[] }).children
  const children: AnyNode[] = Array.isArray(childIds)
    ? childIds.map((cid) => nodes[cid]).filter((n): n is AnyNode => n !== undefined)
    : []

  const parentId = node.parentId as AnyNodeId | null
  const parent: AnyNode | null = parentId ? (nodes[parentId] ?? null) : null

  // Siblings = same kind, same parent, excluding self. Walks the parent's
  // children array; falls back to scanning the whole scene if the parent
  // doesn't carry a `children` list (rare — most parents do).
  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as unknown as { children?: AnyNodeId[] }).children
    if (Array.isArray(parentChildIds)) {
      for (const sid of parentChildIds) {
        if (sid === node.id) continue
        const s = nodes[sid]
        if (s && s.type === node.type) siblings.push(s)
      }
    } else {
      siblings = Object.values(nodes).filter(
        (n) => n !== node && n.type === node.type && n.parentId === parentId,
      )
    }
  }

  return { resolve, children, siblings, parent }
}

function disposeChildren(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    const mesh = child as Partial<Mesh> & { geometry?: { dispose?: () => void } }
    if (mesh.geometry?.dispose) mesh.geometry.dispose()
    if ('material' in mesh) {
      const m = (mesh as { material: unknown }).material
      if (Array.isArray(m)) {
        for (const mat of m) {
          if (mat && typeof (mat as { dispose?: () => void }).dispose === 'function') {
            ;(mat as { dispose: () => void }).dispose()
          }
        }
      } else if (m && typeof (m as { dispose?: () => void }).dispose === 'function') {
        ;(m as { dispose: () => void }).dispose()
      }
    }
  }
}

export default GeometrySystem
