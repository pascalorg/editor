import { refuse } from '../agent-tools/refusal'
import type { TerrainBreakNode } from '../schema/nodes/terrain-break'
import { TERRAIN_TILE_SIZE } from '../schema/nodes/terrain-tile'
import {
  isolatedTerrainPlaneFlagged,
  isolatedTriangleFlags,
  type TerrainBreakSide,
  terrainBreakSideAt,
  terrainBreaksOf,
} from './terrain-breaks'
import {
  DEFAULT_TERRAIN_SPACING,
  DEFAULT_TERRAIN_STEP,
  heightAt,
  heightAtSample,
  type TerrainField,
} from './terrain-field'
import {
  type GradedSample,
  gradedSamplesOf,
  insideRampCut,
  type RampCut,
  rampCutOf,
  rampsGradingOf,
} from './terrain-ramp-cut'
import { type TerrainNodes, type TerrainSite, terrainTilesOf, tileFieldOf } from './terrain-tiles'

/** Border value and outward slope decay to the source-derived context plane at 64m. */
export const TERRAIN_CONTINUATION_DISTANCE = 64
/** Flat sites and tile-only sites have no legacy relief from which to infer context. */
export const TERRAIN_CONTEXT_HEIGHT = 0

/** Frozen legacy minimum, capped at datum; tile edits and lot resizing never move it. */
export function terrainContextHeightOf(base: TerrainField | null): number {
  if (base?.contextHeight !== undefined) return base.contextHeight
  let minimum = TERRAIN_CONTEXT_HEIGHT
  if (base) for (const sample of base.heights) minimum = Math.min(minimum, sample * base.step)
  return minimum
}

type TileField = { ix: number; iz: number; field: TerrainField }
type Border = { x: number; z: number; distance: number }

function borderOf(field: TerrainField, x: number, z: number): Border {
  const bx = Math.max(
    field.origin[0],
    Math.min(x, field.origin[0] + (field.cols - 1) * field.spacing),
  )
  const bz = Math.max(
    field.origin[1],
    Math.min(z, field.origin[1] + (field.rows - 1) * field.spacing),
  )
  return { x: bx, z: bz, distance: Math.hypot(x - bx, z - bz) }
}

function tileCoordinates(value: number): number[] {
  const index = Math.floor(value / TERRAIN_TILE_SIZE)
  return value === index * TERRAIN_TILE_SIZE ? [index - 1, index] : [index]
}

function tileAt(tiles: Map<string, TileField>, x: number, z: number): TileField | undefined {
  for (const ix of tileCoordinates(x)) {
    for (const iz of tileCoordinates(z)) {
      const tile = tiles.get(`${ix},${iz}`)
      if (tile) return tile
    }
  }
  return undefined
}

function tileSample(
  tiles: Map<string, TileField>,
  tile: TileField,
  col: number,
  row: number,
): number {
  const x = tile.field.origin[0] + col * tile.field.spacing
  const z = tile.field.origin[1] + row * tile.field.spacing
  const owner = tileAt(tiles, x, z) ?? tile
  return heightAtSample(
    owner.field,
    (x - owner.field.origin[0]) / owner.field.spacing,
    (z - owner.field.origin[1]) / owner.field.spacing,
  )
}

function tileHeight(tiles: Map<string, TileField>, tile: TileField, x: number, z: number): number {
  const field = tile.field
  const u = Math.max(0, Math.min(field.cols - 1, (x - field.origin[0]) / field.spacing))
  const v = Math.max(0, Math.min(field.rows - 1, (z - field.origin[1]) / field.spacing))
  const col = Math.min(field.cols - 2, Math.floor(u))
  const row = Math.min(field.rows - 2, Math.floor(v))
  const tc = u - col
  const tr = v - row
  const h00 = tileSample(tiles, tile, col, row)
  const h10 = tileSample(tiles, tile, col + 1, row)
  const h01 = tileSample(tiles, tile, col, row + 1)
  const h11 = tileSample(tiles, tile, col + 1, row + 1)
  return tc + tr <= 1
    ? h00 + (h10 - h00) * tc + (h01 - h00) * tr
    : h11 + (h01 - h11) * (1 - tc) + (h10 - h11) * (1 - tr)
}

