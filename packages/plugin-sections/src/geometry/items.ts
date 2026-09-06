/**
 * PLACED ITEMS in elevation and section — the furniture, fixtures, trees,
 * condenser, cars: whatever is in the scene, drawn where it stands.
 *
 * HONEST LIMIT: an item is a GLB model whose mesh is not available to this
 * headless builder, so it is drawn as its oriented footprint box raised to its
 * height, labelled with its name, and — for the few kinds whose silhouette a
 * reader expects (trees, palms, shrubs) — as a trunk and canopy at the item's
 * real height and spread. It is a dynamic, correctly placed, correctly sized
 * stand-in, not a picture of the model. Painted in depth order with the walls,
 * so a sofa inside the house is hidden by the wall in front of it and the
 * condenser outside stands in front of the siding.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  clipToDepthSlab,
  drawY,
  type ProjectedPiece,
  projectDepth,
  type Projector,
  projectU,
} from './projection'
import type { FeatureSolid, ItemSolid } from './scene-model'
import { INK, line, PAPER, polygon } from './style'
import type { Vec2 } from './types'

const ITEM_INK = '#374151'
const ITEM_FILL = '#f8fafc'
const CANOPY = '#e5efe0'
const PLANT = /\b(tree|palm|fir|bush|hedge|plant|shrub)\b/i

export function projectItem(view: Projector, item: ItemSolid): ProjectedPiece | null {
  const clipped = clipToDepthSlab(view, item.polygon)
  if (clipped.length < 3) return null
  let uMin = Number.POSITIVE_INFINITY
  let uMax = Number.NEGATIVE_INFINITY
  let depth = Number.NEGATIVE_INFINITY
  for (const p of clipped) {
    const u = projectU(view, p[0], p[1])
    uMin = Math.min(uMin, u)
    uMax = Math.max(uMax, u)
    depth = Math.max(depth, projectDepth(view, p[0], p[1]))
  }
  if (!(uMax - uMin > 1e-4) || !(item.topY - item.baseY > 1e-4)) return null
  const yTop = drawY(item.topY)
  const yBottom = drawY(item.baseY)
  const primitives: FloorplanGeometry[] = []

  if (PLANT.test(`${item.name} ${item.assetId}`)) {
    // Trunk + canopy at the item's real spread and height.
    const cx = (uMin + uMax) / 2
    const spread = uMax - uMin
    const h = item.topY - item.baseY
    const trunkW = Math.max(0.06, spread * 0.1)
    const canopyBottom = yBottom - h * 0.3
    primitives.push(
      polygon(
        [
          [cx - trunkW / 2, yBottom],
          [cx + trunkW / 2, yBottom],
          [cx + trunkW / 2, canopyBottom],
          [cx - trunkW / 2, canopyBottom],
        ],
        { fill: ITEM_FILL, stroke: ITEM_INK, strokeWidth: 0.008 },
      ),
    )
    const pts: Vec2[] = []
    const ry = (canopyBottom - yTop) / 2
    const cy = yTop + ry
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2
      // A slightly lumpy outline reads as foliage, deterministic per index.
      const wobble = 1 + 0.06 * Math.sin(i * 2.7)
      pts.push([cx + (spread / 2) * wobble * Math.cos(a), cy + ry * wobble * Math.sin(a)])
    }
    primitives.push(polygon(pts, { fill: CANOPY, stroke: ITEM_INK, strokeWidth: 0.008 }))
  } else {
    primitives.push(
      polygon(
        [
          [uMin, yTop],
          [uMax, yTop],
          [uMax, yBottom],
          [uMin, yBottom],
        ],
        { fill: ITEM_FILL, stroke: ITEM_INK, strokeWidth: 0.008 },
      ),
    )
    // A short "top" line a hair below the outline reads as a box, not a hole.
    primitives.push(
      line([uMin, yTop + 0.04], [uMax, yTop + 0.04], { stroke: ITEM_INK, strokeWidth: 0.004 }),
    )
    if (uMax - uMin > 0.45 && item.topY - item.baseY > 0.3) {
      primitives.push({
        kind: 'text',
        x: (uMin + uMax) / 2,
        y: (yTop + yBottom) / 2,
        text: item.name.toUpperCase().slice(0, 18),
        fontSize: Math.min(0.11, (uMax - uMin) / Math.max(4, item.name.length * 0.7)),
        fill: ITEM_INK,
        textAnchor: 'middle',
        dominantBaseline: 'central',
      } as FloorplanGeometry)
    }
  }
  return { depth, primitives }
}

/** Where a footprint lands in the view: its u extent and the depth of its nearest point. */
function extentOf(
  view: Projector,
  poly: readonly Vec2[],
): { uMin: number; uMax: number; depth: number } | null {
  const clipped = clipToDepthSlab(view, poly)
  if (clipped.length < 3) return null
  let uMin = Number.POSITIVE_INFINITY
  let uMax = Number.NEGATIVE_INFINITY
  let depth = Number.NEGATIVE_INFINITY
  for (const p of clipped) {
    const u = projectU(view, p[0], p[1])
    uMin = Math.min(uMin, u)
    uMax = Math.max(uMax, u)
    depth = Math.max(depth, projectDepth(view, p[0], p[1]))
  }
  return uMax - uMin > 1e-4 ? { uMin, uMax, depth } : null
}

