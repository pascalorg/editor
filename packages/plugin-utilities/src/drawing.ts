import type { FloorplanGeometry, SceneSnapshot } from '@pascal-app/core'
import { polePlan } from './utility-line/endpoints'
import { siteDrawContext } from './draw-context'
import { isServicePoint, isUtilityLine, isUtilityPole } from './kind-guards'
import { drawServicePoint } from './service-point/floorplan'
import type { LooseNode, LooseNodes } from './site-frame'
import { resolveLineEndpoints } from './utility-line/endpoints'
import { drawUtilityLine } from './utility-line/floorplan'
import { drawUtilityPole } from './utility-pole/floorplan'

export type DrawingBounds = { minX: number; minY: number; maxX: number; maxY: number }

export type UtilitiesDrawing = {
  primitives: FloorplanGeometry[]
  bounds: DrawingBounds
  counts: { lines: number; poles: number; servicePoints: number }
}

/**
 * The workstream-wide drawing-output contract
 * (docs/construction-documents.md): every utility in the scene as core
 * geometry primitives in SITE metres, with a bounds.
 *
 * WHY THIS EXISTS SEPARATELY FROM `def.floorplan` — and this is the honest
 * limitation of workstream 4 as shipped. `FloorplanSitePlanLayer`
 * (packages/editor/src/lib/floorplan/site-plan/site-plan-layer.tsx) is
 * mounted INSTEAD of `FloorplanRegistryLayer` when `drawingType ===
 * 'site-plan'` (floorplan-panel.tsx:11460), and it renders exactly the
 * primitives that `buildSitePlanDrawing` returns. That builder walks the
 * scene itself and never consults the node registry, so a plugin kind's
 * `def.floorplan` is NOT called in site-plan view no matter what it
 * returns.
 *
 * The consequence, stated plainly: TODAY these kinds render in the
 * FLOOR-PLAN view (via `def.floorplan`, offset by the building transform —
 * see `site-frame.ts`) and in 3D, but NOT in the site-plan view. Making
 * them appear there is one line in a file this workstream does not own —
 * `buildSitePlanDrawing` pushing `...buildUtilitiesDrawing(scene).primitives`
 * into its own `primitives` array. This function is that seam, already in
 * the site frame the site plan draws in, so no coordinate work is left for
 * the caller.
 */
export function buildUtilitiesDrawing(scene: SceneSnapshot): UtilitiesDrawing {
  const nodes = scene.nodes as unknown as LooseNodes
  const primitives: FloorplanGeometry[] = []
  const counts = { lines: 0, poles: 0, servicePoints: 0 }
  const points: Array<[number, number]> = []

  for (const raw of Object.values(nodes)) {
    const node = raw as LooseNode
    const dctx = siteDrawContext(nodes, node)
    if (isUtilityLine(node)) {
      const geometry = drawUtilityLine(node, dctx)
      if (!geometry) continue
      counts.lines += 1
      primitives.push(geometry)
      // Bounds come off the RESOLVED run, so a drop that ends on a meter is
      // bounded at the meter and not at whatever copy `path` still holds.
      for (const vertex of resolveLineEndpoints(nodes, node).path) {
        points.push([vertex[0], vertex[2]])
      }
    } else if (isUtilityPole(node)) {
      const geometry = drawUtilityPole(node, dctx)
      if (!geometry) continue
      counts.poles += 1
      primitives.push(geometry)
      points.push(polePlan(node))
    } else if (isServicePoint(node)) {
      const geometry = drawServicePoint(node, dctx)
      if (!geometry) continue
      counts.servicePoints += 1
      primitives.push(geometry)
      points.push([node.position[0], node.position[2]])
    }
  }

  return { primitives, bounds: boundsOf(points), counts }
}

function boundsOf(points: ReadonlyArray<[number, number]>): DrawingBounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  // Pad by the largest symbol radius so a pole's cross is not clipped.
  const pad = 1
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}
