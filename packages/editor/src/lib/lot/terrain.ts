/**
 * Lot terrain from USGS elevations (PlanCrafters terrain.js `sampleGrid`,
 * TERRAIN-DATUM-SPEC): an N×N grid of points over the lot's bounding box
 * (padded a touch so the ground runs past the lines) goes to
 * `/api/parcel/elevation` (USGS EPQS, keyless, feet), the readings come
 * back relative to a DATUM — the ground at the lot's centre, so the site
 * plane y = 0 is the ground where the house will stand — and are written
 * into the site's heightfield (`site.terrain`, the same field the sculpt
 * tool edits and every placement / raycast / drape reads).
 *
 * Honesty: a web-service DEM is preliminary — the sample record on the
 * site (`metadata.terrainSample`: source, grid, holes, datum, relief) says
 * what was read; a lot flatter than `MIN_RELIEF_M` writes NO terrain and
 * keeps the flat-ground fast path; every failure returns a reason and
 * writes nothing.
 */
import {
  commitTerrainField,
  createTerrainField,
  quantize,
  type TerrainData,
  type TerrainField,
} from '@pascal-app/core'

export type Pt = readonly [number, number]

/** apps/editor/lib/parcel/project.ts — the plan frame's degree scale. */
export const FEET_PER_DEG_LAT = 364000
const METRES_PER_FOOT = 0.3048
const DEG2RAD = Math.PI / 180
/** Grid points per side (81 points — well under the route's 256 cap). */
export const DEFAULT_GRID_N = 9
/** The lot bbox is padded by this fraction so the mesh runs past the lines. */
export const PAD_FRAC = 0.08
/** A lot with less fall than this across its samples is flat: no terrain written. */
export const MIN_RELIEF_M = 0.15
/** Heightfield resolution: the bbox split into ~64 cells per side, clamped. */
const FIELD_CELLS = 64
const MIN_SPACING_M = 0.5
const MAX_SPACING_M = 4

export interface TerrainSampleSummary {
  source: 'USGS EPQS'
  /** Grid side (n × n points). */
  grid: number
  /** Points with a reading / without one. */
  sampled: number
  holes: number
  /** Absolute elevation of the site plane (the datum), feet. */
  datumFt: number
  /** Highest − lowest reading, feet. */
  reliefFt: number
  /** True when the lot read flat and no heightfield was written. */
  flat: boolean
  at: string
}

export interface TerrainSampleResult {
  ok: boolean
  reason?: string
  /** The heightfield to write to `site.terrain` (absent when flat). */
  terrain?: TerrainData
  summary?: TerrainSampleSummary
}

export interface SampleGrid {
  n: number
  x0: number
  z0: number
  x1: number
  z1: number
  /** Row-major, `r * n + c`. */
  points: Pt[]
}

/** Local plan metres (the site frame) → `{ lat, lng }`, the inverse of `ringsToPlanFeet`. */
export function localMetresToLngLat(
  p: Pt,
  originLngLat: readonly [number, number],
): { lat: number; lng: number } {
  const [oLng, oLat] = originLngLat
  const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(oLat * DEG2RAD)
  const xFt = p[0] / METRES_PER_FOOT
  const zFt = p[1] / METRES_PER_FOOT
  return { lng: oLng + xFt / ftPerDegLng, lat: oLat - zFt / FEET_PER_DEG_LAT }
}

/** The n × n sample grid over the ring's padded bounding box. */
export function gridOver(ring: readonly Pt[], n = DEFAULT_GRID_N, pad = PAD_FRAC): SampleGrid {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of ring) {
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minZ = Math.min(minZ, p[1])
    maxZ = Math.max(maxZ, p[1])
  }
  const padX = (maxX - minX) * pad
  const padZ = (maxZ - minZ) * pad
  const x0 = minX - padX
  const x1 = maxX + padX
  const z0 = minZ - padZ
  const z1 = maxZ + padZ
  const side = Math.max(2, Math.floor(n))
  const points: Pt[] = []
  for (let r = 0; r < side; r++) {
    const z = z0 + ((z1 - z0) * r) / (side - 1)
    for (let c = 0; c < side; c++) points.push([x0 + ((x1 - x0) * c) / (side - 1), z])
  }
  return { n: side, x0, z0, x1, z1, points }
}

/**
 * Bilinear read of the coarse grid at a plan point; holes (null readings)
 * read as `fill`. Clamped to the grid — the field never extrapolates.
 */
export function coarseHeightAt(
  grid: SampleGrid,
  elev: readonly (number | null)[],
  x: number,
  z: number,
  fill: number,
): number {
  const n = grid.n
  const fx = grid.x1 === grid.x0 ? 0 : ((x - grid.x0) / (grid.x1 - grid.x0)) * (n - 1)
  const fz = grid.z1 === grid.z0 ? 0 : ((z - grid.z0) / (grid.z1 - grid.z0)) * (n - 1)
  const gx = Math.max(0, Math.min(n - 1, fx))
  const gz = Math.max(0, Math.min(n - 1, fz))
  const c0 = Math.min(n - 2, Math.floor(gx))
  const r0 = Math.min(n - 2, Math.floor(gz))
  const tx = gx - c0
  const tz = gz - r0
  const at = (r: number, c: number): number => {
    const v = elev[r * n + c]
    return v === null || v === undefined || !Number.isFinite(v) ? fill : v
  }
  const top = at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx
  const bottom = at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx
  return top * (1 - tz) + bottom * tz
}