/** A tree: trunk and a lumpy canopy at its height and spread. */
function treePrimitives(cx: number, spread: number, yBottom: number, yTop: number): FloorplanGeometry[] {
  const h = yBottom - yTop
  const trunkW = Math.max(0.06, spread * 0.1)
  const canopyBottom = yBottom - h * 0.3
  const out: FloorplanGeometry[] = [
    polygon(
      [
        [cx - trunkW / 2, yBottom],
        [cx + trunkW / 2, yBottom],
        [cx + trunkW / 2, canopyBottom],
        [cx - trunkW / 2, canopyBottom],
      ],
      { fill: ITEM_FILL, stroke: ITEM_INK, strokeWidth: 0.008 },
    ),
  ]
  const pts: Vec2[] = []
  const ry = (canopyBottom - yTop) / 2
  const cy = yTop + ry
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    const wobble = 1 + 0.06 * Math.sin(i * 2.7)
    pts.push([cx + (spread / 2) * wobble * Math.cos(a), cy + ry * wobble * Math.sin(a)])
  }
  out.push(polygon(pts, { fill: CANOPY, stroke: ITEM_INK, strokeWidth: 0.008 }))
  return out
}

/** Picket pitch a guard is drawn at: 1½ in pickets at a 4 in gap. */
const PICKET_PITCH = 0.14
const RAIL_BAND = 0.09

/**
 * A built feature in elevation: a post as its box; a guard as its outline with
 * a top rail band and pickets; a flight as its box with a tread line at every
 * riser; a tree as trunk and canopy. Painted in depth order with everything
 * else, so a guard in front of the siding shows and one behind the house hides.
 */
export function projectFeature(view: Projector, f: FeatureSolid): ProjectedPiece | null {
  const ext = extentOf(view, f.polygon)
  if (!ext || !(f.topY - f.baseY > 1e-4)) return null
  const { uMin, uMax, depth } = ext
  const yTop = drawY(f.topY)
  const yBottom = drawY(f.baseY)
  const primitives: FloorplanGeometry[] = []
  const boxStyle = { fill: PAPER, stroke: ITEM_INK, strokeWidth: 0.008 }
  const outline = (): FloorplanGeometry =>
    polygon(
      [
        [uMin, yTop],
        [uMax, yTop],
        [uMax, yBottom],
        [uMin, yBottom],
      ],
      boxStyle,
    )
  switch (f.feature) {
    case 'tree':
      primitives.push(...treePrimitives((uMin + uMax) / 2, f.spread ?? uMax - uMin, yBottom, yTop))
      break
    case 'column':
      primitives.push(outline())
      break
    case 'fence': {
      primitives.push(outline())
      // the top rail, then pickets down to the base
      primitives.push(
        line([uMin, yTop + RAIL_BAND], [uMax, yTop + RAIL_BAND], { stroke: ITEM_INK, strokeWidth: 0.006 }),
      )
      for (let u = uMin + PICKET_PITCH; u < uMax - PICKET_PITCH / 2; u += PICKET_PITCH) {
        primitives.push(line([u, yTop + RAIL_BAND], [u, yBottom], { stroke: ITEM_INK, strokeWidth: 0.004 }))
      }
      break
    }
    case 'stair': {
      primitives.push(outline())
      const risers = f.risers ?? 0
      for (let i = 1; i < risers; i++) {
        const y = yBottom + ((yTop - yBottom) * i) / risers
        primitives.push(line([uMin, y], [uMax, y], { stroke: ITEM_INK, strokeWidth: 0.004 }))
      }
      break
    }
  }
  return { depth, primitives }
}

export { INK as ITEM_STROKE_INK }
