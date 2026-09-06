/**
 * 'energy' sheet drawing provider — EN1.0, the energy compliance sheet.
 *
 * Three columns of plate, in absolute sheet inches:
 *
 *   1  BUILDING ENVELOPE SUMMARY   gross wall / window / door / net wall by
 *                                  orientation, then conditioned area, ceiling
 *                                  area, volume and glazing percentage — all
 *                                  measured off the model (notes/envelope.ts).
 *   2  CLIMATE ZONE & DESIGN DATA  read from the repo's jurisdiction data,
 *      PRESCRIPTIVE REQUIREMENTS   with values only where the repo can cite
 *      COMPLIANCE PATH             them, and the path Pascal does NOT compute.
 *   3  FENESTRATION SCHEDULE       one row per window, marked with the same
 *      ASSUMPTIONS                 numbers as the window schedule.
 *
 * The sheet never says "complies". It says what was measured, what the code
 * asks for where that is citable, and who has to sign the form.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { drawTable, tableHeight } from '../draw-table'
import type { DrawingProvider, DrawingResult, ProviderArgs } from '../drawings'
import type { NodeMap } from '../model'
import { CUFT_PER_CUM, computeEnvelope, type EnvelopeModel, SQFT_PER_SQM } from '../notes/envelope'
import { generalNoteSections, noteLine } from '../notes/general'
import { type Jurisdiction, resolveJurisdiction } from '../notes/jurisdiction'
import { compliancePathNote, prescriptiveRequirements } from '../notes/prescriptive'
import { resolveMarks, type ScheduleTable } from '../schedule'
import { INK, INK_SOFT, SANS } from '../titleblock'

const CHAR_W = 0.55
const BODY = 0.11
const LEAD = 0.15
const WARNING_BAND = 0.82

type Box = { x: number; y: number; w: number; h: number }

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

function rule(x: number, y: number, w: number, width = 0.02, stroke = INK): FloorplanGeometry {
  return { kind: 'line', x1: x, y1: y, x2: x + w, y2: y, stroke, strokeWidth: width }
}

function wrap(value: string, size: number, maxW: number): string[] {
  const max = Math.max(8, Math.floor(maxW / (size * CHAR_W)))
  const out: string[] = []
  let line = ''
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && next.length > max) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out.length > 0 ? out : ['']
}

function sqft(sqm: number): string {
  return `${Math.round(sqm * SQFT_PER_SQM).toLocaleString('en-US')}`
}

function feetInches(metres: number): string {
  const totalInches = Math.round(metres * 39.3700787401575)
  const feet = Math.floor(totalInches / 12)
  return `${feet}'-${totalInches - feet * 12}"`
}

/** A bold caps heading over a heavy rule — the section marker used throughout. */
function heading(x: number, y: number, w: number, label: string): FloorplanGeometry[] {
  return [text(x, y, label.toUpperCase(), 0.13, { weight: 800 }), rule(x, y + 0.07, w, 0.022)]
}

/* --------------------------------------------------------- the plate */

function envelopeTable(model: EnvelopeModel): ScheduleTable {
  const rows: Record<string, string>[] = model.byOrientation.map((entry) => ({
    mark: entry.orientation,
    walls: String(entry.wallCount),
    gross: sqft(entry.grossWallSqM),
    window: sqft(entry.windowSqM),
    door: sqft(entry.doorSqM),
    net: sqft(entry.netWallSqM),
  }))
  rows.push({
    mark: 'TOTAL',
    walls: String(model.byOrientation.reduce((n, e) => n + e.wallCount, 0)),
    gross: sqft(model.grossWallSqM),
    window: sqft(model.windowSqM),
    door: sqft(model.doorSqM),
    net: sqft(model.netWallSqM),
  })
  return {
    title: 'OPAQUE & GLAZED SURFACES BY ORIENTATION',
    columns: [
      { key: 'mark', label: 'FACE', weight: 0.7 },
      { key: 'walls', label: 'WALLS', weight: 0.6 },
      { key: 'gross', label: 'GROSS SF', weight: 1 },
      { key: 'window', label: 'WINDOW SF', weight: 1 },
      { key: 'door', label: 'DOOR SF', weight: 1 },
      { key: 'net', label: 'NET WALL SF', weight: 1.1 },
    ],
    rows,
    issues: [],
  }
}

