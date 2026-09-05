import type { FloorplanGeometry } from '@pascal-app/core'
import { padBounds } from './math'
import {
  boundsFromPrimitives,
  drawY,
  gradeLine,
  levelDatums,
  makeProjector,
  type ProjectedPiece,
  paintProjected,
  projectDepth,
  projectPrism,
  projectRoof,
  projectU,
  projectWall,
  roofDatums,
  wallSpan,
} from './projection'
import { projectItem } from './items'
import { FINISH_LABEL, type FinishKind } from './materials'
import { openingTag } from './openings'
import { openingCentreU } from './projection'
import { type BuildingModel, buildBuildingModel, type WallSolid } from './scene-model'
import { INK, label, line, WEIGHT } from './style'
import { type DrawingResult, type DrawingScene, EMPTY_BOUNDS, type Vec2 } from './types'

export type ElevationDirectionArg =
  | 'north'
  | 'east'
  | 'south'
  | 'west'
  | { angle: number }
  | { markerId: string }

/**
 * View azimuth in radians for a compass direction — the direction the viewer
 * LOOKS, measured in the XZ plane from +x toward +z. World convention is
 * x east, z south (WS1 contract), so the north viewer stands at -z and looks
 * toward +z.
 */
export function elevationAngle(direction: 'north' | 'east' | 'south' | 'west'): number {
  switch (direction) {
    case 'north':
      return Math.PI / 2
    case 'east':
      return Math.PI
    case 'south':
      return -Math.PI / 2
    default:
      return 0
  }
}

function resolveAngle(scene: DrawingScene, direction: ElevationDirectionArg): number | null {
  if (typeof direction === 'string') return elevationAngle(direction)
  if ('angle' in direction) return direction.angle
  const marker = scene.nodes[direction.markerId as keyof typeof scene.nodes] as
    | { type?: string; direction?: string; angle?: number }
    | undefined
  if (marker?.type !== 'elevation-marker') return null
  if (marker.direction && marker.direction !== 'custom') {
    return elevationAngle(marker.direction as 'north' | 'east' | 'south' | 'west')
  }
  return marker.angle ?? Math.PI / 2
}

function planPoints(model: BuildingModel): Vec2[] {
  const points: Vec2[] = []
  for (const wall of model.walls) points.push(...wall.polygon)
  for (const prism of model.prisms) points.push(...prism.polygon)
  for (const roof of model.roofs) points.push(...roof.polygon)
  return points
}

/**
 * TRUE VECTOR exterior elevation, computed from the scene's own geometry.
 *
 * Orthographic projection of the whole building along the view direction,
 * painted back-to-front with opaque silhouettes (polygon-level hidden-line
 * removal — see the LIMIT note in `projection.ts`), plus openings on the
 * faces that look at the viewer, the roof silhouette with its fascia line,
 * level / plate / ridge datums and the grade line.
 *
 * Coordinates are DRAWING metres: x along the view's right axis, y = negated
 * world elevation. See `types.ts`.
 */