function continuedHeight(
  field: TerrainField,
  read: (x: number, z: number) => number,
  x: number,
  z: number,
  border: Border,
  contextHeight: number,
): number {
  const dx = x - border.x
  const dz = z - border.z
  const h = read(border.x, border.z)
  const slopeX =
    dx === 0
      ? 0
      : (Math.sign(dx) * (h - read(border.x - Math.sign(dx) * field.spacing, border.z))) /
        field.spacing
  const slopeZ =
    dz === 0
      ? 0
      : (Math.sign(dz) * (h - read(border.x, border.z - Math.sign(dz) * field.spacing))) /
        field.spacing
  const t = border.distance / TERRAIN_CONTINUATION_DISTANCE
  return (
    contextHeight +
    (h - contextHeight) * (1 - 3 * t * t + 2 * t * t * t) +
    (slopeX * dx + slopeZ * dz) * (1 - t) * (1 - t)
  )
}

function continuation(
  sources: { field: TerrainField; read: (x: number, z: number) => number }[],
  x: number,
  z: number,
  contextHeight: number,
): number {
  const candidates = sources
    .map((source) => ({ source, border: borderOf(source.field, x, z) }))
    .filter(({ border }) => border.distance < TERRAIN_CONTINUATION_DISTANCE)
  let nearestDistance = TERRAIN_CONTINUATION_DISTANCE
  for (const { source, border } of candidates) {
    if (border.distance === 0) return source.read(x, z)
    nearestDistance = Math.min(nearestDistance, border.distance)
  }
  let weighted = 0
  let weightSum = 0
  for (const { source, border } of candidates) {
    // Inverse-distance blending avoids a bisector seam between disconnected authored tiles.
    const weight =
      ((1 - border.distance / TERRAIN_CONTINUATION_DISTANCE) *
        (nearestDistance / border.distance)) **
      2
    weighted += continuedHeight(source.field, source.read, x, z, border, contextHeight) * weight
    weightSum += weight
  }
  return weightSum > 0 ? weighted / weightSum : contextHeight
}

function boundsSources(tiles: Map<string, TileField>, base: TerrainField | null): BoundsSource[] {
  const sources: BoundsSource[] = [...tiles.values()].map((tile) => ({
    field: tile.field,
    exposed: [
      !tiles.has(`${tile.ix - 1},${tile.iz}`),
      !tiles.has(`${tile.ix + 1},${tile.iz}`),
      !tiles.has(`${tile.ix},${tile.iz - 1}`),
      !tiles.has(`${tile.ix},${tile.iz + 1}`),
    ],
    notch: [
      !tiles.has(`${tile.ix - 1},${tile.iz - 1}`),
      !tiles.has(`${tile.ix + 1},${tile.iz - 1}`),
      !tiles.has(`${tile.ix - 1},${tile.iz + 1}`),
      !tiles.has(`${tile.ix + 1},${tile.iz + 1}`),
    ],
  }))
  if (base) sources.push({ field: base, exposed: [true, true, true, true] })
  return sources
}

function unionExtent(site: TerrainSite, fields: TerrainField[]) {
  const points: (readonly [number, number])[] = [...(site.polygon?.points ?? [])]
  for (const field of fields) {
    points.push(field.origin, [
      field.origin[0] + (field.cols - 1) * field.spacing,
      field.origin[1] + (field.rows - 1) * field.spacing,
    ])
  }
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  minX = Math.floor(minX / DEFAULT_TERRAIN_SPACING)
  minZ = Math.floor(minZ / DEFAULT_TERRAIN_SPACING)
  maxX = Math.ceil(maxX / DEFAULT_TERRAIN_SPACING)
  maxZ = Math.ceil(maxZ / DEFAULT_TERRAIN_SPACING)
  return {
    origin: [minX * DEFAULT_TERRAIN_SPACING, minZ * DEFAULT_TERRAIN_SPACING] as const,
    cols: maxX - minX + 1,
    rows: maxZ - minZ + 1,
  }
}