function areaTable(model: EnvelopeModel): ScheduleTable {
  const basis =
    model.floorAreaBasis === 'zones'
      ? 'sum of room polygons'
      : model.floorAreaBasis === 'slab'
        ? 'slab polygon (no rooms drawn)'
        : 'not computed'
  return {
    title: 'CONDITIONED SPACE',
    columns: [
      { key: 'mark', label: 'QUANTITY', weight: 1.9 },
      { key: 'value', label: 'VALUE', weight: 1.1 },
      { key: 'basis', label: 'BASIS', weight: 2.1 },
    ],
    rows: [
      {
        mark: 'Conditioned floor area',
        value: `${sqft(model.conditionedFloorSqM)} SF`,
        basis,
      },
      {
        mark: 'Ceiling / roof area',
        value: `${sqft(model.ceilingSqM)} SF`,
        basis: 'footprint under roof, overhangs excluded',
      },
      {
        mark: 'Average ceiling height',
        value: feetInches(model.levelHeightM),
        basis: `${model.levelName} level height`,
      },
      {
        mark: 'Conditioned volume',
        value: `${Math.round(model.volumeCuM * CUFT_PER_CUM).toLocaleString('en-US')} CF`,
        basis: 'floor area × level height (flat ceiling)',
      },
      {
        mark: 'Gross exterior wall area',
        value: `${sqft(model.grossWallSqM)} SF`,
        basis: 'walls with one exterior face × height',
      },
      {
        mark: 'Glazing (window) area',
        value: `${sqft(model.windowSqM)} SF`,
        basis: 'windows hosted on exterior walls',
      },
      {
        mark: 'Glazing % of conditioned floor area',
        value: `${(model.glazingRatio * 100).toFixed(1)} %`,
        basis: 'window area ÷ conditioned floor area',
      },
    ],
    issues: [],
  }
}

/** The schedule prints W101 / D101; a bare resolved number gets the prefix. */
function scheduleMark(prefix: 'W' | 'D', mark: string | undefined): string {
  if (!mark) return '—'
  return /^\d+$/.test(mark) ? `${prefix}${mark}` : mark
}

function fenestrationTable(model: EnvelopeModel): ScheduleTable {
  return {
    title: 'FENESTRATION SCHEDULE',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.7 },
      { key: 'type', label: 'TYPE', weight: 1.3 },
      { key: 'face', label: 'FACE', weight: 0.6 },
      { key: 'size', label: 'SIZE', weight: 1.2 },
      { key: 'area', label: 'AREA SF', weight: 0.8 },
      { key: 'u', label: 'U-FACTOR', weight: 1.1 },
      { key: 'shgc', label: 'SHGC', weight: 1 },
    ],
    rows: model.fenestration.map((row) => ({
      mark: scheduleMark('W', row.mark),
      type: row.type.replace(/[-_]/g, ' ').toUpperCase(),
      face: row.orientation,
      size: `${feetInches(row.widthM)} × ${feetInches(row.heightM)}`,
      area: (row.areaSqM * SQFT_PER_SQM).toFixed(1),
      u: row.uFactor || 'PER NFRC LABEL',
      shgc: row.shgc || 'PER NFRC LABEL',
    })),
    issues: [],
  }
}

/**
 * The T24 sheet's "opaque surfaces" table: one row per exterior wall, with the
 * azimuth of its outward normal — the number an energy model is keyed on.
 */
