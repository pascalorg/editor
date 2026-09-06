import type { FloorplanGeometry } from '@pascal-app/core'
import { projectItem } from './items'
import { padBounds, segmentInsidePolygon } from './math'
import {
  boundsFromPrimitives,
  drawY,
  gradeLine,
  levelDatums,
  makeProjector,
  type ProjectedPiece,
  type Projector,
  paintProjected,
  projectPrism,
  projectRoof,
  projectU,
  projectWall,
  roofDatums,
} from './projection'
import {
  type BuildingModel,
  buildBuildingModel,
  type PrismSolid,
  type RoofSolid,
  type WallLayer,
  type WallSolid,
} from './scene-model'
import {
  INK,
  line,
  PAPER,
  POCHE,
  POCHE_FINISH,
  POCHE_ROOF,
  POCHE_SHEATHING,
  POCHE_SLAB,
  polygon as polygonPrimitive,
  rectPolygon,
  WEIGHT,
} from './style'
import { type DrawingResult, type DrawingScene, EMPTY_BOUNDS, type Vec2 } from './types'

export type SectionSpec = {
  start: Vec2
  end: Vec2
  lookDirection: 'left' | 'right'
  depth: number
  label?: string
}

// Poché per assembly layer role (WS5's `WallAssemblyLayerRole`). The framing
// cavity is the heavy one; finishes and sheathing read as thin bands.
const LAYER_FILL: Record<WallLayer['role'], string> = {
  'exterior-finish': POCHE_FINISH,
  'air-gap': PAPER,
  sheathing: POCHE_SHEATHING,
  framing: POCHE,
  'interior-finish': POCHE_FINISH,
}

function cutSpans(
  spec: SectionSpec,
  view: Projector,
  polygon: readonly Vec2[],
): Array<{ u0: number; u1: number; tMid: number }> {
  const spans = segmentInsidePolygon(polygon, spec.start, spec.end)
  const dx = spec.end[0] - spec.start[0]
  const dz = spec.end[1] - spec.start[1]
  const at = (t: number): Vec2 => [spec.start[0] + dx * t, spec.start[1] + dz * t]
  return spans.flatMap(([t0, t1]) => {
    const a = at(t0)
    const b = at(t1)
    const uA = projectU(view, a[0], a[1])
    const uB = projectU(view, b[0], b[1])
    const u0 = Math.min(uA, uB)
    const u1 = Math.max(uA, uB)
    return u1 - u0 < 1e-5 ? [] : [{ u0, u1, tMid: (t0 + t1) / 2 }]
  })
}

/** The wall cut band, split into its assembly layers from the exterior face in. */
function wallCutBands(
  wall: WallSolid,
  view: Projector,
  u0: number,
  u1: number,
): Array<{ u0: number; u1: number; layer: WallLayer }> {
  const total = wall.layers.reduce((acc, layer) => acc + layer.thickness, 0) || wall.thickness
  const exteriorTowardsPlusU =
    wall.normal[0] * wall.exteriorSign * view.right[0] +
      wall.normal[1] * wall.exteriorSign * view.right[1] >=
    0
  const width = u1 - u0
  const bands: Array<{ u0: number; u1: number; layer: WallLayer }> = []
  let cursor = 0
  for (const layer of wall.layers) {
    const span = (layer.thickness / total) * width
    const a = exteriorTowardsPlusU ? u1 - cursor - span : u0 + cursor
    bands.push({ u0: a, u1: a + span, layer })
    cursor += span
  }
  return bands
}