function authorityHeightBounds(fields: TerrainField[]): readonly [number, number] {
  let lo = TERRAIN_CONTEXT_HEIGHT
  let hi = TERRAIN_CONTEXT_HEIGHT
  let smallestSpacing = Number.POSITIVE_INFINITY
  for (const field of fields) {
    smallestSpacing = Math.min(smallestSpacing, field.spacing)
    for (const sample of field.heights) {
      lo = Math.min(lo, sample * field.step)
      hi = Math.max(hi, sample * field.step)
    }
  }
  // d(1-d/N)² peaks at 4N/27; both outward slope components fit this envelope.
  const slopeRelief =
    (((hi - lo) / smallestSpacing) * Math.SQRT2 * TERRAIN_CONTINUATION_DISTANCE * 4) / 27
  return [lo - slopeRelief, hi + slopeRelief]
}

/** The slope term's range over the quadrant of directions a corner sample continues into. */
function quadrantSlope(gx: number, gz: number): [number, number] {
  const upper = gx >= 0 && gz >= 0 ? Math.hypot(gx, gz) : Math.max(gx, gz)
  const lower = gx <= 0 && gz <= 0 ? -Math.hypot(gx, gz) : Math.min(gx, gz)
  return [lower, upper]
}

const T_STEPS = 64

type BoundsSource = {
  field: TerrainField
  /** Which sides no neighbouring tile covers: west, east, north, south (x-, x+, z-, z+). */
  exposed: readonly [boolean, boolean, boolean, boolean]
  /** Corners (nw, ne, sw, se) with no tile diagonally beyond them, though both sides are shared. */
  notch?: readonly [boolean, boolean, boolean, boolean]
}

/**
 * The tightest bounds the authority's own formulas allow, not a worst case over the slope.
 *
 * Inside a source's rectangle the ground is one of its samples (or a plane through three).
 * Outside, `continuation` blends, with positive weights, each source's continued value, so its
 * range is inside the union of the sources' own: from a border sample of height h, outward slope
 * g and distance t of 64 m, `continuedHeight` is ctx + (h - ctx)(1 - 3t² + 2t³) + g·64·t(1 - t)²,
 * linear in (h, g) for a fixed t and the border's h and g linear between samples, so its extremes
 * are at the lattice samples of the border. Only a side no neighbouring tile covers is a border
 * ground continues from: past a shared side the ground is the neighbour's own samples, and the
 * weights give a tile behind another next to nothing. `slopeRelief` before was the largest slope
 * the quantisation could hold times the full distance: a ±160 m envelope for 6 m of relief.
 */
function tightHeightBounds(sources: BoundsSource[], contextHeight: number): [number, number] {
  let lo = Math.min(TERRAIN_CONTEXT_HEIGHT, contextHeight)
  let hi = TERRAIN_CONTEXT_HEIGHT
  for (const { field, exposed, notch } of sources) {
    for (const sample of field.heights) {
      lo = Math.min(lo, sample * field.step)
      hi = Math.max(hi, sample * field.step)
    }
    const { cols, rows, spacing, step, heights } = field
    if (cols < 2 || rows < 2) continue
    const at = (c: number, r: number) => (heights[r * cols + c] ?? 0) * step
    const reach = (h: number, gLow: number, gHigh: number) => {
      for (let k = 0; k <= T_STEPS; k++) {
        const t = k / T_STEPS
        const blend = contextHeight + (h - contextHeight) * (1 - 3 * t * t + 2 * t * t * t)
        const slope = TERRAIN_CONTINUATION_DISTANCE * t * (1 - t) * (1 - t)
        lo = Math.min(lo, blend + gLow * slope)
        hi = Math.max(hi, blend + gHigh * slope)
      }
    }
    const [west, east, north, south] = exposed
    const [nw, ne, sw, se] = notch ?? [false, false, false, false]
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const corner =
          (nw && c === 0 && r === 0) ||
          (ne && c === cols - 1 && r === 0) ||
          (sw && c === 0 && r === rows - 1) ||
          (se && c === cols - 1 && r === rows - 1)
        const onWest = (west || corner) && c === 0
        const onEast = (east || corner) && c === cols - 1
        const onNorth = (north || corner) && r === 0
        const onSouth = (south || corner) && r === rows - 1
        if (!(onWest || onEast || onNorth || onSouth)) continue
        const h = at(c, r)
        // Outward slopes along x and z, where this sample is on that side's border.
        const gx = onWest
          ? (h - at(1, r)) / spacing
          : onEast
            ? (h - at(cols - 2, r)) / spacing
            : undefined
        const gz = onNorth
          ? (h - at(c, 1)) / spacing
          : onSouth
            ? (h - at(c, rows - 2)) / spacing
            : undefined
        if (gx !== undefined && gz !== undefined) {
          const [low, high] = quadrantSlope(gx, gz)
          reach(h, low, high)
        } else {
          const g = (gx ?? gz) as number
          reach(h, g, g)
        }
      }
  }
  // The tiles behind another contribute a sliver of their own continuation, weights near zero.
  const pad = 0.01 + 0.01 * (hi - lo)
  return [lo - pad, hi + pad]
}