function opaqueSurfaceTable(model: EnvelopeModel): ScheduleTable {
  return {
    title: 'OPAQUE SURFACES — EXTERIOR WALLS',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.7 },
      { key: 'face', label: 'FACE', weight: 0.6 },
      { key: 'azimuth', label: 'AZIMUTH', weight: 0.9 },
      { key: 'size', label: 'LENGTH × HT', weight: 1.5 },
      { key: 'gross', label: 'GROSS SF', weight: 0.9 },
      { key: 'openings', label: 'OPENINGS SF', weight: 1 },
      { key: 'net', label: 'NET SF', weight: 0.9 },
    ],
    rows: model.walls.map((wall) => ({
      mark: wall.mark,
      face: wall.orientation,
      azimuth: `${Math.round(wall.bearing)}°`,
      size: `${feetInches(wall.lengthM)} × ${feetInches(wall.heightM)}`,
      gross: sqft(wall.grossSqM),
      openings: sqft(wall.windowSqM + wall.doorSqM),
      net: sqft(wall.netSqM),
    })),
    issues: [],
  }
}

/** Exterior doors — the fenestration schedule's opaque companion. */
function doorTable(model: EnvelopeModel): ScheduleTable {
  return {
    title: 'EXTERIOR DOOR SCHEDULE',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.7 },
      { key: 'type', label: 'TYPE', weight: 1.3 },
      { key: 'face', label: 'FACE', weight: 0.6 },
      { key: 'size', label: 'SIZE', weight: 1.2 },
      { key: 'area', label: 'AREA SF', weight: 0.8 },
      { key: 'u', label: 'U-FACTOR', weight: 1.1 },
      { key: 'shgc', label: 'SHGC', weight: 1 },
    ],
    rows: model.exteriorDoors.map((row) => ({
      mark: row.mark || '—',
      type: row.type.replace(/[-_]/g, ' ').toUpperCase(),
      face: row.orientation,
      size: `${feetInches(row.widthM)} × ${feetInches(row.heightM)}`,
      area: (row.areaSqM * SQFT_PER_SQM).toFixed(1),
      u: row.uFactor || 'PER NFRC LABEL',
      shgc: row.shgc || 'PER NFRC LABEL',
    })),
    issues: [],
  }
}

/**
 * The energy provisions from the general-notes body, reprinted on the sheet
 * that carries the envelope — the same sentences, the same citations, so the
 * two sheets can never drift apart.
 */
function mandatoryMeasures(j: Jurisdiction): string[] {
  const section = generalNoteSections(j).find((entry) => /energy/i.test(entry.title))
  return (section?.notes ?? []).map((note, i) => noteLine(i + 1, note))
}

function requirementTable(j: Jurisdiction): {
  table: ScheduleTable
  notes: string[]
  code: { long: string; short: string }
} {
  const { rows, notes, code } = prescriptiveRequirements(j)
  return {
    code,
    notes,
    table: {
      title: 'PRESCRIPTIVE ENVELOPE REQUIREMENTS',
      columns: [
        { key: 'mark', label: 'COMPONENT', weight: 1.5 },
        { key: 'value', label: 'REQUIREMENT', weight: 2.2 },
        { key: 'source', label: 'SOURCE', weight: 2.2 },
      ],
      rows: rows.map((row) => ({
        mark: row.component,
        value: row.value,
        source: row.source,
      })),
      issues: [],
    },
  }
}

