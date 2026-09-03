/**
 * The cover sheet (A0.0), composed the way a permit set's cover reads.
 *
 * LAYOUT. Modelled on the PlanCrafters cover (`app/js/sheets.js`, the A0.0
 * builder ~line 607 and the `kind === 'index'` painter ~line 2160), reproduced
 * in OUR primitives — nothing is imported from that engine:
 *
 *   left column   project name in a large display face, the project-type
 *                 subtitle, the address and APN, the jurisdiction line, then
 *                 the front-quarter 3D hero under it.
 *   right column  SHEET INDEX (number + title rows, hairline under each row),
 *                 PROJECT DATA, GENERAL NOTES.
 *
 * PROJECT DATA IS COMPUTED, NEVER GUESSED. `computeProjectData` reads areas
 * out of the zone and slab polygons, the lot out of the site node, and the
 * height out of the level heights plus the roof rise. Anything the scene
 * cannot support prints `NOT ESTABLISHED` — the one thing a cover must not do
 * is invent a number a plan checker will hold the designer to.
 *
 * Everything here is emitted in SHEET INCHES (origin at the paper's top-left),
 * the same space `titleblock.ts` draws in, so the screen and the PDF get the
 * same marks.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { AnyNodeLike, NodeMap } from './model'
import { levelLabel, levels, projectRecord, siteAddress, siteNode } from './model'
import { INK, INK_SOFT, MONO, SANS } from './titleblock'

/** The display face the big cover title is set in, with real fallbacks. */
export const DISPLAY =
  '"Big Shoulders Display", "IBM Plex Sans Condensed", "IBM Plex Sans", Helvetica, Arial, sans-serif'

/** What a value reads when the scene cannot support it. Never a guess. */
export const UNKNOWN = 'NOT ESTABLISHED'

const SQFT_PER_SQM = 10.763910416709722
const FEET_PER_METRE = 3.280839895013123

/* ------------------------------------------------------------ geometry */

type Pt = readonly [number, number]

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  opts: {
    weight?: number
    fill?: string
    anchor?: 'start' | 'middle' | 'end'
    family?: string
    letterSpacing?: number
  } = {},
): FloorplanGeometry {
  return {
    kind: 'text',
    x,
    y,
    text: value,
    fontSize: size,
    fill: opts.fill ?? INK,
    fontWeight: opts.weight ?? 400,
    fontFamily: opts.family ?? SANS,
    textAnchor: opts.anchor ?? 'start',
    dominantBaseline: 'alphabetic',
  }
}

function rule(x: number, y: number, w: number, width = 0.008, stroke = INK): FloorplanGeometry {
  return { kind: 'line', x1: x, y1: y, x2: x + w, y2: y, stroke, strokeWidth: width }
}

/** Approximate set width of a Plex Sans / display string, in inches. */
function measure(value: string, size: number, weight = 400, condensed = false): number {
  const k = (weight >= 700 ? 0.58 : 0.54) * (condensed ? 0.72 : 1)
  return value.length * size * k
}

/** Shrink a size until the string fits `maxW`; never below 45 % of `size`. */
export function fitSize(
  value: string,
  size: number,
  maxW: number,
  weight = 400,
  condensed = false,
): number {
  let s = size
  for (let i = 0; i < 8 && measure(value, s, weight, condensed) > maxW; i++) {
    s = Math.max(size * 0.45, s * (maxW / measure(value, s, weight, condensed)))
  }
  return s
}

/* ---------------------------------------------------------- polygons */