type BreakAuthority = {
  breaks: TerrainBreakNode[]
  tiles: Map<string, TileField>
  base: TerrainField | null
  contextByRegion: Map<string, number>
  fallback?: BreakAuthority
}
type Source = { field: TerrainField; read: (x: number, z: number) => number }
const breakAuthorities = new WeakMap<TerrainField, BreakAuthority>()
/** The two grounds a ramp-cut authority is made of, so a live preview can be made of both. */
const rampCutHalves = new WeakMap<
  TerrainField,
  { graded: TerrainField; natural: TerrainField; cuts: readonly RampCut[] }
>()
/** Authorities whose bounds are the true ones (tiles or breaks), not the legacy envelope. */
const tightBounds = new WeakSet<TerrainField>()

function breakSidesAt(breaks: TerrainBreakNode[], x: number, z: number): TerrainBreakSide[] {
  return breaks.map((boundary) => terrainBreakSideAt(boundary, x, z))
}

function regionContext(
  authority: BreakAuthority,
  sides: TerrainBreakSide[],
  accepts: (x: number, z: number) => boolean,
): number {
  const key = sides.join(',')
  const cached = authority.contextByRegion.get(key)
  if (cached !== undefined) return cached
  let context = 0
  const base = authority.base
  if (base) {
    for (let r = 0; r < base.rows; r++) {
      for (let c = 0; c < base.cols; c++) {
        if (accepts(base.origin[0] + c * base.spacing, base.origin[1] + r * base.spacing))
          context = Math.min(context, (base.heights[r * base.cols + c] ?? 0) * base.step)
      }
    }
  }
  authority.contextByRegion.set(key, context)
  return context
}

const KEEP_GROUND_MESSAGE =
  'Keep-ground needs a same-side source triangle within 32 grid cells; widen the ground region or give a numeric side.'

/**
 * The triangle tables of a grid, kept for as long as the grid and the breaks are the same
 * objects: editing one tile builds the authority again, and the other 23 tiles' tables are
 * still the tables of their own region.
 */
const flagTables = new WeakMap<
  TerrainField,
  { breaks: readonly TerrainBreakNode[]; regions: Map<string, Uint8Array> }
>()

function regionFlags(
  authority: BreakAuthority,
  field: TerrainField,
  sides: TerrainBreakSide[],
  accepts: (x: number, z: number) => boolean,
): Uint8Array {
  let entry = flagTables.get(field)
  const { breaks } = authority
  if (
    !entry ||
    entry.breaks.length !== breaks.length ||
    entry.breaks.some((boundary, index) => boundary !== breaks[index])
  ) {
    entry = { breaks, regions: new Map() }
    flagTables.set(field, entry)
  }
  const key = sides.join(',')
  let flags = entry.regions.get(key)
  if (!flags) {
    flags = isolatedTriangleFlags(field, accepts, breaks)
    entry.regions.set(key, flags)
  }
  return flags
}

