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
import { memo, useMemo } from 'react'
import usePlacementPreview from '../../../store/use-placement-preview'
import { useFloorplanRender } from '../floorplan-render-context'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

export interface FloorplanNodePreviewProps {
  node: AnyNode
  parentNode?: AnyNode | null
  opacity?: number
  className?: string
  selected?: boolean
  highlighted?: boolean
  hovered?: boolean
  moving?: boolean
}

/**
 * Stateless floor-plan ghost for an already-positioned node. Hosts can use
 * this to render host-owned placement previews without publishing transient
 * state into the editor's local placement-preview store.
 */
export const FloorplanNodePreview = memo(function FloorplanNodePreview({
  node,
  parentNode = null,
  opacity = 0.5,
  className,
  selected = false,
  highlighted = false,
  hovered = false,
  moving = false,
}: FloorplanNodePreviewProps) {
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((state) => state.unit)
  const renderContext = useFloorplanRender()

  const geometry = useMemo(() => {
    const definition = nodeRegistry.get(node.type)
    const builder = definition?.floorplan
    if (!builder) return null

    const contextNodes: Record<string, AnyNode> = {
      ...(nodes as Record<string, AnyNode>),
      [node.id]: node,
    }
    if (parentNode) contextNodes[parentNode.id] = parentNode
    const resolvedParent =
      parentNode ?? (node.parentId ? (contextNodes[node.parentId] ?? null) : null)
    const childIds = (node as AnyNode & { children?: AnyNodeId[] }).children ?? []
    const children = childIds.flatMap((id) => {
      const child = contextNodes[id]
      return child ? [child] : []
    })
    const siblings = Object.values(contextNodes).filter(
      (candidate) =>
        candidate.id !== node.id &&
        candidate.type === node.type &&
        candidate.parentId === node.parentId,
    )
    const levelData = definition.computeFloorplanLevelData?.({
      siblings: [node, ...siblings],
      nodes: contextNodes,
    })
    const ctx: GeometryContext = {
      resolve: <N = AnyNode>(id: AnyNodeId) => contextNodes[id] as N | undefined,
      children,
      siblings,
      parent: resolvedParent,
      levelData,
      viewState: renderContext
        ? {
            selected,
            unit,
            highlighted,
            hovered,
            moving,
            palette: renderContext.palette,
          }
        : undefined,
    }

    return (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(node, ctx)
  }, [highlighted, hovered, moving, node, nodes, parentNode, renderContext, selected, unit])
  if (!geometry) return null

  return (
    <g className={className} opacity={opacity} pointerEvents="none">
      <FloorplanGeometryRenderer geometry={geometry} pointerEventsOverride="none" />
    </g>
  )
})

/**
 * Renders a faint, non-interactive ghost of the node being placed by a
 * registry placement tool (e.g. column), following the cursor in the floor
 * plan. The 3D view shows a translucent mesh preview; in 2D that mesh is
 * hidden (canvas `display:none`), so without this the user only saw the grid
 * cursor dot + alignment guides — no sense of the footprint they were about
 * to drop. The placement tool publishes a transient, already-positioned +
 * aligned node to `usePlacementPreview`; we build its `def.floorplan`
 * footprint with active sibling, level-data, and theme context so kind-specific
 * shapes match the committed renderer.
 *
 * Mounted inside the floor-plan scene `<g>` so the geometry's level-local
 * meters get the same world→SVG transform every other entry does.
 */
export const FloorplanPlacementPreviewLayer = memo(function FloorplanPlacementPreviewLayer() {
  const node = usePlacementPreview((s) => s.node)
  const parentNode = usePlacementPreview((s) => s.parentNode)
  if (!node) return null

  return (
    <g data-floorplan-placement-preview>
      <FloorplanNodePreview node={node} parentNode={parentNode} />
    </g>
  )
})