/** Points of a polygon field that may be `[x,z][]` or `{ points: [x,z][] }`. */
export function polygonPoints(value: unknown): Pt[] {
  if (Array.isArray(value)) {
    return value.filter(
      (p): p is Pt =>
        Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
  }
  if (value && typeof value === 'object' && 'points' in value) {
    return polygonPoints((value as { points: unknown }).points)
  }
  return []
}

/** Shoelace area in square metres; always positive. */
export function polygonAreaSqM(points: readonly Pt[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Pt
    const b = points[(i + 1) % points.length] as Pt
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/* ------------------------------------------------------ project data */

export type ProjectDataRow = { label: string; value: string; indent?: boolean }

export type ProjectData = {
  rows: ProjectDataRow[]
  /** How each computed number was arrived at — printed under the block. */
  basis: string[]
  /** Everything that came out `NOT ESTABLISHED`, for the caller's report. */
  unknown: string[]
}

/** Zones whose floor area is not living area. Name-matched; documented. */
const NON_LIVING = /\b(garage|carport|porch|patio|deck|shed|attic|crawl|storage room)\b/i
const BEDROOM = /\bbed\s*room|\bbedroom|\bbed\b/i
const BATHROOM = /\bbath/i

function nodesOfType(nodes: NodeMap, type: string): AnyNodeLike[] {
  return Object.values(nodes).filter((n): n is AnyNodeLike => n?.type === type)
}

function levelOf(nodes: NodeMap, node: AnyNodeLike): string | undefined {
  let current: AnyNodeLike | undefined = node
  const seen = new Set<string>()
  while (current?.parentId && typeof current.parentId === 'string' && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    current = nodes[current.parentId]
    if (current?.type === 'level') return current.id
  }
  return undefined
}

function sqft(sqm: number): string {
  return `${Math.round(sqm * SQFT_PER_SQM).toLocaleString('en-US')} SF`
}

/**
 * Every number the PROJECT DATA block prints, computed from the scene.
 *
 * The rules, each of which is also printed on the sheet as the basis line:
 *  - LIVING AREA          Σ zone polygon areas, less zones whose name reads
 *                         garage / carport / porch / patio / deck / shed /
 *                         attic / crawl / storage room.
 *  - TOTAL UNDER ROOF     the LARGEST single level's slab area — the area the
 *                         roof actually covers, not the sum of the storeys.
 *  - LOT AREA             `site.parcel.lotAreaSqFt` when the parcel service
 *                         resolved one, else the site polygon's own area.
 *  - LOT COVERAGE         total under roof ÷ lot area.
 *  - FAR                  living area ÷ lot area.
 *  - BUILDING HEIGHT      Σ level heights + the tallest roof segment's rise.
 *  - BEDROOMS / BATHS     zone names.
 *  - STORIES              level count.
 */
export function computeProjectData(nodes: NodeMap): ProjectData {
  const rows: ProjectDataRow[] = []
  const basis: string[] = []
  const unknown: string[] = []
  const levelNodes = levels(nodes)

  const push = (label: string, value: string | null, indent = false) => {
    if (value === null) unknown.push(label)
    rows.push({ label, value: value ?? UNKNOWN, indent })
  }

  // ── areas from zones ────────────────────────────────────────────────
  const zones = nodesOfType(nodes, 'zone').filter((z) => z.visible !== false)
  const zoneArea = new Map<string, number>()
  let livingSqM = 0
  let measuredZones = 0
  for (const zone of zones) {
    const area = polygonAreaSqM(polygonPoints(zone.polygon))
    if (area <= 0) continue
    measuredZones++
    const name = typeof zone.name === 'string' ? zone.name : ''
    if (NON_LIVING.test(name)) continue
    livingSqM += area
    const levelId = levelOf(nodes, zone)
    if (levelId) zoneArea.set(levelId, (zoneArea.get(levelId) ?? 0) + area)
  }
  const hasLiving = measuredZones > 0 && livingSqM > 0
  push('LIVING AREA', hasLiving ? sqft(livingSqM) : null)
  if (hasLiving && levelNodes.length > 1) {
    for (const level of levelNodes) {
      const area = zoneArea.get(level.id)
      if (area)
        rows.push({ label: levelLabel(level).toUpperCase(), value: sqft(area), indent: true })
    }
  }
  if (hasLiving)
    basis.push(
      'Living area is the sum of room (zone) polygons, less garage and unconditioned rooms.',
    )
  else if (zones.length === 0)
    basis.push('No rooms (zones) are drawn yet, so no floor area can be reported.')
  else basis.push('The rooms drawn have no closed polygon yet, so no floor area can be reported.')

  // ── footprint from slabs ────────────────────────────────────────────
  const slabs = nodesOfType(nodes, 'slab').filter((s) => s.visible !== false)
  const slabByLevel = new Map<string, number>()
  let looseSlab = 0
  for (const slab of slabs) {
    const outer = polygonAreaSqM(polygonPoints(slab.polygon))
    if (outer <= 0) continue
    const holes = Array.isArray(slab.holes)
      ? (slab.holes as unknown[]).reduce<number>(
          (sum, h) => sum + polygonAreaSqM(polygonPoints(h)),
          0,
        )
      : 0
    const net = Math.max(0, outer - holes)
    const levelId = levelOf(nodes, slab)
    if (levelId) slabByLevel.set(levelId, (slabByLevel.get(levelId) ?? 0) + net)
    else looseSlab += net
  }
  const underRoofSqM = Math.max(0, ...slabByLevel.values(), looseSlab)
  push('TOTAL UNDER ROOF', underRoofSqM > 0 ? sqft(underRoofSqM) : null)
  if (underRoofSqM > 0) {
    basis.push('Total under roof is the largest single level’s slab area (holes deducted).')
  }

  // ── lot ─────────────────────────────────────────────────────────────
  const site = siteNode(nodes)
  const parcel = (site?.parcel ?? {}) as Record<string, unknown>
  const parcelSqFt =
    typeof parcel.lotAreaSqFt === 'number' && parcel.lotAreaSqFt > 0 ? parcel.lotAreaSqFt : null
  const polygonSqM = polygonAreaSqM(polygonPoints(site?.polygon))
  const lotSqFt = parcelSqFt ?? (polygonSqM > 0 ? polygonSqM * SQFT_PER_SQM : null)
  push('LOT AREA', lotSqFt === null ? null : `${Math.round(lotSqFt).toLocaleString('en-US')} SF`)
  if (lotSqFt !== null) {
    basis.push(
      parcelSqFt !== null
        ? 'Lot area is the county parcel record resolved onto the site node.'
        : 'Lot area is the drawn site polygon; it is not a surveyed figure.',
    )
  }

  const pct = (num: number) => `${(num * 100).toFixed(1)} %`
  push(
    'LOT COVERAGE',
    lotSqFt !== null && underRoofSqM > 0 ? pct((underRoofSqM * SQFT_PER_SQM) / lotSqFt) : null,
  )
  push(
    'FLOOR AREA RATIO',
    lotSqFt !== null && hasLiving ? ((livingSqM * SQFT_PER_SQM) / lotSqFt).toFixed(2) : null,
  )

  // ── height ──────────────────────────────────────────────────────────
  const storeyHeights = levelNodes.map((l) => (typeof l.height === 'number' ? l.height : null))
  const storeysKnown = levelNodes.length > 0 && storeyHeights.every((h) => h !== null && h > 0)
  const roofRise = maxRoofRise(nodes)
  const heightM =
    storeysKnown && roofRise !== null ? sum(storeyHeights as number[]) + roofRise : null
  push('BUILDING HEIGHT', heightM === null ? null : formatFeet(heightM))
  if (heightM !== null) {
    basis.push(
      'Building height is the storey heights plus the tallest roof segment’s rise, from grade at the slab.',
    )
  } else if (roofRise === null) {
    basis.push('No roof is modelled, so building height cannot be reported.')
  }

  // ── programme ───────────────────────────────────────────────────────
  const named = zones.filter((z) => typeof z.name === 'string' && z.name.trim().length > 0)
  const beds = named.filter((z) => BEDROOM.test(String(z.name))).length
  const baths = named.filter((z) => BATHROOM.test(String(z.name))).length
  push('BEDROOMS', named.length > 0 ? String(beds) : null)
  push('BATHS', named.length > 0 ? String(baths) : null)
  push('STORIES', levelNodes.length > 0 ? String(levelNodes.length) : null)

  const zone = typeof site?.zone === 'string' ? site.zone : ''
  if (zone) rows.push({ label: 'ZONING', value: zone.toUpperCase() })

  return { rows, basis, unknown }
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/** Feet and inches from metres, the only unit a cover prints. */
export function formatFeet(metres: number): string {
  const totalInches = Math.round(metres * FEET_PER_METRE * 12)
  const feet = Math.floor(totalInches / 12)
  return `${feet}'-${totalInches - feet * 12}"`
}

/**
 * The tallest roof segment's eave-to-peak rise, in metres, or `null` when the
 * scene has no roof at all. Computed from `pitch` and the segment footprint
 * the same way `getActiveRoofHeight` does for the primary slope; done locally
 * so a partially-typed synthetic scene (a test, an imported file) still
 * yields a number instead of throwing.
 */
export function maxRoofRise(nodes: NodeMap): number | null {
  const segments = nodesOfType(nodes, 'roof-segment')
  if (segments.length === 0) return null
  let best = 0
  let measured = false
  for (const seg of segments) {
    const pitch = typeof seg.pitch === 'number' ? seg.pitch : null
    const depth = typeof seg.depth === 'number' ? seg.depth : null
    const width = typeof seg.width === 'number' ? seg.width : null
    if (pitch === null || depth === null) continue
    const roofType = typeof seg.roofType === 'string' ? seg.roofType : 'gable'
    if (roofType === 'flat' || pitch <= 0) {
      measured = true
      continue
    }
    // Shed slopes across the whole depth; every other type peaks at the middle.
    const run = roofType === 'shed' ? Math.max(depth, 0) : Math.max(depth, 0) / 2
    const rise = Math.tan((pitch * Math.PI) / 180) * run
    if (Number.isFinite(rise)) {
      measured = true
      best = Math.max(best, rise)
    }
    void width
  }
  return measured ? best : null
}

/* ------------------------------------------------------------ subtitle */

/**
 * The project-type line under the name. Mirrors the PlanCrafters cover's
 * `projSubtitle` (sheets.js ~line 630) — the cover declares the occupancy the
 * rest of the set is drawn for.
 */
export function projectSubtitle(nodes: NodeMap): string {
  const record = projectRecord(nodes) as unknown as { projectType?: unknown } | undefined
  const site = siteNode(nodes)
  const raw =
    (typeof record?.projectType === 'string' && record.projectType) ||
    (typeof site?.projectType === 'string' && site.projectType) ||
    ''
  switch (raw.trim().toLowerCase()) {
    case 'adu':
      return 'NEW ACCESSORY DWELLING UNIT (ADU)'
    case 'jadu':
      return 'NEW JUNIOR ACCESSORY DWELLING UNIT (JADU)'
    case 'addition':
      return 'RESIDENTIAL ADDITION'
    case 'remodel':
    case 'renovation':
      return 'RESIDENTIAL REMODEL'
    case 'residence':
    case 'house':
    case '':
      return raw ? 'NEW SINGLE-FAMILY RESIDENCE' : 'RESIDENCE'
    default:
      return raw.toUpperCase()
  }
}

/* ------------------------------------------------------------- blocks */

export const COVER_BLOCKS = ['title', 'index', 'data', 'notes'] as const
export type CoverBlock = (typeof COVER_BLOCKS)[number]

export const COVER_GENERAL_NOTES: string[] = [
  '1.  All work shall comply with the adopted building code and the local amendments of the jurisdiction named in the title block.',
  '2.  The contractor shall verify every dimension and existing condition in the field before starting work and shall report any discrepancy to the designer before proceeding.',
  '3.  Do not scale the drawings. Written dimensions govern.',
  '4.  Dimensions are to face of stud unless noted otherwise.',
  '5.  Details and notes shown on one drawing apply to all like conditions throughout unless noted otherwise.',
  '6.  The contractor is responsible for the means, methods and safety of construction.',
  '7.  Substitutions require the written approval of the designer and, where the substitution affects a code-listed assembly, the building official.',
  '8.  These drawings are the instruments of service of the designer and remain the designer’s property.',
]

/** A section heading in the PlanCrafters manner: bold caps over a heavy rule. */
function heading(x: number, y: number, w: number, label: string, size = 0.3): FloorplanGeometry[] {
  return [
    text(x, y, label, size, { weight: 800 }),
    rule(x, y + 0.13, w, 0.026),
    rule(x, y + 0.19, w, 0.006, INK_SOFT),
  ]
}

/** Wrap a paragraph to lines that fit `maxW` at `size`. */
export function wrapToWidth(value: string, size: number, maxW: number, weight = 400): string[] {
  const words = value.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next, size, weight) > maxW) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out
}

export type CoverBlockInput = {
  block: CoverBlock
  nodes: NodeMap
  x: number
  y: number
  w: number
  h: number
  /** The whole set, for the SHEET INDEX. */
  index: { number: string; title: string }[]
}

/** One cover block, drawn in sheet inches. */
export function buildCoverBlock(input: CoverBlockInput): FloorplanGeometry[] {
  switch (input.block) {
    case 'title':
      return buildCoverTitle(input)
    case 'index':
      return buildSheetIndex(input)
    case 'data':
      return buildProjectDataBlock(input)
    case 'notes':
      return buildGeneralNotes(input)
  }
}

function buildCoverTitle({ nodes, x, y, w }: CoverBlockInput): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const record = projectRecord(nodes)
  const fallback = siteAddress(nodes)
  const name = (record?.identity?.projectName || 'UNTITLED PROJECT').toUpperCase()
  // ~1.1 in cap height on ARCH D, shrunk to fit the column.
  const size = fitSize(name, 1.1, w, 800, true)
  out.push(text(x, y + size * 0.78, name, size, { weight: 800, family: DISPLAY }))

  let cy = y + size * 0.78 + 0.52
  out.push(text(x, cy, projectSubtitle(nodes), 0.34, { weight: 600, fill: INK }))
  cy += 0.14
  out.push(rule(x, cy, w * 0.62, 0.022))
  cy += 0.42

  const street = record?.identity?.address?.street || fallback.street
  const city = record?.identity?.address?.city || fallback.city
  const state = record?.identity?.address?.state || fallback.state
  const zip = record?.identity?.address?.zip || fallback.zip
  const second = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  for (const line of [street, second].filter(Boolean)) {
    out.push(text(x, cy, line.toUpperCase(), 0.24, { weight: 500 }))
    cy += 0.3
  }
  if (!street && !second) {
    out.push(text(x, cy, `PROJECT ADDRESS ${UNKNOWN}`, 0.24, { weight: 500, fill: INK_SOFT }))
    cy += 0.3
  }

  const apn = record?.identity?.apn || fallback.apn
  const j = record?.jurisdiction
  const jurisdiction = [j?.city, j?.county, j?.state].filter(Boolean).join(', ')
  const meta = [
    `APN  ${apn || UNKNOWN}`,
    `JURISDICTION  ${(jurisdiction || UNKNOWN).toUpperCase()}`,
  ]
  cy += 0.06
  for (const line of meta) {
    out.push(text(x, cy, line, 0.16, { family: MONO, weight: 500, fill: INK_SOFT }))
    cy += 0.24
  }
  return out
}

/** The row pitch a sheet index of `n` rows uses (PlanCrafters `coverIndexPitch`). */
export function indexPitch(rowCount: number, availableH: number): number {
  const natural = Math.max(0.26, Math.min(0.42, 10.38 / Math.max(1, rowCount)))
  const fitted = (availableH - 0.62) / Math.max(1, rowCount)
  return Math.max(0.18, Math.min(natural, fitted))
}

function buildSheetIndex({ x, y, w, h, index }: CoverBlockInput): FloorplanGeometry[] {
  const out = heading(x, y + 0.3, w, 'SHEET INDEX')
  if (index.length === 0) {
    out.push(text(x, y + 0.86, 'No sheets in this set yet.', 0.18, { fill: INK_SOFT }))
    return out
  }
  const pitch = indexPitch(index.length, h - 0.3)
  const size = Math.min(0.19, Math.max(0.12, pitch - 0.1))
  let ry = y + 0.62
  for (const sheet of index) {
    if (ry + pitch > y + h) break
    out.push(text(x, ry, sheet.number, size, { weight: 700, family: MONO }))
    out.push(text(x + 1.15, ry, sheet.title.toUpperCase(), size, { weight: 500 }))
    out.push(rule(x, ry + pitch - 0.09, w, 0.005, INK_SOFT))
    ry += pitch
  }
  return out
}

function buildProjectDataBlock({ nodes, x, y, w, h }: CoverBlockInput): FloorplanGeometry[] {
  const out = heading(x, y + 0.3, w, 'PROJECT DATA')
  const data = computeProjectData(nodes)
  const pitch = 0.26
  let ry = y + 0.66
  for (const row of data.rows) {
    if (ry > y + h - 0.4) break
    out.push(
      text(x + (row.indent ? 0.22 : 0), ry, row.label, 0.155, {
        weight: row.indent ? 500 : 700,
        family: MONO,
        fill: row.indent ? INK_SOFT : INK,
      }),
    )
    out.push(
      text(x + w, ry, row.value, 0.165, {
        anchor: 'end',
        weight: row.value === UNKNOWN ? 500 : 700,
        family: MONO,
        fill: row.value === UNKNOWN ? INK_SOFT : INK,
      }),
    )
    out.push(rule(x, ry + 0.07, w, 0.004, INK_SOFT))
    ry += pitch
  }
  ry += 0.12
  for (const line of data.basis) {
    for (const wrapped of wrapToWidth(line, 0.115, w)) {
      if (ry > y + h) break
      out.push(text(x, ry, wrapped, 0.115, { fill: INK_SOFT }))
      ry += 0.16
    }
  }
  return out
}

function buildGeneralNotes({ x, y, w, h }: CoverBlockInput): FloorplanGeometry[] {
  const out = heading(x, y + 0.3, w, 'GENERAL NOTES')
  let ry = y + 0.66
  for (const note of COVER_GENERAL_NOTES) {
    const lines = wrapToWidth(note, 0.145, w)
    for (const [i, line] of lines.entries()) {
      if (ry > y + h) return out
      out.push(text(x + (i === 0 ? 0 : 0.28), ry, line, 0.145, { weight: i === 0 ? 600 : 400 }))
      ry += 0.2
    }
    ry += 0.08
  }
  return out
}