function cutWall(spec: SectionSpec, view: Projector, wall: WallSolid): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const dx = spec.end[0] - spec.start[0]
  const dz = spec.end[1] - spec.start[1]
  for (const span of cutSpans(spec, view, wall.polygon)) {
    // Where along the wall's own axis this cut lands — that is what decides
    // whether the plane passes through an opening.
    const px = spec.start[0] + dx * span.tMid - wall.start[0]
    const pz = spec.start[1] + dz * span.tMid - wall.start[1]
    const alongWall = px * wall.axis[0] + pz * wall.axis[1]
    const hit = wall.openings.find(
      (opening) => Math.abs(alongWall - opening.along) < opening.width / 2,
    )
    const bands = wallCutBands(wall, view, span.u0, span.u1)
    const segments: Array<[number, number]> = hit
      ? [
          [wall.baseY, Math.max(wall.baseY, hit.sillY)],
          [Math.min(wall.topY, hit.headY), wall.topY],
        ]
      : [[wall.baseY, wall.topY]]
    for (const [bottom, top] of segments) {
      if (top - bottom < 1e-4) continue
      for (const band of bands) {
        out.push(
          polygonPrimitive(rectPolygon(band.u0, drawY(top), band.u1, drawY(bottom)), {
            // The cut cladding layer takes the cladding's real colour.
            fill:
              band.layer.role === 'exterior-finish' && wall.claddingColor
                ? wall.claddingColor
                : LAYER_FILL[band.layer.role],
            stroke: INK,
            strokeWidth: band.layer.role === 'framing' ? WEIGHT.cut : WEIGHT.cutLayer,
            strokeLinejoin: 'miter',
          }),
        )
      }
    }
    if (wall.underpinning) {
      // Below the base: the cladding layer down over the platform's rim, and
      // the stemwall under it across the wall's whole thickness.
      const { rimBottomY, stemBottomY } = wall.underpinning
      const cladding = bands.find((band) => band.layer.role === 'exterior-finish')
      if (cladding && wall.baseY - rimBottomY > 1e-4) {
        out.push(
          polygonPrimitive(
            rectPolygon(cladding.u0, drawY(wall.baseY), cladding.u1, drawY(rimBottomY)),
            {
              fill: wall.claddingColor ?? LAYER_FILL['exterior-finish'],
              stroke: INK,
              strokeWidth: WEIGHT.cutLayer,
              strokeLinejoin: 'miter',
            },
          ),
        )
      }
      if (rimBottomY - stemBottomY > 1e-4) {
        out.push(
          polygonPrimitive(rectPolygon(span.u0, drawY(rimBottomY), span.u1, drawY(stemBottomY)), {
            fill: POCHE_SLAB,
            stroke: INK,
            strokeWidth: WEIGHT.cut,
            strokeLinejoin: 'miter',
          }),
        )
      }
    }
    if (hit) {
      // Head and sill lines across the full band — the opening the plane
      // passes through reads as a void with its two horizontal members.
      for (const elevation of [hit.headY, hit.sillY]) {
        out.push(
          line([span.u0, drawY(elevation)], [span.u1, drawY(elevation)], {
            strokeWidth: WEIGHT.cut,
          }),
        )
      }
    }
  }
  return out
}

function cutPrism(spec: SectionSpec, view: Projector, prism: PrismSolid): FloorplanGeometry[] {
  return cutSpans(spec, view, prism.polygon).map((span) =>
    polygonPrimitive(rectPolygon(span.u0, drawY(prism.topY), span.u1, drawY(prism.bottomY)), {
      fill: prism.kind === 'slab' ? POCHE_SLAB : POCHE_FINISH,
      stroke: INK,
      strokeWidth: WEIGHT.cut,
      strokeLinejoin: 'miter',
    }),
  )
}

const ROOF_CUT_SAMPLES = 240

function cutRoof(spec: SectionSpec, view: Projector, roof: RoofSolid): FloorplanGeometry[] {
  const dx = spec.end[0] - spec.start[0]
  const dz = spec.end[1] - spec.start[1]
  const runs: Array<Array<{ u: number; top: number; bottom: number }>> = []
  let current: Array<{ u: number; top: number; bottom: number }> = []
  for (let i = 0; i <= ROOF_CUT_SAMPLES; i++) {
    const t = i / ROOF_CUT_SAMPLES
    const x = spec.start[0] + dx * t
    const z = spec.start[1] + dz * t
    const local = roof.toLocal(x, z)
    const inside =
      local[0] >= roof.local.minX &&
      local[0] <= roof.local.maxX &&
      local[1] >= roof.local.minZ &&
      local[1] <= roof.local.maxZ
    if (!inside) {
      if (current.length > 1) runs.push(current)
      current = []
      continue
    }
    const top = roof.originY + roof.surfaceY(local[0], local[1])
    current.push({ u: projectU(view, x, z), top, bottom: top - roof.deckDrop })
  }
  if (current.length > 1) runs.push(current)
  return runs.map((run) => {
    const points: Vec2[] = [
      ...run.map((sample): Vec2 => [sample.u, drawY(sample.top)]),
      ...run
        .slice()
        .reverse()
        .map((sample): Vec2 => [sample.u, drawY(sample.bottom)]),
    ]
    return polygonPrimitive(points, {
      fill: POCHE_ROOF,
      stroke: INK,
      strokeWidth: WEIGHT.cut,
      strokeLinejoin: 'miter',
    })
  })
}

