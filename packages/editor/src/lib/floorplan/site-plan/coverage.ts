/**
 * Lot coverage and impervious surface — the ONE computation the site plan
 * (A1.0) and the cover's PROJECT DATA both print, so the two sheets can never
 * disagree again (QA 2026-09-23: the cover said 24.6 %, the site plan 45.6 %
 * — the site plan had counted the house's own floor platform and garage pad
 * as "porches" on top of the footprint).
 *
 * The two figures a Florida plans examiner asks for (Alachua County / the
 * City of Gainesville ask for both on a new single-family site plan; the
 * zoning district caps the first, the stormwater review reads the second):
 *
 *  BUILDING COVERAGE  the lot area under roofed structure: the building's
 *                     footprint to the OUTSIDE FACE of its exterior walls —
 *                     every storey at or above grade projected, the attached
 *                     garage included — plus the roofed porches, patios and
 *                     decks (a slab at least half under a roof outline).
 *                     Eaves and the roof overhang are not counted.
 *  IMPERVIOUS SURFACE building coverage plus the paving ON THE LOT (an apron
 *                     drawn out into the right-of-way is not counted): the driveway, the
 *                     walks, and the uncovered patios, landings and decks
 *                     (a slatted deck over pervious ground is counted —
 *                     the conservative reading; some jurisdictions exclude
 *                     it, verify).
 *
 * Both are divided by the LOT AREA: the county parcel record when the lot
 * drop-in resolved one (`site.parcel.lotAreaSqFt`), else the drawn lot
 * polygon. Pure: reads a scene snapshot, touches no store.
 */
import type { SceneSnapshot } from '@pascal-app/core'
import { METRES_PER_FOOT, type Pt, pointInPolygon, polygonArea, polygonBounds } from './geometry'
import {
  aboveGradeLevels,
  findBuilding,
  findLowestLevel,
  findSite,
  footprintOutline,
  levelFootprintLoops,
  type OutdoorPart,
  outdoorParts,
  roofOutlineRings,
} from './site-parts'

const SQFT_PER_SQM = 1 / (METRES_PER_FOOT * METRES_PER_FOOT)

export type ImperviousRowKey = 'building' | 'porches' | 'driveway' | 'walks' | 'patios'

export interface ImperviousRow {
  key: ImperviousRowKey
  label: string
  sqFt: number
  /** What the row holds, e.g. "2 covered: porch, rear deck". */
  note: string
}

export interface SiteCoverage {
  /** Lot area, SF, and where it came from; null without a lot. */
  lotSqFt: number | null
  lotSource: 'parcel' | 'polygon' | null
  /** The building's footprint to the outside face of its walls (garage included), SF. */
  buildingSqFt: number
  /** Roofed porches, patios and decks, SF. */
  coveredOutdoorSqFt: number
  /** Building coverage = footprint + roofed porches, SF. */
  buildingCoverageSqFt: number
  /** Building coverage ÷ lot, 0–1; null without a lot or a building. */
  buildingCoverageRatio: number | null
  drivewaySqFt: number
  walksSqFt: number
  /** Uncovered patios, landings and decks, SF. */
  openOutdoorSqFt: number
  /** Everything impervious, SF. */
  imperviousSqFt: number
  imperviousRatio: number | null
  /** The IMPERVIOUS AREA table's rows, in print order (total and % are the caller's). */
  rows: ImperviousRow[]
  /** One line each: what the two figures are measured to — printed with them. */
  basis: { building: string; impervious: string; lot: string }
  /** The parts, for the drawing: the walls' outline and every outdoor slab (site metres). */
  outline: Pt[][]
  parts: OutdoorPart[]
}

const sf = (m2: number) => m2 * SQFT_PER_SQM

/**
 * The part of a slab's area on the lot: a driveway apron drawn out into the
 * right-of-way is the road authority's paving, not the lot's. Whole when
 * every corner is on the lot, else sampled on a fine grid.
 */
function onLotArea(ring: readonly Pt[], lot: readonly Pt[]): number {
  const area = polygonArea(ring)
  if (lot.length < 3) return area
  const c = ring.reduce<[number, number]>(
    (s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length],
    [0, 0],
  )
  // a corner ON the lot line (the generator's driveway mouth) counts as on the lot
  const onLot = (p: Pt) =>
    pointInPolygon(lot, p[0] + (c[0] - p[0]) * 1e-3, p[1] + (c[1] - p[1]) * 1e-3)
  if (ring.every(onLot)) return area
  const b = polygonBounds(ring)
  const N = 24
  let inside = 0
  let kept = 0
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = b.minX + ((i + 0.5) / N) * (b.maxX - b.minX)
      const y = b.minY + ((j + 0.5) / N) * (b.maxY - b.minY)
      if (!pointInPolygon(ring, x, y)) continue
      inside++
      if (pointInPolygon(lot, x, y)) kept++
    }
  }
  return inside > 0 ? (area * kept) / inside : area
}