function climateBlock(
  j: Jurisdiction,
  model: EnvelopeModel,
  x: number,
  y: number,
  w: number,
): {
  geometry: FloorplanGeometry[]
  height: number
} {
  const out: FloorplanGeometry[] = []
  out.push(...heading(x, y, w, 'Climate zone & design data'))
  let cursor = y + 0.22
  const rows: [string, string][] = [
    [
      'IECC climate zone',
      j.climateZone
        ? j.climateZoneRaw && j.climateZoneRaw !== j.climateZone
          ? `${j.climateZone} — state table: ${j.climateZoneRaw}`
          : j.climateZone
        : 'NOT ESTABLISHED',
    ],
    [
      'Jurisdiction',
      [j.city, j.county && `${j.county} County`, j.stateName].filter(Boolean).join(', ') ||
        'NOT ESTABLISHED',
    ],
    ['Adopted residential code', j.resolved ? j.codeShort : 'NOT ESTABLISHED — IRC 2021 assumed'],
    [
      'Ultimate design wind speed',
      j.ultimateWindMph ? `${j.ultimateWindMph} mph (state typical)` : '—',
    ],
    ['Plan north rotation', `${model.northRotationDeg.toFixed(0)}°`],
  ]
  for (const [label, value] of rows) {
    cursor += LEAD
    out.push(text(x, cursor, label.toUpperCase(), BODY, { fill: INK_SOFT }))
    for (const [i, line] of wrap(value, BODY, w - 2.5).entries()) {
      out.push(text(x + w, cursor + i * LEAD, line, BODY, { weight: 600, anchor: 'end' }))
      if (i > 0) cursor += LEAD
    }
  }
  cursor += 0.1
  if (j.climateZoneCitation) {
    for (const line of wrap(`Zone source: ${j.climateZoneCitation.split('.')[0]}.`, 0.085, w)) {
      cursor += 0.115
      out.push(text(x, cursor, line, 0.085, { fill: INK_SOFT }))
    }
  }
  return { geometry: out, height: cursor - y + 0.12 }
}

function paragraph(
  x: number,
  y: number,
  w: number,
  lines: string[],
  size = BODY,
): { geometry: FloorplanGeometry[]; height: number } {
  const out: FloorplanGeometry[] = []
  let cursor = y
  for (const entry of lines) {
    for (const line of wrap(entry, size, w)) {
      cursor += size * 1.38
      out.push(text(x, cursor, line, size))
    }
    cursor += 0.05
  }
  return { geometry: out, height: cursor - y + 0.06 }
}

/* ------------------------------------------------------------ builder */

