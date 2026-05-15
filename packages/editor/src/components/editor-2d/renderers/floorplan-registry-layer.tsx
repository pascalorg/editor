'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useCallback, useMemo } from 'react'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

/**
 * Registry-driven floor-plan layer.
 *
 * For every node in the active level whose definition exposes
 * `def.floorplan`, builds a `GeometryContext`, calls the builder, and
 * emits the resulting SVG via `<FloorplanGeometryRenderer>`. Each entry
 * is wrapped in an interactive `<g>` that handles **click → select**.
 *
 * Move and delete happen via the same flow as 3D: select sets
 * `useViewer.selection`, the `<ParametricInspector>` opens with Move /
 * Delete buttons, and the user enters move mode from there. Floor-plan
 * cursor-driven placement for registry kinds (the "while in moving
 * state, click in floor plan to place") is a follow-up — see the
 * plan's Phase 4 follow-on section.
 *
 * Drag-to-move was prototyped here briefly but removed: the grab cursor
 * + drag interaction model is inconsistent with the rest of the editor
 * (3D doesn't drag, it uses select → Move button → cursor-driven
 * placement) and the SVG coord conversion needs to route through the
 * floor-plan scene `<g>` (legacy `floorplanSceneRef`) to account for
 * pan/zoom transforms. Both warrant a proper port via the action menu
 * + movingNode flow, not an inline drag in this layer.
 *
 * Coexists with the legacy `floorplan-panel.tsx` inline rendering —
 * unmigrated kinds keep their hand-written branches. As each kind ports
 * `def.floorplan`, its inline equivalent becomes dead code and gets
 * removed in the same PR.
 *
 * Coordinates are level-local meters; the parent SVG handles world→SVG
 * transform via its viewBox.
 */
export const FloorplanRegistryLayer = memo(function FloorplanRegistryLayer() {
  const levelId = useViewer((s) => s.selection.levelId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)

  const handleSelect = useCallback(
    (id: AnyNodeId, event: React.PointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      setSelection({ selectedIds: [id] })
    },
    [setSelection],
  )

  const entries = useMemo(() => {
    if (!levelId) return []
    const out: {
      id: AnyNodeId
      node: AnyNode
      geometry: FloorplanGeometry
    }[] = []

    const visit = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      const builder = def?.floorplan
      if (builder) {
        const ctx = buildContext(node, nodes)
        const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
          node,
          ctx,
        )
        if (geometry) out.push({ id, node, geometry })
      }
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(levelId as AnyNodeId)
    return out
  }, [levelId, nodes])

  if (entries.length === 0) return null

  return (
    <g className="floorplan-registry-layer">
      {entries.map(({ id, geometry }) => {
        const isSelected = selectedIds.includes(id)
        return (
          <g
            className={
              isSelected ? 'floorplan-registry-entry selected' : 'floorplan-registry-entry'
            }
            data-node-id={id}
            key={id}
            onPointerDown={(e) => handleSelect(id, e)}
            style={{ cursor: 'pointer' }}
          >
            <FloorplanGeometryRenderer geometry={geometry} />
            {isSelected && <SelectionOutline geometry={geometry} />}
          </g>
        )
      })}
    </g>
  )
})

function SelectionOutline({ geometry }: { geometry: FloorplanGeometry }) {
  return (
    <g pointerEvents="none">
      <FloorplanGeometryRenderer geometry={withSelectionStyle(geometry)} />
    </g>
  )
}

function withSelectionStyle(g: FloorplanGeometry): FloorplanGeometry {
  const accent = { stroke: '#818cf8', strokeWidth: 0.04, fill: 'none', opacity: 1 }
  if (g.kind === 'group') {
    return { ...g, children: g.children.map(withSelectionStyle) }
  }
  return { ...g, ...accent }
}

function buildContext(node: AnyNode, nodes: Record<string, AnyNode>): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined

  const childIds = (node as unknown as { children?: AnyNodeId[] }).children
  const children: AnyNode[] = Array.isArray(childIds)
    ? childIds.map((cid) => nodes[cid]).filter((n): n is AnyNode => n !== undefined)
    : []

  const parentId = node.parentId as AnyNodeId | null
  const parent: AnyNode | null = parentId ? (nodes[parentId] ?? null) : null

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
