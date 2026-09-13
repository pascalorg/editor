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
import type { FeatureSolid, GuardStyle, ItemSolid } from './scene-model'
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
    // no name on the box: a section reads its furniture as silhouettes, the
    // way the reference sets draw them (the fixture schedule names them)
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
    case 'ornament': {
      // a king post with two braces: the post from the base to the split
      // (56 % up, as the column builds it), the arms to the top corners
      // the braces span the ornament's PROJECTED width: the full Y seen face
      // on, a bare post seen edge on from the other elevations
      const o = f.ornament ?? { spread: uMax - uMin, braceWidth: 0.09 }
      const spread = Math.min(o.spread, uMax - uMin)
      const cx = (uMin + uMax) / 2
      const splitY = yBottom + (yTop - yBottom) * 0.56
      const w = o.braceWidth
      const bar = (a: Vec2, b: Vec2): FloorplanGeometry => {
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len = Math.hypot(dx, dy) || 1
        const nx = (-dy / len) * (w / 2)
        const ny = (dx / len) * (w / 2)
        return polygon(
          [
            [a[0] + nx, a[1] + ny],
            [b[0] + nx, b[1] + ny],
            [b[0] - nx, b[1] - ny],
            [a[0] - nx, a[1] - ny],
          ],
          boxStyle,
        )
      }
      primitives.push(bar([cx, yBottom], [cx, splitY]), bar([cx, splitY], [cx - spread / 2, yTop]), bar([cx, splitY], [cx + spread / 2, yTop]))
      break
    }
    case 'fence': {
      if (f.guard) primitives.push(...guardPrimitives(f.guard, uMin, uMax, yTop, yBottom))
      else {
        primitives.push(outline())
        primitives.push(
          line([uMin, yTop + RAIL_BAND], [uMax, yTop + RAIL_BAND], { stroke: ITEM_INK, strokeWidth: 0.006 }),
        )
        for (let u = uMin + PICKET_PITCH; u < uMax - PICKET_PITCH / 2; u += PICKET_PITCH) {
          primitives.push(line([u, yTop + RAIL_BAND], [u, yBottom], { stroke: ITEM_INK, strokeWidth: 0.004 }))
        }
      }
      break
    }
    case 'stair': {
      const flight = f.flight
      const uB = flight ? projectU(view, flight.bottom[0], flight.bottom[1]) : uMin
      const uT = flight ? projectU(view, flight.top[0], flight.top[1]) : uMax
      // seen from the side (the run crosses the view) the flight is its
      // profile — risers, treads, the stringer under them, the rail over
      // them; seen along its run it is the box with a riser line each step
      if (flight && Math.abs(uT - uB) > flight.run * 0.7) {
        primitives.push(...flightPrimitives(flight, uB, uT, yBottom, yTop))
      } else {
        primitives.push(outline())
        const risers = f.risers ?? 0
        for (let i = 1; i < risers; i++) {
          const y = yBottom + ((yTop - yBottom) * i) / risers
          primitives.push(line([uMin, y], [uMax, y], { stroke: ITEM_INK, strokeWidth: 0.004 }))
        }
      }
      break
    }
  }
  return { depth, primitives }
}

const BALUSTER = 0.038
const RAIL = 0.089
const CABLE_PITCH = 0.08
const BOARD = 0.14

/**
 * A guard drawn the way the fence node builds it: posts at their spacing
 * (a start post, an end post when the node says so), a cap over a top
 * rail, a bottom rail at its clearance, and the infill between the rails —
 * balusters at their gap, cables at 3 in, or horizontal boards. In the
 * guard's own colour; `yTop` is the top of the cap, `yBottom` the walking
 * surface (drawing y, down positive).
 */
function guardPrimitives(g: GuardStyle, uMin: number, uMax: number, yTop: number, yBottom: number): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const fill = g.color ?? PAPER
  const stroke = { stroke: ITEM_INK, strokeWidth: 0.004 }
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    polygon(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      { fill, ...stroke },
    )
  const width = uMax - uMin
  // posts: every `postSpacing` from the start, the last bay closed by the end post
  const bays = Math.max(1, Math.ceil((width - 1e-6) / g.postSpacing))
  const pitch = width / bays
  const posts: number[] = []
  if (g.startPost) posts.push(uMin)
  for (let i = 1; i < bays; i++) posts.push(uMin + i * pitch)
  if (g.endPost) posts.push(uMax - g.postSize)
  // rails: the cap on the top rail, the bottom rail at its clearance
  const capBottom = yTop + g.capThickness
  const topRailBottom = capBottom + RAIL
  const bottomRailTop = yBottom - g.bottomClearance - RAIL
  const bottomRailBottom = yBottom - g.bottomClearance
  out.push(rect(uMin, yTop, uMax, capBottom))
  out.push(rect(uMin, capBottom, uMax, topRailBottom))
  if (g.infill !== 'none') out.push(rect(uMin, bottomRailTop, uMax, bottomRailBottom))
  // infill between the rails
  if (g.infill === 'balusters') {
    const step = BALUSTER + g.slatGap
    for (let u = uMin + g.postSize + g.slatGap; u < uMax - g.postSize - BALUSTER; u += step) {
      out.push(rect(u, topRailBottom, u + BALUSTER, bottomRailTop))
    }
  } else if (g.infill === 'cable') {
    for (let y = topRailBottom + CABLE_PITCH; y < bottomRailTop - CABLE_PITCH / 2; y += CABLE_PITCH) {
      out.push(line([uMin, y], [uMax, y], { stroke: g.color ?? ITEM_INK, strokeWidth: 0.006 }))
    }
  } else if (g.infill === 'horizontal') {
    for (let y = topRailBottom + g.slatGap; y + BOARD < bottomRailTop + 1e-6; y += BOARD + g.slatGap) {
      out.push(rect(uMin, y, uMax, y + BOARD))
    }
  }
  // the posts stand over everything, from the walking surface to the cap
  for (const u of posts) out.push(rect(u, yTop, u + g.postSize, yBottom))
  return out
}