function isolatedSources(
  authority: BreakAuthority,
  sides: TerrainBreakSide[],
  accepts: (x: number, z: number) => boolean,
  x: number,
  z: number,
): Source[] {
  const { tiles, base } = authority
  const sources: Source[] = []
  const add = (field: TerrainField, sample?: (c: number, r: number) => number) => {
    const flags = regionFlags(authority, field, sides, accepts)
    if (isolatedTerrainPlaneFlagged(field, flags, x, z, sample))
      sources.push({
        field,
        read: (px, pz) => {
          const plane = isolatedTerrainPlaneFlagged(field, flags, px, pz, sample)
          if (plane) return plane(px, pz)
          refuse('unsupported_geometry', KEEP_GROUND_MESSAGE)
        },
      })
  }
  for (const tile of tiles.values()) add(tile.field, (c, r) => tileSample(tiles, tile, c, r))
  if (base) add(base)
  return sources
}

function regionGround(
  authority: BreakAuthority,
  sides: TerrainBreakSide[],
  x: number,
  z: number,
): number {
  const { breaks, tiles, base } = authority
  if (authority.fallback && base && borderOf(base, x, z).distance > 0)
    return regionGround(authority.fallback, sides, x, z)
  const accepts = (px: number, pz: number) => {
    for (let i = 0; i < breaks.length; i++)
      if (terrainBreakSideAt(breaks[i] as TerrainBreakNode, px, pz) !== sides[i]) return false
    return true
  }
  // A point a tile covers reads that tile's source triangle alone: the other tiles' planes were
  // searched for and never read.
  const tile = tileAt(tiles, x, z)
  if (tile) {
    const plane = isolatedTerrainPlaneFlagged(
      tile.field,
      regionFlags(authority, tile.field, sides, accepts),
      x,
      z,
      (c, r) => tileSample(tiles, tile, c, r),
    )
    if (plane) return plane(x, z)
    refuse(
      'unsupported_geometry',
      'The covering terrain tile has no same-region source triangle for keep-ground.',
    )
  }
  if (base && borderOf(base, x, z).distance === 0) {
    const plane = isolatedTerrainPlaneFlagged(
      base,
      regionFlags(authority, base, sides, accepts),
      x,
      z,
    )
    if (plane) return plane(x, z)
    refuse('unsupported_geometry', KEEP_GROUND_MESSAGE)
  }
  const sources = isolatedSources(authority, sides, accepts, x, z)
  return continuation(sources, x, z, regionContext(authority, sides, accepts))
}

function regionHeight(
  authority: BreakAuthority,
  sides: TerrainBreakSide[],
  x: number,
  z: number,
): number {
  for (let i = authority.breaks.length - 1; i >= 0; i--) {
    const boundary = authority.breaks[i]
    const side = sides[i]
    if (!boundary || !side) continue
    const value = boundary[side]
    if (typeof value === 'number') return value
  }
  return regionGround(authority, sides, x, z)
}

function breakSideHeight(
  authority: BreakAuthority,
  boundary: TerrainBreakNode,
  side: TerrainBreakSide,
  x: number,
  z: number,
): number {
  const sides = breakSidesAt(authority.breaks, x, z)
  const index = authority.breaks.findIndex((candidate) => candidate.id === boundary.id)
  if (index >= 0) sides[index] = side
  return regionHeight(authority, sides, x, z)
}

const PROBE_OFFSETS = [0.02, 0.25, 0.6, 1.2]

function probeBreakBounds(field: TerrainField, breaks: TerrainBreakNode[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  const read = field.readHeightAt
  if (!read) return [lo, hi]
  for (const boundary of breaks) {
    for (let i = 0; i < boundary.line.length - 1; i++) {
      const a = boundary.line[i] as [number, number]
      const b = boundary.line[i + 1] as [number, number]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 1e-9) continue
      const nx = (b[1] - a[1]) / length
      const nz = -(b[0] - a[0]) / length
      const count = Math.max(1, Math.ceil(length / field.spacing))
      for (let k = 0; k <= count; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / count
        const z = a[1] + ((b[1] - a[1]) * k) / count
        for (const offset of PROBE_OFFSETS)
          for (const sign of [-1, 1]) {
            try {
              const value = read(x + nx * offset * sign, z + nz * offset * sign)
              lo = Math.min(lo, value)
              hi = Math.max(hi, value)
            } catch {
              // a side with no source triangle refuses; there is no height to bound
            }
          }
      }
    }
  }
  return [lo, hi]
}

