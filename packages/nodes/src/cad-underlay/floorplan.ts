import type { CadUnderlayNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import {
  cadUnderlayOpacity,
  getCadUnderlay,
  loadCadUnderlay,
  resolveCadLayers,
} from '@pascal-app/editor'

/**
 * Hairline weight in screen pixels. Paired with `non-scaling-stroke` so the
 * underlay stays a constant faint hairline at every zoom — a stroke measured
 * in drawing units would be invisible zoomed out and a slab zoomed in.
 */
const UNDERLAY_STROKE_PX = 0.75

export function buildCadUnderlayFloorplan(
  node: CadUnderlayNode,
  _ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null

  const loaded = getCadUnderlay(node.url)
  if (!loaded) {
    // Warm the cache for the next pass. Idempotent, and the load's completion
    // notifies the plan to rebuild — see `useCadUnderlayRevision`.
    loadCadUnderlay(node.url)
    return null
  }

  const layers = resolveCadLayers(node, loaded)
  if (layers.length === 0) return null

  const opacity = cadUnderlayOpacity(node)
  const children: FloorplanGeometry[] = layers.map((layer) => ({
    kind: 'path',
    d: loaded.pathByLayer[layer.index] ?? '',
    stroke: layer.color,
    strokeWidth: UNDERLAY_STROKE_PX,
    vectorEffect: 'non-scaling-stroke',
    fill: 'none',
    strokeOpacity: opacity,
    // A locked underlay must never catch the pointer: clicking a drawn wall
    // has to fall through to whatever is beneath it, or tracing over the
    // drawing would select the drawing instead.
    pointerEvents: 'none',
  }))

  return {
    kind: 'group',
    // The path data is in the drawing's own units; `scale` converts to plan
    // metres here rather than baking metres into the cached path strings,
    // which would have to be regenerated on every calibration change.
    transform: {
      translate: [node.position[0], node.position[2]],
      rotate: node.rotation[1],
      scale: node.scale,
    },
    children,
  }
}