/**
 * TRUE VECTOR building section, computed from the scene's own geometry.
 *
 * Two passes, in draw order:
 *  1. everything BEYOND the cut plane, out to `depth`, projected
 *     orthographically and painted back-to-front as opaque white silhouettes
 *     (polygon-level hidden-line removal — see the LIMIT note in
 *     `projection.ts`);
 *  2. everything the plane passes THROUGH, drawn heavy with assembly poché.
 *
 * Coordinates are DRAWING metres: x along the cut line from `start` (running
 * to the viewer's right), y = negated world elevation. See `types.ts`.
 */
export function buildSectionDrawing(
  scene: DrawingScene,
  args: SectionSpec | { markerId: string },
  model?: BuildingModel,
): DrawingResult {
  const spec = 'markerId' in args ? specFromMarker(scene, args.markerId) : args
  if (!spec) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: [`No section-marker node found for id ${(args as { markerId: string }).markerId}.`],
    }
  }
  const built = model ?? buildBuildingModel(scene.nodes)
  const warnings = [...built.warnings]

  const axis: Vec2 = [spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]]
  const length = Math.hypot(axis[0], axis[1])
  if (length < 1e-6) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: [...warnings, 'Section cut line has zero length.'],
    }
  }
  const unit: Vec2 = [axis[0] / length, axis[1] / length]
  // `left` of travel in plan (x right, z down) is (a.z, -a.x); `right` is its
  // negation. The projector derives the drawing's right axis from that, so a
  // right-looking section reads end→start — which is what a plan reader
  // expects when the arrows point the other way.
  const forward: Vec2 = spec.lookDirection === 'left' ? [unit[1], -unit[0]] : [-unit[1], unit[0]]
  const view = makeProjector(spec.start, forward, 0, Math.max(0.01, spec.depth))

  const projected: ProjectedPiece[] = []
  for (const wall of built.walls) {
    // Beyond the cut, walls read with their doors and windows; an exterior
    // face seen through the section is clad like the elevation shows it.
    const piece = projectWall(view, wall, { finish: true })
    if (piece) projected.push(piece)
  }
  for (const prism of built.prisms) {
    const piece = projectPrism(view, prism)
    if (piece) projected.push(piece)
  }
  for (const roof of built.roofs) {
    const piece = projectRoof(view, roof)
    if (piece) projected.push(piece)
  }
  // Furniture, fixtures and appliances beyond the cut plane, within the
  // section depth — the reference set shows the toilet, tub and cabinets in
  // its sections, and so does this one.
  for (const item of built.items) {
    const piece = projectItem(view, item)
    if (piece) projected.push(piece)
  }

  const cut: FloorplanGeometry[] = []
  for (const wall of built.walls) cut.push(...cutWall(spec, view, wall))
  for (const prism of built.prisms) cut.push(...cutPrism(spec, view, prism))
  for (const roof of built.roofs) cut.push(...cutRoof(spec, view, roof))

  const body = [...paintProjected(projected), ...cut]
  const bodyBounds = boundsFromPrimitives(body)
  const uMin = bodyBounds?.minX ?? 0
  const uMax = bodyBounds?.maxX ?? length

  const grade = gradeLine(built, view, uMin, uMax, Math.max(0.01, spec.depth) / 2)
  const primitives = [
    ...levelDatums(built, uMin, uMax),
    ...roofDatums(built, uMin, uMax),
    ...body,
    ...grade.primitives,
  ]

  const bounds = boundsFromPrimitives(primitives)
  if (!bounds) {
    return {
      primitives,
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: [...warnings, 'The cut line does not pass through any building geometry.'],
    }
  }
  return {
    primitives,
    bounds: padBounds(
      { minX: bounds.minX - 1.6, maxX: bounds.maxX + 2.6, minY: bounds.minY - 0.3, maxY: bounds.maxY + 0.3 },
      0.25,
    ),
    // bounds.y is negated elevation, so min/max swap back here.
    elevationRange: { min: -bounds.maxY, max: -bounds.minY },
    warnings,
  }
}

function specFromMarker(scene: DrawingScene, markerId: string): SectionSpec | null {
  const marker = scene.nodes[markerId as keyof typeof scene.nodes] as
    | {
        type?: string
        start?: [number, number]
        end?: [number, number]
        lookDirection?: 'left' | 'right'
        depth?: number
        label?: string
      }
    | undefined
  if (marker?.type !== 'section-marker') return null
  return {
    start: marker.start ?? [0, 0],
    end: marker.end ?? [1, 0],
    lookDirection: marker.lookDirection ?? 'left',
    depth: marker.depth ?? 12,
    label: marker.label,
  }
}