function withTerrainBreaks(
  field: TerrainField,
  breaks: TerrainBreakNode[],
  tiles: Map<string, TileField>,
  base: TerrainField | null,
  fallback?: BreakAuthority,
): TerrainField {
  if (!breaks.length) return field
  const authority: BreakAuthority = {
    breaks,
    tiles,
    base,
    contextByRegion: new Map(),
    fallback,
  }
  const numeric = breaks.flatMap((boundary) =>
    [boundary.left, boundary.right].filter((value): value is number => typeof value === 'number'),
  )
  const bounds = field.heightBounds ?? [0, 0]
  const result: TerrainField & { heightBounds: [number, number] } = {
    ...field,
    terrainBreaks: breaks,
    heightBounds: [Math.min(bounds[0], ...numeric), Math.max(bounds[1], ...numeric)],
    readHeightAt: (x, z) => regionHeight(authority, breakSidesAt(breaks, x, z), x, z),
    readHeightInRegion: (ox, oz, x, z) =>
      regionHeight(authority, breakSidesAt(breaks, ox, oz), x, z),
    readHeightOnSide: (boundary, side, x, z) => breakSideHeight(authority, boundary, side, x, z),
  }
  // Ground kept beside a break is read from a plane through the nearest same-side triangle, which
  // runs a little past its samples: take the reads along each break, both sides, into the bounds.
  if (!fallback) {
    const probed = probeBreakBounds(result, breaks)
    result.heightBounds = [
      Math.min(result.heightBounds[0], probed[0]),
      Math.max(result.heightBounds[1], probed[1]),
    ]
  }
  breakAuthorities.set(result, authority)
  return result
}

function authorityOver(
  site: TerrainSite,
  base: TerrainField | null,
  tiles: Map<string, TileField>,
  breaks: TerrainBreakNode[],
): TerrainField | null {
  if (!base && tiles.size === 0 && !breaks.length) return null
  const contextHeight = terrainContextHeightOf(base)
  const sources = [...tiles.values()].map((tile) => ({
    field: tile.field,
    read: (x: number, z: number) => tileHeight(tiles, tile, x, z),
  }))
  if (base) sources.push({ field: base, read: (x, z) => heightAt(base, x, z) })
  const unchangedLayout =
    base &&
    tiles.size === 0 &&
    (site.polygon?.points ?? []).every(([x, z]) => borderOf(base, x, z).distance === 0)
  const fields = sources.map((source) => source.field)
  const extentSite = breaks.length
    ? {
        ...site,
        polygon: {
          type: 'polygon' as const,
          points: [...(site.polygon?.points ?? []), ...breaks.flatMap((boundary) => boundary.line)],
        },
      }
    : site
  const field: TerrainField = {
    ...(unchangedLayout
      ? {
          origin: base.origin,
          cols: base.cols,
          rows: base.rows,
        }
      : unionExtent(extentSite, fields)),
    spacing: unchangedLayout ? base.spacing : DEFAULT_TERRAIN_SPACING,
    step: base?.step ?? sources[0]?.field.step ?? DEFAULT_TERRAIN_STEP,
    heights: unchangedLayout ? base.heights : new Int16Array(0),
    // A lot of legacy ground alone keeps the bounds it always had; tiles and breaks get true ones.
    heightBounds:
      tiles.size > 0 || breaks.length > 0
        ? tightHeightBounds(boundsSources(tiles, base), contextHeight)
        : authorityHeightBounds(fields),
    contextHeight,
    readHeightAt: (x, z) => {
      const tile = tileAt(tiles, x, z)
      if (tile) return tileHeight(tiles, tile, x, z)
      if (base && borderOf(base, x, z).distance === 0) return heightAt(base, x, z)
      return continuation(sources, x, z, contextHeight)
    },
  }
  const authority = withTerrainBreaks(field, breaks, tiles, base)
  if (tiles.size > 0 || breaks.length > 0) tightBounds.add(authority)
  return authority
}

