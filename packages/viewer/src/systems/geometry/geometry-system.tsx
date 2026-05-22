'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  nodeRegistry,
  type SurfaceRole,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { FrontSide, type Group, type Material, type Mesh } from 'three'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
} from '../../lib/materials'
import useViewer from '../../store/use-viewer'

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
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  useEffect(() => {
    const nodes = useScene.getState().nodes
    for (const node of Object.values(nodes)) {
      const def = nodeRegistry.get(node.type)
      if (def?.geometry) {
        useScene.getState().markDirty(node.id as AnyNodeId)
      }
    }
  }, [shading, textures, colorPreset, sceneTheme])

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const nodes = useScene.getState().nodes

    // Phase 1 — group dirty nodes by (kind, parentId). Kinds that
    // declare `def.computeLevelData` get one batch precompute per
    // group; the result lands in `ctx.levelData` for every node in
    // the same batch. Avoids O(N²) recomputation when many siblings
    // of the same kind are dirty in one frame (wall mitering is the
    // motivating case).
    type BatchKey = string // `${kind}::${parentId ?? ''}`
    const batches = new Map<
      BatchKey,
      { kind: string; parentId: AnyNodeId | null; ids: AnyNodeId[] }
    >()
    const dirtyIds: AnyNodeId[] = []
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      if (!def?.geometry) return
      dirtyIds.push(id as AnyNodeId)
      const parentId = (node.parentId ?? null) as AnyNodeId | null
      const key: BatchKey = `${node.type}::${parentId ?? ''}`
      const existing = batches.get(key)
      if (existing) existing.ids.push(id as AnyNodeId)
      else batches.set(key, { kind: node.type, parentId, ids: [id as AnyNodeId] })
    })

    // Phase 2 — for each batch whose kind declares `computeLevelData`,
    // collect every sibling in the level + run the precompute once.
    const levelDataByBatch = new Map<BatchKey, unknown>()
    for (const [key, batch] of batches) {
      const def = nodeRegistry.get(batch.kind)
      if (!def?.computeLevelData) continue
      const siblings: AnyNode[] = []
      if (batch.parentId) {
        const parent = nodes[batch.parentId]
        const childIds = (parent as unknown as { children?: AnyNodeId[] })?.children
        if (Array.isArray(childIds)) {
          for (const cid of childIds) {
            const child = nodes[cid]
            if (child?.type === batch.kind) siblings.push(child)
          }
        }
      } else {
        for (const node of Object.values(nodes)) {
          if (node?.type === batch.kind && !node.parentId) siblings.push(node)
        }
      }
      levelDataByBatch.set(
        key,
        (def.computeLevelData as (s: ReadonlyArray<AnyNode>) => unknown)(siblings),
      )
    }

    // Phase 3 — per-node rebuild. Each node receives its batch's
    // precomputed `levelData` in ctx.
    for (const id of dirtyIds) {
      const node = nodes[id]
      if (!node) continue

      const def = nodeRegistry.get(node.type)
      const builder = def?.geometry
      if (!builder) continue

      const group = sceneRegistry.nodes.get(id) as Group | undefined
      if (!group) continue // mount hasn't run — keep dirty for next frame

      const parentId = (node.parentId ?? null) as AnyNodeId | null
      const key: BatchKey = `${node.type}::${parentId ?? ''}`
      const levelData = levelDataByBatch.get(key)
      const ctx = buildGeometryContext(node, nodes, levelData)

      // The builder is typed against the kind's specific node — at the
      // generic system level we lose that refinement, so the cast lands
      // here. Builders are responsible for trusting their schema.
      const built = (
        builder as (
          n: AnyNode,
          c: GeometryContext,
          shading: RenderShading,
          textures: boolean,
          colorPreset: ColorPreset,
          sceneTheme: string,
        ) => { children: unknown[] }
      )(node, ctx, shading, textures, colorPreset, sceneTheme) as unknown as Group

      if (!textures && def.surfaceRole) {
        applyDefaultSurfaceRole(built, def.surfaceRole, colorPreset, sceneTheme)
      }

      disposeChildren(group)
      for (const child of [...built.children]) {
        // Tag every child the builder produced so a subsequent rebuild
        // can dispose only THIS rebuild's outputs and leave React-
        // mounted siblings (hosted items inside a shelf / slab / etc.)
        // alone. Without this, a parent rebuild triggered by a child
        // event (e.g. an item reparenting onto a shelf calls
        // `dirtyNodes.add(parent)` in `ItemRenderer`'s effect) would
        // wipe ALL of the parent group's children — including the
        // freshly-mounted item — leaving the item in scene state but
        // invisible.
        ;(child as { userData?: Record<string, unknown> }).userData = {
          ...(child as { userData?: Record<string, unknown> }).userData,
          __fromGeometry: true,
        }
        group.add(child)
      }
      // NOTE: we intentionally do NOT reset `group.position` / `group.rotation`
      // here. The `ParametricNodeRenderer` binds them via JSX (`position={...}`
      // / `rotation={...}`) driven by `useLiveTransforms` during drag and
      // `node.position` / `node.rotation` after commit. Zeroing them out
      // during a rebuild would clobber the React-applied transform — and
      // because the renderer doesn't necessarily re-render on the rebuild
      // tick, R3F wouldn't re-apply the props, leaving the group stuck at
      // origin. Geometry builders are expected to emit local-space children.

      clearDirty(id as AnyNodeId)
    }
  }, 2)

  return null
}

function buildGeometryContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  levelData: unknown,
): GeometryContext {
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

  return { resolve, children, siblings, parent, levelData }
}

function disposeChildren(group: Group) {
  // Only dispose meshes the geometry builder produced on the previous
  // rebuild (marked via `userData.__fromGeometry`). React-managed
  // children (hosted node renderers) get left in place — they have
  // their own React-driven lifecycle and would lose their meshes /
  // materials if we disposed them here.
  for (const child of [...group.children]) {
    const fromGeometry = (child as { userData?: { __fromGeometry?: boolean } }).userData
      ?.__fromGeometry
    if (!fromGeometry) continue
    group.remove(child)
    const mesh = child as Partial<Mesh> & { geometry?: { dispose?: () => void } }
    if (mesh.geometry?.dispose) mesh.geometry.dispose()
    if ('material' in mesh) {
      const m = (mesh as { material: unknown }).material
      if (Array.isArray(m)) {
        for (const mat of m) {
          if (isCachedMaterial(mat)) continue
          if (mat && typeof (mat as { dispose?: () => void }).dispose === 'function') {
            ;(mat as { dispose: () => void }).dispose()
          }
        }
      } else if (isCachedMaterial(m)) {
      } else if (m && typeof (m as { dispose?: () => void }).dispose === 'function') {
        ;(m as { dispose: () => void }).dispose()
      }
    }
  }
}

function applyDefaultSurfaceRole(
  root: Group,
  defaultRole: SurfaceRole,
  colorPreset: ColorPreset,
  sceneTheme?: string,
) {
  root.traverse((child) => {
    const mesh = child as Partial<Mesh> & {
      material?: Material | Material[]
      userData: Record<string, unknown>
    }
    if (!('material' in mesh) || !mesh.material) return

    const role = getMeshSurfaceRole(mesh.userData.surfaceRole, defaultRole)
    mesh.userData.surfaceRole = role
    mesh.material = createSurfaceRoleMaterial(
      role,
      colorPreset,
      getMaterialSide(mesh.material),
      sceneTheme,
    )
  })
}

function getMeshSurfaceRole(value: unknown, fallback: SurfaceRole): SurfaceRole {
  return typeof value === 'string' && isSurfaceRole(value) ? value : fallback
}

function isSurfaceRole(value: string): value is SurfaceRole {
  return (
    value === 'wall' ||
    value === 'floor' ||
    value === 'ceiling' ||
    value === 'roof' ||
    value === 'joinery' ||
    value === 'glazing' ||
    value === 'furnishing'
  )
}

function getMaterialSide(material: Material | Material[]): Material['side'] {
  const source = Array.isArray(material) ? material[0] : material
  return source?.side ?? FrontSide
}

function isCachedMaterial(value: unknown): boolean {
  return Boolean(
    (value as { userData?: { __pascalCachedMaterial?: boolean } } | null)?.userData
      ?.__pascalCachedMaterial,
  )
}

export default GeometrySystem
