'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { memo } from 'react'
import usePlacementPreview from '../../../store/use-placement-preview'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

export interface FloorplanNodePreviewProps {
  node: AnyNode
  parentNode?: AnyNode | null
  opacity?: number
  className?: string
}

/**
 * Stateless floor-plan ghost for an already-positioned node. Hosts can use
 * this to render remote placement previews without publishing another user's
 * transient state into the editor's local placement-preview store.
 */
export const FloorplanNodePreview = memo(function FloorplanNodePreview({
  node,
  parentNode = null,
  opacity = 0.5,
  className,
}: FloorplanNodePreviewProps) {
  const builder = nodeRegistry.get(node.type)?.floorplan
  if (!builder) return null

  const ctx = {
    resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
    children: [],
    siblings: [],
    parent: parentNode,
    viewState: undefined,
  } as unknown as GeometryContext

  const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
    node,
    ctx,
  )
  if (!geometry) return null

  return (
    <g className={className} opacity={opacity} pointerEvents="none">
      <FloorplanGeometryRenderer geometry={geometry} />
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
 * footprint with a minimal (unselected) context and render it.
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