/** The tiles with the ramps' graded samples put back, or null when none is still as graded. */
function tilesBeforeGrading(
  tiles: Map<string, TileField>,
  samples: readonly GradedSample[],
): Map<string, TileField> | null {
  const heights = new Map<string, Int16Array>()
  const owners = (coordinate: number) => {
    const index = Math.floor(coordinate / TERRAIN_TILE_SIZE)
    return coordinate === index * TERRAIN_TILE_SIZE ? [index - 1, index] : [index]
  }
  for (const { x, z, previousM, appliedM } of samples) {
    for (const ix of owners(x)) {
      for (const iz of owners(z)) {
        const key = `${ix},${iz}`
        const tile = tiles.get(key)
        if (!tile) continue
        const { field } = tile
        const col = (x - field.origin[0]) / field.spacing
        const row = (z - field.origin[1]) / field.spacing
        if (!Number.isInteger(col) || !Number.isInteger(row)) continue
        if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) continue
        const index = row * field.cols + col
        // Ground sculpted since the grading is the person's own and stays.
        if (Math.abs((field.heights[index] ?? 0) * field.step - appliedM) > field.step / 2) continue
        let own = heights.get(key)
        if (!own) {
          own = new Int16Array(field.heights)
          heights.set(key, own)
        }
        own[index] = Math.max(-32768, Math.min(32767, Math.round(previousM / field.step)))
      }
    }
  }
  if (!heights.size) return null
  const before = new Map(tiles)
  for (const [key, own] of heights) {
    const tile = tiles.get(key) as TileField
    before.set(key, { ...tile, field: { ...tile.field, heights: own } })
  }
  return before
}

/**
 * The ground beside a graded ramp is the natural ground, read up to the corridor's own edge; the
 * corridor keeps the graded samples. Without this a lattice triangle that straddles the edge
 * mixes lowered and natural samples, and every reader (the mesh, the pointer ray, the lawn, the
 * normals) sees the ground dip toward the roadway by up to a cell along a curved edge.
 */
function withRampCuts(
  graded: TerrainField,
  natural: TerrainField,
  cuts: readonly RampCut[],
): TerrainField {
  const inGradedCorridor = (x: number, z: number) => cuts.some((cut) => insideRampCut(cut, x, z))
  const bounds: [number, number] = [
    Math.min(graded.heightBounds?.[0] ?? 0, natural.heightBounds?.[0] ?? 0),
    Math.max(graded.heightBounds?.[1] ?? 0, natural.heightBounds?.[1] ?? 0),
  ]
  const gradedOnSide = graded.readHeightOnSide
  const naturalOnSide = natural.readHeightOnSide
  const read = (field: TerrainField, x: number, z: number) =>
    (field.readHeightAt as (x: number, z: number) => number)(x, z)
  const result: TerrainField = {
    ...graded,
    heightBounds: bounds,
    readStoredHeightAt: (x, z) => read(graded, x, z),
    readHeightAt: (x, z) => read(inGradedCorridor(x, z) ? graded : natural, x, z),
    // A region is the one its origin lies in: a vertex on the corridor's edge takes its normal
    // from the natural ground on both sides of it.
    readHeightInRegion: (ox, oz, x, z) => {
      const field = inGradedCorridor(ox, oz) ? graded : natural
      return field.readHeightInRegion ? field.readHeightInRegion(ox, oz, x, z) : read(field, x, z)
    },
    ...(gradedOnSide && naturalOnSide
      ? {
          readHeightOnSide: (
            boundary: TerrainBreakNode,
            side: TerrainBreakSide,
            x: number,
            z: number,
          ) => (inGradedCorridor(x, z) ? gradedOnSide : naturalOnSide)(boundary, side, x, z),
        }
      : {}),
  }
  const authority = breakAuthorities.get(graded)
  if (authority) breakAuthorities.set(result, authority)
  if (tightBounds.has(graded)) tightBounds.add(result)
  rampCutHalves.set(result, { graded, natural, cuts })
  return result
}