export function buildElevationDrawing(
  scene: DrawingScene,
  direction: ElevationDirectionArg,
  model?: BuildingModel,
): DrawingResult {
  const angle = resolveAngle(scene, direction)
  if (angle === null) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: ['No elevation-marker node found for the requested id.'],
    }
  }
  const built = model ?? buildBuildingModel(scene.nodes)
  const warnings = [...built.warnings]
  const forward: Vec2 = [Math.cos(angle), Math.sin(angle)]

  // Depth slab wide enough to hold the whole building — an elevation clips
  // nothing, it just needs finite bounds for the projector's clipper.
  const probe = makeProjector([0, 0], forward, -1e9, 1e9)
  const points = planPoints(built)
  let depthMin = Number.POSITIVE_INFINITY
  let depthMax = Number.NEGATIVE_INFINITY
  for (const p of points) {
    const d = projectDepth(probe, p[0], p[1])
    if (d < depthMin) depthMin = d
    if (d > depthMax) depthMax = d
  }
  if (!Number.isFinite(depthMin)) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: [...warnings, 'Scene has no building geometry to draw an elevation from.'],
    }
  }
  const view = makeProjector([0, 0], forward, depthMin - 1, depthMax + 1)

  const projected: ProjectedPiece[] = []
  const finishesUsed = new Map<FinishKind | 'unspecified', number>()
  const finishColors = new Map<FinishKind, string>()
  const colorCounts = new Map<string, number>()
  const tags: FloorplanGeometry[] = []
  // Hidden-line for what the paint order does not cover: the walls are
  // painted back-to-front as opaque silhouettes, so a partition's door
  // behind the front wall is hidden on paper — but its tag, drawn on top of
  // everything, and its "no cladding" entry in the finish key were not. A
  // point on a wall counts as covered when a strictly nearer wall's span
  // holds it in u and in height.
  const spans = built.walls.map((wall) => ({ wall, span: wallSpan(view, wall) }))
  const covered = (self: WallSolid, u: number, y: number, depth: number): boolean =>
    spans.some(
      ({ wall, span }) =>
        wall !== self &&
        span !== null &&
        span.depth < depth - 1e-6 &&
        u > span.u[0] + 1e-6 &&
        u < span.u[1] - 1e-6 &&
        y > wall.baseY + 1e-6 &&
        y < wall.topY - 1e-6,
    )
  for (const { wall, span } of spans) {
    const piece = projectWall(view, wall, { finish: true })
    if (!piece || !span) continue
    projected.push(piece)
    const facing = wall.normal[0] * forward[0] + wall.normal[1] * forward[1]
    if (facing * wall.exteriorSign >= -0.3) continue
    const yMid = (wall.baseY + wall.topY) / 2
    const faceShows = [0.25, 0.5, 0.75].some(
      (t) => !covered(wall, span.u[0] + (span.u[1] - span.u[0]) * t, yMid, span.depth),
    )
    if (!faceShows) continue
    const key = wall.exteriorFinish ?? 'unspecified'
    finishesUsed.set(key, (finishesUsed.get(key) ?? 0) + 1)
    if (wall.exteriorFinish && wall.claddingColor) {
      finishColors.set(wall.exteriorFinish, wall.claddingColor)
      colorCounts.set(wall.claddingColor, (colorCounts.get(wall.claddingColor) ?? 0) + 1)
    }
    // Mark tags over the openings that actually show — the same D### / W###
    // the schedule prints.
    for (const opening of wall.openings) {
      const u = openingCentreU(view, wall, opening)
      if (covered(wall, u, (opening.sillY + opening.headY) / 2, span.depth)) continue
      tags.push(...openingTag(opening, u, drawY(opening.headY) - 0.09))
    }
  }
  // Whatever is placed in the scene, where it stands: trees, the condenser,
  // furniture behind glass — boxes at their real size, hidden by nearer walls.
  for (const item of built.items) {
    const piece = projectItem(view, item)
    if (piece) projected.push(piece)
  }
  for (const prism of built.prisms) {
    // A slab's edge is only worth showing where it is exposed; drawing every
    // interior slab as a full-width band would black out the elevation.
    if (prism.kind === 'ceiling') continue
    const piece = projectPrism(view, prism)
    if (piece) projected.push(piece)
  }
  // The gable ends are clad like the walls: use the finish most of the
  // visible walls declare (null when none declares one).
  let gableFinish: FinishKind | null = null
  let gableCount = 0
  for (const [finish, count] of finishesUsed) {
    if (finish !== 'unspecified' && count > gableCount) {
      gableFinish = finish
      gableCount = count
    }
  }
  let gableColor: string | null = null
  let gableColorCount = 0
  for (const [color, count] of colorCounts) {
    if (count > gableColorCount) {
      gableColor = color
      gableColorCount = count
    }
  }
  const roofDetail: FloorplanGeometry[] = []
  for (const roof of built.roofs) {
    const piece = projectRoof(view, roof, { courses: true, gableFinish, gableColor, pitchFlag: true })
    if (!piece) continue
    projected.push(piece)
    // Fascia / eave line — only meaningful when the eave edge runs across the
    // view (the segment's down-slope axis pointing at or away from us).
    const alignment = Math.abs(roof.axisZ[0] * view.forward[0] + roof.axisZ[1] * view.forward[1])
    if (alignment > 0.7) {
      const corners: Vec2[] = [
        roof.toWorld(roof.local.minX, roof.local.minZ),
        roof.toWorld(roof.local.maxX, roof.local.minZ),
        roof.toWorld(roof.local.maxX, roof.local.maxZ),
        roof.toWorld(roof.local.minX, roof.local.maxZ),
      ]
      const us = corners.map((c) => projectU(view, c[0], c[1]))
      roofDetail.push(
        line([Math.min(...us), drawY(roof.eaveY)], [Math.max(...us), drawY(roof.eaveY)], {
          stroke: INK,
          strokeWidth: WEIGHT.detail,
        }),
      )
    }
  }

  const body = [...paintProjected(projected), ...roofDetail]
  const bodyBounds = boundsFromPrimitives(body)
  if (!bodyBounds) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      elevationRange: { min: 0, max: 0 },
      warnings: [...warnings, 'Nothing projected into this elevation.'],
    }
  }
  const grade = gradeLine(built, view, bodyBounds.minX, bodyBounds.maxX, (depthMin + depthMax) / 2)

  // EXTERIOR FINISH KEY — what the patterns on this elevation stand for,
  // listed from the assemblies actually facing the viewer. A wall with no
  // assembly is called out as unspecified rather than dressed in a default.
  const keyLines: string[] = []
  for (const [finish] of [...finishesUsed.entries()].sort((a, b) => b[1] - a[1])) {
    keyLines.push(finish === 'unspecified' ? 'WALLS: NO CLADDING SPECIFIED (set the wall assembly)' : FINISH_LABEL[finish])
  }
  if (built.roofs.length > 0) {
    keyLines.push('ROOF: ASPHALT SHINGLES (assumed — roof material not modelled)')
  }
  if (finishesUsed.has('unspecified')) {
    warnings.push(
      `${finishesUsed.get('unspecified')} visible wall(s) have no assembly — drawn without a cladding pattern.`,
    )
  }
  const keyTop = -grade.minElevation + 0.55
  const keyFinishes = [...finishesUsed.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  const finishKey: FloorplanGeometry[] = keyLines.flatMap((text, i) => {
    const finish = keyFinishes[i]
    const swatch =
      finish && finish !== 'unspecified' ? finishColors.get(finish) ?? null : i === keyLines.length - 1 && built.roofs.length > 0 ? (built.roofs[0]?.color ?? null) : null
    const y = keyTop + i * 0.22
    return [
      label(bodyBounds.minX, y, `${i + 1}`, { fontSize: 0.14, fontWeight: 700 }),
      ...(swatch
        ? [
            {
              kind: 'rect',
              x: bodyBounds.minX + 0.26,
              y: y - 0.13,
              width: 0.18,
              height: 0.14,
              fill: swatch,
              stroke: INK,
              strokeWidth: WEIGHT.detail,
            } as FloorplanGeometry,
          ]
        : []),
      label(bodyBounds.minX + (swatch ? 0.52 : 0.3), y, text, { fontSize: 0.14 }),
    ]
  })
  if (keyLines.length > 0) {
    finishKey.unshift(
      label(bodyBounds.minX, keyTop - 0.24, 'EXTERIOR FINISH KEY', { fontSize: 0.15, fontWeight: 700 }),
    )
  }

  const primitives = [
    ...levelDatums(built, bodyBounds.minX, bodyBounds.maxX),
    ...roofDatums(built, bodyBounds.minX, bodyBounds.maxX),
    ...body,
    ...grade.primitives,
    ...tags,
    ...finishKey,
  ]
  const raw = boundsFromPrimitives(primitives) ?? EMPTY_BOUNDS
  // Text has no geometric extent here: leave room for the datum labels
  // (right), the GRADE label (left) and the finish key (below).
  const bounds = {
    minX: raw.minX - 1.6,
    maxX: raw.maxX + 2.6,
    minY: raw.minY - 0.3,
    maxY: raw.maxY + 0.5,
  }
  return {
    primitives,
    bounds: padBounds(bounds, 0.25),
    elevationRange: { min: -bounds.maxY, max: -bounds.minY },
    warnings,
  }
}