/** A heightfield over the grid's extent, metres above the datum, bilinear from the coarse samples. */
export function fieldFromSamples(
  grid: SampleGrid,
  elevM: readonly (number | null)[],
  datumM: number,
  fillM: number,
): TerrainField {
  const spanX = grid.x1 - grid.x0
  const spanZ = grid.z1 - grid.z0
  const spacing = Math.min(
    MAX_SPACING_M,
    Math.max(MIN_SPACING_M, Math.max(spanX, spanZ) / FIELD_CELLS),
  )
  const cols = Math.max(2, Math.ceil(spanX / spacing) + 1)
  const rows = Math.max(2, Math.ceil(spanZ / spacing) + 1)
  const field = createTerrainField({ origin: [grid.x0, grid.z0], spacing, cols, rows })
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = grid.x0 + c * spacing
      const z = grid.z0 + r * spacing
      field.heights[r * cols + c] = quantize(
        field,
        coarseHeightAt(grid, elevM, x, z, fillM) - datumM,
      )
    }
  }
  return field
}

type ElevationResponse = {
  ok?: boolean
  error?: string
  results?: { lat?: number; lng?: number; elevation?: number | null }[]
}

export interface SampleOptions {
  fetchImpl?: typeof fetch
  /** Grid side, default 9. */
  n?: number
  /** Passed to the route (USGS is slow; the route caps it). */
  deadlineMs?: number
  /** Where the datum is read (site metres); default = the ring's centroid. */
  datumAt?: Pt
  now?: () => string
}

/**
 * Sample the lot. Resolves `{ ok: false, reason }` on every failure path and
 * never throws; `ok: true` with no `terrain` means the lot read flat.
 */
export async function sampleLotTerrain(
  ring: readonly Pt[],
  originLngLat: readonly [number, number],
  options: SampleOptions = {},
): Promise<TerrainSampleResult> {
  if (ring.length < 3) return { ok: false, reason: 'no lot ring' }
  const fetchImpl = options.fetchImpl ?? fetch
  const grid = gridOver(ring, options.n ?? DEFAULT_GRID_N)
  const points = grid.points.map((p) => localMetresToLngLat(p, originLngLat))
  let body: ElevationResponse
  try {
    const response = await fetchImpl('/api/parcel/elevation', {
      body: JSON.stringify({ points, deadlineMs: options.deadlineMs ?? 12000 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    body = (await response.json()) as ElevationResponse
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'elevation lookup failed' }
  }
  if (!body.ok || !Array.isArray(body.results))
    return { ok: false, reason: body.error ?? 'no elevations' }
  const elevFt: (number | null)[] = grid.points.map((_, i) => {
    const e = body.results?.[i]?.elevation
    return typeof e === 'number' && Number.isFinite(e) ? e : null
  })
  const valid = elevFt.filter((e): e is number => e !== null)
  if (valid.length < 4)
    return { ok: false, reason: `too few elevations (${valid.length} of ${elevFt.length})` }
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length
  const datumAt = options.datumAt ?? centroidOf(ring)
  const datumFt = coarseHeightAt(grid, elevFt, datumAt[0], datumAt[1], mean)
  const reliefFt = Math.max(...valid) - Math.min(...valid)
  const summary: TerrainSampleSummary = {
    source: 'USGS EPQS',
    grid: grid.n,
    sampled: valid.length,
    holes: elevFt.length - valid.length,
    datumFt,
    reliefFt,
    flat: reliefFt * METRES_PER_FOOT < MIN_RELIEF_M,
    at: (options.now ?? (() => new Date().toISOString()))(),
  }
  if (summary.flat) return { ok: true, summary }
  const elevM = elevFt.map((e) => (e === null ? null : e * METRES_PER_FOOT))
  const field = fieldFromSamples(grid, elevM, datumFt * METRES_PER_FOOT, mean * METRES_PER_FOOT)
  return { ok: true, terrain: commitTerrainField(field), summary }
}

function centroidOf(ring: readonly Pt[]): Pt {
  let x = 0
  let z = 0
  for (const p of ring) {
    x += p[0]
    z += p[1]
  }
  return [x / ring.length, z / ring.length]
}

/** One status fragment for the drop-in message. */
export function describeTerrainSample(
  summary: TerrainSampleSummary | null,
  failure: string,
): string {
  if (summary) {
    if (summary.flat) return `ground flat within ${Math.round(summary.reliefFt * 12)}" (USGS)`
    const holes = summary.holes > 0 ? `, ${summary.holes} unread` : ''
    return `terrain: ${summary.reliefFt.toFixed(1)}' of fall across the lot (USGS, ${summary.sampled} pts${holes})`
  }
  if (failure && failure !== 'skipped') return `terrain unavailable (${failure})`
  return ''
}