export function buildEnergyDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const vp = args.viewport
  if (!vp || vp.w <= 0 || vp.h <= 0) return null
  const box: Box = { x: vp.x, y: vp.y, w: vp.w, h: vp.h }
  const j = resolveJurisdiction(nodes)
  const levelId = args.levelId
  // The same marks the door and window schedules print, so a reader can
  // carry a number off A8.0 onto this sheet without translating.
  const marks = levelId
    ? {
        window: resolveMarks(nodes as never, levelId, 'window'),
        door: resolveMarks(nodes as never, levelId, 'door'),
      }
    : undefined
  const model = computeEnvelope(nodes, levelId, marks)

  const out: FloorplanGeometry[] = []

  // Title band across the whole field.
  out.push(text(box.x, box.y + 0.26, 'ENERGY COMPLIANCE', 0.26, { weight: 800 }))
  out.push(
    text(
      box.x + box.w,
      box.y + 0.26,
      `${model.levelName.toUpperCase()} — AREAS COMPUTED FROM THE MODEL`,
      0.12,
      {
        anchor: 'end',
        fill: INK_SOFT,
        weight: 600,
      },
    ),
  )
  out.push(rule(box.x, box.y + 0.36, box.w, 0.03))

  const columns = box.w > 20 ? 3 : box.w > 12 ? 2 : 1
  const gap = 0.45
  const colW = (box.w - gap * (columns - 1)) / columns
  const colX = (i: number) => box.x + Math.min(i, columns - 1) * (colW + gap)
  const top = box.y + 0.62
  const cursors = Array.from({ length: columns }, () => top)

  const place = (column: number, height: number): { x: number; y: number } => {
    const index = Math.min(column, columns - 1)
    const y = cursors[index] as number
    cursors[index] = y + height
    return { x: colX(index), y }
  }

  // ── column 1: what was measured ──────────────────────────────────────
  {
    const table = envelopeTable(model)
    const h = tableHeight(table.rows.length) + 0.02
    const at = place(0, h + 0.34)
    out.push(
      ...drawTable(table, at.x, at.y, colW, h, {
        title: table.title,
        legend: 'Measured off the model. Orientation is the wall’s outward normal.',
      }),
    )
  }
  {
    const table = areaTable(model)
    const h = tableHeight(table.rows.length) + 0.02
    const at = place(0, h + 0.34)
    out.push(
      ...drawTable(table, at.x, at.y, colW, h, {
        title: table.title,
        legend: 'Every value below is computed; none is entered by hand.',
      }),
    )
  }

  {
    const table = opaqueSurfaceTable(model)
    const h = tableHeight(Math.max(1, table.rows.length)) + 0.02
    const at = place(0, h + 0.34)
    out.push(
      ...drawTable(table, at.x, at.y, colW, h, {
        title: table.title,
        legend: 'One row per exterior wall — azimuth is the outward normal’s bearing.',
      }),
    )
  }

  // ── column 2: what the code asks for ────────────────────────────────
  const requirements = requirementTable(j)
  {
    const climate = climateBlock(
      j,
      model,
      colX(1),
      cursors[Math.min(1, columns - 1)] as number,
      colW,
    )
    place(1, climate.height + 0.26)
    out.push(...climate.geometry)
  }
  {
    const h = tableHeight(requirements.table.rows.length) + 0.02
    const at = place(1, h + 0.3)
    out.push(
      ...drawTable(requirements.table, at.x, at.y, colW, h, {
        title: requirements.table.title,
        legend: 'Values are printed only where this repository can cite them.',
      }),
    )
  }
  {
    const at = place(1, 0.2)
    const body = paragraph(at.x, at.y, colW, requirements.notes, 0.095)
    place(1, body.height + 0.24)
    out.push(...body.geometry)
  }
  {
    const at = place(1, 0.22)
    out.push(...heading(at.x, at.y, colW, 'Compliance path'))
    const body = paragraph(at.x, at.y + 0.12, colW, compliancePathNote(j, requirements.code))
    place(1, body.height + 0.2)
    out.push(...body.geometry)
  }

  // ── column 3: the windows, then the assumptions ─────────────────────
  {
    const table = fenestrationTable(model)
    const rowCount = Math.max(1, table.rows.length)
    const h = tableHeight(rowCount) + 0.02
    const at = place(2, h + 0.34)
    out.push(
      ...drawTable(table, at.x, at.y, colW, h, {
        title: table.title,
        legend: 'Marks match the window schedule. U / SHGC from the NFRC label.',
      }),
    )
  }
  {
    const table = doorTable(model)
    const h = tableHeight(Math.max(1, table.rows.length)) + 0.02
    const at = place(2, h + 0.34)
    out.push(
      ...drawTable(table, at.x, at.y, colW, h, {
        title: table.title,
        legend: 'Opaque and glazed doors in the exterior envelope.',
      }),
    )
  }
  {
    const at = place(2, 0.22)
    out.push(...heading(at.x, at.y, colW, 'Mandatory measures'))
    const body = paragraph(at.x, at.y + 0.12, colW, mandatoryMeasures(j), BODY)
    place(2, body.height + 0.24)
    out.push(...body.geometry)
  }
  {
    const at = place(2, 0.22)
    out.push(...heading(at.x, at.y, colW, 'Assumptions & caveats'))
    const body = paragraph(
      at.x,
      at.y + 0.12,
      colW,
      [...model.warnings, ...j.caveats].map((line) => `▸ ${line}`),
      0.095,
    )
    place(2, body.height + 0.2)
    out.push(...body.geometry)
  }

  const deepest = Math.max(...cursors)
  const warnings: string[] = []
  if (model.conditionedFloorSqM <= 0) {
    warnings.push('No conditioned floor area — draw rooms or a slab on this level.')
  }
  if (model.grossWallSqM <= 0) {
    warnings.push(
      'No exterior walls found — mark wall faces exterior before relying on this sheet.',
    )
  }
  if (deepest > box.y + box.h - WARNING_BAND) {
    warnings.push('Energy blocks are taller than this viewport — enlarge it or split the sheet.')
  }
  warnings.push('Pascal computes areas only; it does not run an energy compliance calculation.')

  return {
    primitives: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    plate: out,
    warnings,
    noLabel: true,
    title: 'Energy compliance',
  }
}

export function registerEnergyProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('energy', (nodes, args) => buildEnergyDrawing(nodes, args as unknown as ProviderArgs))
}