/** A 2x12 stringer's plumb depth under the nosing line. */
const STRINGER = 0.29
/** Handrail height over the nosings (R311.7.8: 34–38 in). */
const HANDRAIL = 0.9

/**
 * A flight seen from the side: the sawtooth of its risers and treads, the
 * stringer under the nosing line, and the rail over it — end posts, a rail
 * parallel to the nosings and the infill the porch guard uses.
 */
function flightPrimitives(
  flight: { rise: number; run: number; risers: number; thickness: number; rail: GuardStyle | null },
  uB: number,
  uT: number,
  yBottom: number,
  yTop: number,
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const n = Math.max(1, flight.risers)
  const dir = uT >= uB ? 1 : -1
  const tread = Math.abs(uT - uB) / n
  const riser = (yBottom - yTop) / n
  const profile: Vec2[] = [[uB, yBottom]]
  for (let i = 0; i < n; i++) {
    const u = uB + dir * i * tread
    const y = yBottom - (i + 1) * riser
    profile.push([u, y], [u + dir * tread, y])
  }
  // the stringer's underside runs parallel to the nosings, STRINGER below,
  // and lands on the ground at the bottom
  const slope = flight.run > 1e-6 ? flight.rise / flight.run : 0
  const landing = uB + dir * (slope > 1e-6 ? STRINGER / slope : 0)
  profile.push([uT, yTop + STRINGER], [landing, yBottom])
  out.push(polygon(profile, { fill: PAPER, stroke: ITEM_INK, strokeWidth: 0.008 }))
  // the rail: a post at each end, the rail over the nosings, the infill
  const rail = flight.rail
  if (rail && rail.infill !== 'none') {
    const fill = rail.color ?? PAPER
    const stroke = { stroke: ITEM_INK, strokeWidth: 0.004 }
    const railTop = (u: number) => yBottom - HANDRAIL - ((u - uB) / (uT - uB || 1)) * (yBottom - yTop)
    const nosing = (u: number) => yBottom - ((u - uB) / (uT - uB || 1)) * (yBottom - yTop)
    const post = rail.postSize
    for (const u of [uB, uT - dir * post]) {
      out.push(
        polygon(
          [
            [u, railTop(u + dir * post / 2)],
            [u + dir * post, railTop(u + dir * post / 2)],
            [u + dir * post, nosing(u + dir * post / 2)],
            [u, nosing(u + dir * post / 2)],
          ],
          { fill, ...stroke },
        ),
      )
    }
    out.push(
      polygon(
        [
          [uB, railTop(uB)],
          [uT, railTop(uT)],
          [uT, railTop(uT) + RAIL],
          [uB, railTop(uB) + RAIL],
        ],
        { fill, ...stroke },
      ),
    )
    if (rail.infill === 'balusters') {
      const step = BALUSTER + rail.slatGap
      for (let u = uB + dir * (post + rail.slatGap); dir * (uT - u) > post + BALUSTER; u += dir * step) {
        out.push(
          polygon(
            [
              [u, railTop(u) + RAIL],
              [u + dir * BALUSTER, railTop(u) + RAIL],
              [u + dir * BALUSTER, nosing(u)],
              [u, nosing(u)],
            ],
            { fill, ...stroke },
          ),
        )
      }
    } else if (rail.infill === 'cable') {
      for (let k = 1; k * CABLE_PITCH < HANDRAIL - RAIL; k++) {
        out.push(
          line([uB, railTop(uB) + RAIL + k * CABLE_PITCH], [uT, railTop(uT) + RAIL + k * CABLE_PITCH], {
            stroke: rail.color ?? ITEM_INK,
            strokeWidth: 0.006,
          }),
        )
      }
    } else if (rail.infill === 'horizontal') {
      for (let k = 0; k * (BOARD + rail.slatGap) + RAIL + BOARD < HANDRAIL; k++) {
        const off = RAIL + rail.slatGap + k * (BOARD + rail.slatGap)
        out.push(
          polygon(
            [
              [uB, railTop(uB) + off],
              [uT, railTop(uT) + off],
              [uT, railTop(uT) + off + BOARD],
              [uB, railTop(uB) + off + BOARD],
            ],
            { fill, ...stroke },
          ),
        )
      }
    }
  }
  return out
}

export { INK as ITEM_STROKE_INK }
