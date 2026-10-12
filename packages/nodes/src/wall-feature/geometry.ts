import type { WallFeaturePlacement } from '@pascal-app/core'
import {
  ADDITION,
  Brush,
  csgGeometry,
  Evaluator,
  prepareBrushForCSG,
  SUBTRACTION,
  type WallBodyGeometry,
} from '@pascal-app/viewer'
import { BoxGeometry, type BufferGeometry } from 'three'

const WELD_EPSILON = 0.002
const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal', 'uv', 'uv2']
evaluator.useGroups = false

/** Owns the input body; the root wall remains the only visible solid. */
export function buildWallFeatureBody(
  body: BufferGeometry,
  placements: readonly WallFeaturePlacement[],
  elevation: number,
): WallBodyGeometry {
  if (!placements.length) return { geometry: body }
  const ordered = [...placements].sort((a, b) =>
    a.node.mode === b.node.mode
      ? a.node.id.localeCompare(b.node.id)
      : a.node.mode === 'bump'
        ? -1
        : 1,
  )
  const features = new Map(ordered.map(({ node }) => [node.id as string, node]))
  const finishRef = (node: (typeof ordered)[number]['node']): string | undefined => {
    if (node.slots?.surface) return node.slots.surface
    const host = node.parentId ? features.get(node.parentId) : undefined
    return host ? finishRef(host) : undefined
  }
  let result = new Brush(body)
  prepareBrushForCSG(result)
  try {
    for (const placement of ordered) {
      const { node, mountOffset, surfaceOffset } = placement
      const sign = placement.face === 'a' ? 1 : -1
      // Overshoot only the mounting plane. The authored outer/back face stays exact.
      const start = mountOffset + sign * (node.mode === 'bump' ? -WELD_EPSILON : WELD_EPSILON)
      const box = new BoxGeometry(node.width, node.height, Math.abs(surfaceOffset - start))
      box.translate(
        placement.u,
        placement.bottom - elevation + node.height / 2,
        (start + surfaceOffset) / 2,
      )
      const brush = new Brush(box)
      try {
        prepareBrushForCSG(brush)
        const next = evaluator.evaluate(
          result,
          brush,
          node.mode === 'bump' ? ADDITION : SUBTRACTION,
        )
        csgGeometry(result).dispose()
        result = next
      } finally {
        box.dispose()
      }
    }
    const geometry = csgGeometry(result)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return {
      geometry,
      finishRefs: [
        ...new Set(
          ordered.flatMap(({ node }) => (node.slots?.surface ? [node.slots.surface] : [])),
        ),
      ],
      faceAt: (point) => {
        for (let i = ordered.length - 1; i >= 0; i--) {
          const { bounds, face, node } = ordered[i]!
          if (
            point.x >= bounds.u0 - WELD_EPSILON &&
            point.x <= bounds.u1 + WELD_EPSILON &&
            point.y >= bounds.y0 - elevation - WELD_EPSILON &&
            point.y <= bounds.y1 - elevation + WELD_EPSILON &&
            point.z >= bounds.n0 - WELD_EPSILON &&
            point.z <= bounds.n1 + WELD_EPSILON
          )
            return { face, finishRef: finishRef(node), ownerId: node.id }
        }
        return null
      },
    }
  } catch (error) {
    csgGeometry(result).dispose()
    throw error
  }
}