/** "12.3 %" — the one way both sheets print a ratio. */
export function formatCoveragePercent(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)} %`
}

/** "2,739 SF" — the one way both sheets print an area. */
export function formatSqFt(sqFt: number): string {
  return `${Math.round(sqFt).toLocaleString('en-US')} SF`
}

export function computeSiteCoverage(scene: Pick<SceneSnapshot, 'nodes'>): SiteCoverage {
  const snapshot = scene as SceneSnapshot
  const site = findSite(snapshot)
  const building = findBuilding(snapshot, site)
  const ground = findLowestLevel(snapshot, building)
  const storeys = aboveGradeLevels(snapshot, building)
  const levels = storeys.length > 0 ? storeys : ground ? [ground] : []

  // the footprint: every storey's wall bands, unioned, outer rings only
  const loops = levels.flatMap((level) => levelFootprintLoops(snapshot, level, building))
  const outline = loops.length > 0 ? footprintOutline(loops) : []
  const buildingM2 = outline.reduce((s, ring) => s + polygonArea(ring), 0)

  const roofs = levels.flatMap((level) => roofOutlineRings(snapshot, level, building))
  const parts = outdoorParts(snapshot, ground, building, outline, roofs)
  const lotRing = (site?.polygon?.points ?? []) as Pt[]
  const sum = (list: readonly OutdoorPart[]) =>
    list.reduce((s, p) => s + onLotArea(p.ring, lotRing), 0)
  const porches = parts.filter((p) => p.kind !== 'driveway' && p.kind !== 'walk')
  const covered = porches.filter((p) => p.covered)
  const open = porches.filter((p) => !p.covered)
  const driveway = parts.filter((p) => p.kind === 'driveway')
  const walks = parts.filter((p) => p.kind === 'walk')

  const lotPoly = lotRing
  const parcelSqFt =
    typeof site?.parcel?.lotAreaSqFt === 'number' && site.parcel.lotAreaSqFt > 0
      ? site.parcel.lotAreaSqFt
      : null
  const polygonSqFt = lotPoly.length >= 3 ? sf(polygonArea(lotPoly)) : 0
  const lotSqFt = parcelSqFt ?? (polygonSqFt > 0 ? polygonSqFt : null)
  const lotSource = parcelSqFt !== null ? 'parcel' : polygonSqFt > 0 ? 'polygon' : null

  const buildingSqFt = sf(buildingM2)
  const coveredOutdoorSqFt = sf(sum(covered))
  const buildingCoverageSqFt = buildingSqFt + coveredOutdoorSqFt
  const drivewaySqFt = sf(sum(driveway))
  const walksSqFt = sf(sum(walks))
  const openOutdoorSqFt = sf(sum(open))
  const imperviousSqFt = buildingCoverageSqFt + drivewaySqFt + walksSqFt + openOutdoorSqFt
  const ratio = (x: number) =>
    lotSqFt !== null && lotSqFt > 0 && buildingSqFt > 0 ? x / lotSqFt : null

  const names = (list: readonly OutdoorPart[]) => list.map((p) => p.label.toLowerCase()).join(', ')
  const rows: ImperviousRow[] = [
    {
      key: 'building',
      label: 'BUILDING (INCL. GARAGE)',
      sqFt: buildingSqFt,
      note: 'outside face of the exterior walls',
    },
    {
      key: 'porches',
      label: 'COVERED PORCHES / PATIOS',
      sqFt: coveredOutdoorSqFt,
      note: covered.length > 0 ? names(covered) : 'none',
    },
    {
      key: 'driveway',
      label: 'DRIVEWAY',
      sqFt: drivewaySqFt,
      note: driveway.length > 0 ? 'concrete' : 'none drawn',
    },
    {
      key: 'walks',
      label: 'WALKS',
      sqFt: walksSqFt,
      note: walks.length > 0 ? 'concrete' : 'none drawn',
    },
    {
      key: 'patios',
      label: 'OPEN PATIOS / DECKS / LANDINGS',
      sqFt: openOutdoorSqFt,
      note: open.length > 0 ? names(open) : 'none',
    },
  ]

  return {
    lotSqFt,
    lotSource,
    buildingSqFt,
    coveredOutdoorSqFt,
    buildingCoverageSqFt,
    buildingCoverageRatio: ratio(buildingCoverageSqFt),
    drivewaySqFt,
    walksSqFt,
    openOutdoorSqFt,
    imperviousSqFt,
    imperviousRatio: ratio(imperviousSqFt),
    rows,
    basis: {
      building:
        'Building coverage is the roofed area: the footprint to the outside face of the exterior walls (garage included, every storey projected) plus the roofed porches and patios; eaves excluded.',
      impervious:
        'Impervious surface is the building coverage plus the driveway, walks and the open patios, landings and decks (decks counted — verify the local rule).',
      lot:
        lotSource === 'parcel'
          ? 'Lot area is the county parcel record.'
          : lotSource === 'polygon'
            ? 'Lot area is the drawn lot polygon (not a survey).'
            : 'No lot area.',
    },
    outline,
    parts,
  }
}
