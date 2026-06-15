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

  const builder = nodeRegistry.get(node.type)?.floorplan
  if (!builder) return null

  // Minimal, unselected context — preview never shows selection chrome
  // (move handles / resize arrows / hatch live behind `viewState.selected`).
  // `resolve` reads the scene lazily (a builder rarely calls it for a ghost,
  // and `parent: null` short-circuits the elevator's level walk) so the layer
  // never subscribes to / bulk-reads the nodes map during render.
  // `parentNode` is the synthetic wall for an off-wall door/window ghost so
  // its builder draws the real swing-arc / pane symbol (see use-placement-preview).
  const ctx = {
    resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
    children: [],
    siblings: [],
    parent: parentNode ?? null,
    viewState: undefined,
  } as unknown as GeometryContext

  const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
    node,
    ctx,
  )
  if (!geometry) return null

  return (
    <g data-floorplan-placement-preview opacity={0.5} pointerEvents="none">
      <FloorplanGeometryRenderer geometry={geometry} />
    </g>
  )
})