export function terrainAuthorityField(
  site: TerrainSite,
  base: TerrainField | null,
  nodes?: TerrainNodes,
): TerrainField | null {
  const breaks = terrainBreaksOf(site, nodes)
  const tiles = new Map<string, TileField>()
  for (const tile of terrainTilesOf(site, nodes)) {
    const field = tileFieldOf(tile)
    const key = `${tile.ix},${tile.iz}`
    if (field && !tiles.has(key)) tiles.set(key, { ix: tile.ix, iz: tile.iz, field })
  }
  const graded = authorityOver(site, base, tiles, breaks)
  if (!graded || !tiles.size) return graded
  const ramps = rampsGradingOf(site, nodes)
  if (!ramps.length) return graded
  const cuts = ramps.flatMap((ramp) => rampCutOf(ramp) ?? [])
  const before = cuts.length
    ? tilesBeforeGrading(tiles, gradedSamplesOf(cuts.map((cut) => cut.ramp)))
    : null
  if (!before) return graded
  const natural = authorityOver(site, base, before, breaks)
  return natural ? withRampCuts(graded, natural, cuts) : graded
}

const previewFields = new WeakMap<TerrainField, WeakMap<TerrainField, TerrainField>>()
const NO_PERSISTED = {} as TerrainField

/**
 * A live edit overrides only its bounded working rectangle, not the rest of the scene.
 *
 * One field for one pair: every ground mesh, the skirt and each break ask for the same preview on
 * every dab, and making it reads every sample of the edit for its bounds (a 480 m lot is 954 000
 * samples, asked for 258 times a dab).
 */
export function terrainPreviewField(
  preview: TerrainField,
  persisted: TerrainField | null,
): TerrainField {
  if (preview === persisted) return persisted
  let made = previewFields.get(preview)
  if (!made) {
    made = new WeakMap()
    previewFields.set(preview, made)
  }
  const key = persisted ?? NO_PERSISTED
  let field = made.get(key)
  if (!field) {
    field = makeTerrainPreviewField(preview, persisted)
    made.set(key, field)
  }
  return field
}

function makeTerrainPreviewField(
  preview: TerrainField,
  persisted: TerrainField | null,
): TerrainField {
  // Each ground is previewed on its own, so outside the stroke's rectangle the ground beside a
  // ramp stays natural (the break branch below would fall back to the graded tiles for all of it).
  const halves = persisted ? rampCutHalves.get(persisted) : undefined
  if (halves)
    return withRampCuts(
      terrainPreviewField(preview, halves.graded),
      terrainPreviewField(preview, halves.natural),
      halves.cuts,
    )
  if (!persisted)
    return {
      ...preview,
      heightBounds: authorityHeightBounds([preview]),
      contextHeight: TERRAIN_CONTEXT_HEIGHT,
      readHeightAt: (x, z) => {
        const border = borderOf(preview, x, z)
        return border.distance === 0
          ? heightAt(preview, x, z)
          : border.distance >= TERRAIN_CONTINUATION_DISTANCE
            ? TERRAIN_CONTEXT_HEIGHT
            : continuedHeight(
                preview,
                (px, pz) => heightAt(preview, px, pz),
                x,
                z,
                border,
                TERRAIN_CONTEXT_HEIGHT,
              )
      },
    }
  // Outside its rectangle the preview reads the persisted ground, so against true persisted
  // bounds only the preview's own samples add to them.
  const previewBounds = tightBounds.has(persisted)
    ? tightHeightBounds(
        [{ field: preview, exposed: [true, true, true, true] }],
        TERRAIN_CONTEXT_HEIGHT,
      )
    : authorityHeightBounds([preview])
  const persistedBounds = persisted.heightBounds ?? authorityHeightBounds([persisted])
  const field: TerrainField = {
    ...persisted,
    heightBounds: [
      Math.min(previewBounds[0], persistedBounds[0]),
      Math.max(previewBounds[1], persistedBounds[1]),
    ],
    readHeightAt: (x, z) =>
      borderOf(preview, x, z).distance === 0 ? heightAt(preview, x, z) : heightAt(persisted, x, z),
  }
  const authority = breakAuthorities.get(persisted)
  return authority
    ? withTerrainBreaks(field, authority.breaks, new Map(), preview, authority)
    : field
}
