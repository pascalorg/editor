'use client'

import {
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useNodeEvents } from '../../hooks/use-node-events'
import { NodeRenderer } from './node-renderer'

/**
 * Generic renderer for any kind that ships `def.geometry` but no custom
 * `def.renderer`.
 *
 * The renderer is intentionally featureless:
 *  - Mounts an empty `<group>`.
 *  - Registers the group with `sceneRegistry` so `<GeometrySystem>` can find
 *    it and inject children built by `def.geometry(node, ctx)`.
 *  - Wires `useNodeEvents(node, node.type)` on the group so pointer events
 *    bubble through to the editor's selection / hover bus.
 *  - Marks the node dirty on mount so the geometry system runs once on
 *    first render (and on every subsequent identity change).
 *  - Reads `useLiveTransforms` so drag tools that imperatively override
 *    position / rotation (the shelf-style smooth move) still work.
 *  - Renders hosted children recursively via `<NodeRenderer>`.
 *
 * This is what lets shelf — and every future registry-driven parametric
 * kind — ship without a per-kind `renderer.tsx`. See
 * `wiki/architecture/node-definitions.md` for the three-checkbox model.
 *
 * Typing note: `useNodeEvents` is keyed by a literal kind, but at this
 * dispatch level we have a union. The cast is contained here so callers
 * stay clean. Selection/hover events still fire on the kind-specific
 * event key (`shelf:click`, `item:enter`, etc.) — that's the runtime
 * behavior the bus consumers care about.
 */
type RenderableNode = AnyNode & {
  id: AnyNodeId
  position?: [number, number, number]
  rotation?: [number, number, number] | number
  visible?: boolean
  children?: AnyNodeId[]
}

export const ParametricNodeRenderer = ({ node }: { node: AnyNode }) => {
  const ref = useRef<Group>(null!)
  const n = node as RenderableNode
  const handlers = useNodeEvents(node as any, node.type as any)
  const liveTransform = useLiveTransforms((s) => s.get(node.id as AnyNodeId))
  // Registry arrow handles (rotation gizmo, position-affecting patches)
  // write to `useLiveNodeOverrides`. GeometrySystem already merges that
  // for the mesh body; we also fold it into the outer group's
  // position/rotation so the rotation arrow shows live motion instead
  // of snapping only on commit. Per-node subscription so unrelated
  // override writes don't re-render the whole tree.
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const overrideRotation = liveOverride?.rotation as [number, number, number] | number | undefined
  const overridePosition = liveOverride?.position as [number, number, number] | undefined

  useRegistry(node.id, node.type, ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id])

  const position = liveTransform?.position ?? overridePosition ?? n.position ?? [0, 0, 0]
  const rawRotation = overrideRotation ?? n.rotation
  const baseRotation: [number, number, number] =
    typeof rawRotation === 'number' ? [0, rawRotation, 0] : (rawRotation ?? [0, 0, 0])
  // The live transform carries only the plan-view Y rotation; keep the
  // node's own X/Z so 3D-oriented kinds (e.g. a duct-fitting riser at
  // X=π/2) don't visually flatten to horizontal mid-drag. Matches the
  // move tool's commit, which also replaces only the Y component.
  const rotation: [number, number, number] =
    liveTransform?.rotation !== undefined
      ? [baseRotation[0], liveTransform.rotation, baseRotation[2]]
      : baseRotation

  return (
    <group
      position={position}
      ref={ref}
      rotation={rotation}
      visible={n.visible !== false}
      {...handlers}
    >
      {Array.isArray(n.children) &&
        n.children.map((childId) => (
          <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
        ))}
    </group>
  )
}
