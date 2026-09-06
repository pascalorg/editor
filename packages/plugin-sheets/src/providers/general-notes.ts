/**
 * 'general-notes' sheet drawing provider — the paper a permit set carries
 * that is not a drawing.
 *
 * `args.notesKey` selects which block:
 *   'general'           A0.1's dedicated code-cited notes sheet, flowed into
 *                       as many columns as the viewport is wide.
 *   'attic-ventilation' the R806 venting calculation + diagram, sized for the
 *                       right-hand column of A3.0 beside the roof plan.
 *   'roof'              the short roof-plan note block.
 *
 * Everything is emitted as a PLATE — absolute sheet inches inside
 * `args.viewport` — because none of it is a window onto the model.
 *
 * THE ONE RULE THIS FILE KEEPS: nothing is printed that the repo cannot
 * source. The code name comes out of Bones' researched adoption table, the
 * climate zone out of its wall-assembly table, the attic area out of the roof
 * segments' own footprints. Where a section number is uncertain the note says
 * "(verify: …)" rather than looking authoritative. Where the sheet runs out of
 * paper it says "continued on next sheet" and warns, rather than dropping
 * notes silently.
 */
import { type FloorplanGeometry, resolveWallAssembly } from '@pascal-app/core'
import { drawTable, measureTable, tableHeight } from '../draw-table'
import type { DrawingProvider, DrawingResult, ProviderArgs } from '../drawings'
import type { AnyNodeLike, NodeMap } from '../model'
import { computeAtticVentilation, R806_1_NOTES, R806_2_EXCEPTION_CONDITIONS } from '../notes/attic'
import {
  generalNoteSections,
  type Note,
  type NoteSection,
  noteLine,
  roofNotes,
} from '../notes/general'
import { fireSeparation, type FireSeparationWall, formatSeparation, isExteriorWall } from '../notes/fire-separation'
import { codeHeaderLine, type Jurisdiction, resolveJurisdiction, retagCode } from '../notes/jurisdiction'
import { prescriptiveRequirements } from '../notes/prescriptive'
import { formatInchFraction, structuralModel } from './structural/model'
import type { ScheduleTable } from '../schedule'
import { INK, INK_SOFT, SANS } from '../titleblock'

/* ------------------------------------------------------------ metrics */

/** Approximate set width per character, as a fraction of the font size. */
const CHAR_W = 0.55

const NOTE_SIZE = 0.13
const NOTE_LEAD = 0.178
const HEAD_SIZE = 0.175
const TITLE_SIZE = 0.26
/** Strip at the bottom of a viewport the host paints provider warnings into. */
const WARNING_BAND = 0.82
/** Body type in the attic-ventilation block, matched to the notes columns. */
const ATTIC_BODY = 0.115
const ATTIC_LEAD = 0.155

export type Box = { x: number; y: number; w: number; h: number }

export function measureIn(value: string, fontSize: number): number {
  return value.length * fontSize * CHAR_W
}

/** Break a paragraph into lines that fit `maxW` inches at `fontSize`. */
export function wrapToWidth(value: string, fontSize: number, maxW: number): string[] {
  const max = Math.max(8, Math.floor(maxW / (fontSize * CHAR_W)))
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

/**
 * How many columns a notes field of width `w` gets. Column width is held near
 * 6.3 in — about 88 characters at a 0.13 in note, the measure dense notes
 * read comfortably at — so a full ARCH D field lands on five columns like the
 * reference sheet and a narrow strip lands on one.
 */
export function columnsFor(
  w: number,
  gap = 0.3,
  target = 6.3,
  max = 6,
): { count: number; width: number; gap: number } {
  const count = Math.min(max, Math.max(1, Math.round((w + gap) / (target + gap))))
  return { count, width: (w - gap * (count - 1)) / count, gap }
}

/* ------------------------------------------------------------ drawing */

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  opts: {
    weight?: number
    fill?: string
    family?: string
    anchor?: 'start' | 'middle' | 'end'
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

/* -------------------------------------------------------- column flow */

/** One unbreakable run of lines — a section heading, or one numbered note. */
type Block = {
  lines: { value: string; size: number; weight: number; indent: number }[]
  /** Height the block occupies, inches, including its trailing space. */
  height: number
  /** Draw a heavy rule under the first line (section headings). */
  ruled?: boolean
}

function headingBlock(title: string): Block {
  return {
    lines: [{ value: title.toUpperCase(), size: HEAD_SIZE, weight: 800, indent: 0 }],
    height: HEAD_SIZE + 0.22,
    ruled: true,
  }
}

/** Hanging indent: the number sits proud, every line after it is inset. */
const NOTE_INDENT = NOTE_SIZE * CHAR_W * 4

/**
 * Wrap with a hanging indent — the continuation lines have LESS room than the
 * first, and must be wrapped to that narrower measure or they run past the
 * column they were flowed into.
 */
export function wrapHanging(
  value: string,
  fontSize: number,
  width: number,
  indent: number,
): string[] {
  const first = Math.max(8, Math.floor(width / (fontSize * CHAR_W)))
  const rest = Math.max(8, Math.floor((width - indent) / (fontSize * CHAR_W)))
  const out: string[] = []
  let line = ''
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const limit = out.length === 0 ? first : rest
    const next = line ? `${line} ${word}` : word
    if (line && next.length > limit) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out.length > 0 ? out : ['']
}

/** A numbered note as a block — the citation is part of the flowed text. */
function noteBlock(index: number, note: Note, width: number): Block {
  const lines = wrapHanging(noteLine(index, note), NOTE_SIZE, width, NOTE_INDENT)
  return {
    lines: lines.map((value, i) => ({
      value,
      size: NOTE_SIZE,
      weight: 400,
      indent: i === 0 ? 0 : NOTE_INDENT,
    })),
    height: lines.length * NOTE_LEAD + 0.06,
  }
}

function blocksFor(sections: NoteSection[], width: number): Block[] {
  const blocks: Block[] = []
  for (const section of sections) {
    blocks.push(headingBlock(section.title))
    section.notes.forEach((note, i) => {
      blocks.push(noteBlock(i + 1, note, width))
    })
  }
  return blocks
}

/**
 * Pack blocks into columns, top to bottom then left to right. A block is
 * never split; a heading that would land in the last two lines of a column is
 * pushed to the next one so it never orphans from its first note.
 */
export function packColumns(
  blocks: Block[],
  columnCount: number,
  columnHeight: number,
): { placed: { block: Block; column: number; y: number }[]; overflow: number } {
  const placed: { block: Block; column: number; y: number }[] = []
  let column = 0
  let cursor = 0
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as Block
    const orphan = block.ruled === true && cursor + block.height + NOTE_LEAD * 2 > columnHeight
    if (cursor + block.height > columnHeight || orphan) {
      column += 1
      cursor = 0
      if (column >= columnCount) return { placed, overflow: blocks.length - i }
    }
    placed.push({ block, column, y: cursor })
    cursor += block.height
  }
  return { placed, overflow: 0 }
}

/**
 * BALANCE the columns instead of filling them.
 *
 * Greedy top-to-bottom filling would pour a hundred notes into the left three
 * columns of a five-column field and leave the right two blank, which reads as
 * a mistake rather than as a layout. So the column height starts at the even
 * share — total content ÷ column count — and grows only until everything
 * fits, which spreads the notes across every column and leaves one even band
 * of white at the foot of the sheet. Content that genuinely does not fit the
 * field still overflows at the full height, and still says so.
 */
export function balancedColumnHeight(
  blocks: Block[],
  columnCount: number,
  maxHeight: number,
): number {
  const total = blocks.reduce((sum, block) => sum + block.height, 0)
  const tallest = blocks.reduce((max, block) => Math.max(max, block.height), 0)
  let height = Math.max(total / columnCount, tallest + 0.02)
  for (let i = 0; i < 80 && height < maxHeight; i += 1) {
    if (packColumns(blocks, columnCount, height).overflow === 0) return height
    height = Math.min(maxHeight, height * 1.03)
  }
  return maxHeight
}

function drawBlocks(
  placed: { block: Block; column: number; y: number }[],
  origin: { x: number; y: number },
  columns: { count: number; width: number; gap: number },
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  for (const { block, column, y } of placed) {
    const cx = origin.x + column * (columns.width + columns.gap)
    let cy = origin.y + y
    block.lines.forEach((line, i) => {
      cy += line.size
      out.push(text(cx + line.indent, cy, line.value, line.size, { weight: line.weight }))
      if (i === 0 && block.ruled === true) {
        out.push(rule(cx, cy + 0.06, columns.width, 0.018))
        cy += 0.06
      }
      cy += NOTE_LEAD - line.size
    })
  }
  return out
}

/* -------------------------------------------------------- notes sheet */

function notesPlate(
  box: Box,
  title: string,
  sections: NoteSection[],
  j: Jurisdiction,
): { plate: FloorplanGeometry[]; warnings: string[] } {
  const out: FloorplanGeometry[] = []
  const warnings: string[] = []

  // Header: the sheet title, then the one line saying what the section
  // numbers under it actually refer to.
  out.push(text(box.x, box.y + TITLE_SIZE, title.toUpperCase(), TITLE_SIZE, { weight: 800 }))
  out.push(rule(box.x, box.y + TITLE_SIZE + 0.1, box.w, 0.03))
  const headLines = wrapToWidth(codeHeaderLine(j), 0.11, box.w)
  headLines.forEach((line, i) => {
    out.push(text(box.x, box.y + TITLE_SIZE + 0.34 + i * 0.155, line, 0.11, { weight: 700 }))
  })
  const headerH = TITLE_SIZE + 0.34 + headLines.length * 0.155 + 0.14

  // Footer band: the caveats the data files themselves carry, kept clear of
  // the strip the host paints provider warnings into.
  const caveatLines = j.caveats
    .slice(0, 4)
    .flatMap((line) => wrapToWidth(`▸ ${line}`, 0.095, box.w - 0.2))
  const footerH = caveatLines.length > 0 ? caveatLines.length * 0.13 + 0.24 : 0
  const footerTop = box.y + box.h - WARNING_BAND - footerH
  if (caveatLines.length > 0) {
    out.push({
      kind: 'rect',
      x: box.x,
      y: footerTop,
      width: box.w,
      height: footerH,
      fill: '#fffbeb',
      stroke: '#b45309',
      strokeWidth: 0.012,
    })
    caveatLines.forEach((line, i) => {
      out.push(text(box.x + 0.1, footerTop + 0.18 + i * 0.13, line, 0.095, { fill: '#92400e' }))
    })
  }

  const columns = columnsFor(box.w)
  const origin = { x: box.x, y: box.y + headerH }
  const columnHeight = Math.max(1, footerTop - origin.y - 0.16)

  const blocks = blocksFor(sections, columns.width)
  const balanced = balancedColumnHeight(blocks, columns.count, columnHeight)
  const { placed, overflow } = packColumns(blocks, columns.count, balanced)
  out.push(...drawBlocks(placed, origin, columns))

  if (overflow > 0) {
    out.push(
      text(
        origin.x + (columns.count - 1) * (columns.width + columns.gap),
        origin.y + balanced + 0.13,
        `(continued on next sheet — ${overflow} more items)`,
        0.105,
        { weight: 700, fill: '#b45309' },
      ),
    )
    warnings.push(
      `${overflow} of ${blocks.length} note blocks did not fit this viewport — enlarge it or add a second notes sheet.`,
    )
  }
  return { plate: out, warnings }
}

/* --------------------------------------------------- attic ventilation */

function feetInchesFromMetres(metres: number): string {
  const totalInches = Math.round(metres * 39.3700787401575)
  const feet = Math.floor(totalInches / 12)
  return `${feet}'-${totalInches - feet * 12}"`
}

function commas(value: number, places = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/**
 * A small section through a vented attic: intake low, exhaust high. Drawn
 * rather than described because the reference sheet's venting block carries a
 * diagram and it is the fastest way to say "high AND low, both".
 */
function ventDiagram(box: Box): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const w = Math.min(box.w, 4.8)
  const h = box.h
  const x = box.x + (box.w - w) / 2
  const y = box.y
  const apex: [number, number] = [x + w / 2, y + 0.14]
  const eaveY = y + h - 0.42
  out.push({
    kind: 'polyline',
    points: [[x, eaveY], apex, [x + w, eaveY]],
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.022,
  })
  // Ceiling plane with an insulation band under it.
  out.push({
    kind: 'rect',
    x: x + 0.4,
    y: eaveY,
    width: w - 0.8,
    height: 0.11,
    fill: '#e5e7eb',
    stroke: 'none',
  })
  out.push(rule(x + 0.4, eaveY, w - 0.8, 0.016))
  // Ridge exhaust, up and out.
  out.push({
    kind: 'line',
    x1: apex[0],
    y1: apex[1],
    x2: apex[0],
    y2: y - 0.18,
    stroke: INK,
    strokeWidth: 0.018,
  })
  out.push({
    kind: 'polygon',
    points: [
      [apex[0], y - 0.28],
      [apex[0] - 0.055, y - 0.15],
      [apex[0] + 0.055, y - 0.15],
    ],
    fill: INK,
    stroke: 'none',
  })
  out.push(text(apex[0] + 0.12, y - 0.16, 'UPPER VENT 40–50 %', 0.1, { fill: INK_SOFT }))
  // Eave intakes, in and up under the sheathing.
  for (const dir of [1, -1] as const) {
    const sx = dir === 1 ? x + 0.06 : x + w - 0.06
    out.push({
      kind: 'polyline',
      points: [
        [sx - dir * 0.4, eaveY - 0.06],
        [sx + dir * 0.16, eaveY - 0.06],
        [sx + dir * 0.38, eaveY - 0.34],
      ],
      fill: 'none',
      stroke: INK,
      strokeWidth: 0.016,
    })
    out.push({
      kind: 'polygon',
      points: [
        [sx + dir * 0.46, eaveY - 0.44],
        [sx + dir * 0.28, eaveY - 0.28],
        [sx + dir * 0.4, eaveY - 0.22],
      ],
      fill: INK,
      stroke: 'none',
    })
  }
  out.push(text(x, y + h + 0.02, 'EAVE / SOFFIT INTAKE — BALANCE', 0.1, { fill: INK_SOFT }))
  out.push(
    text(x + w, y + h + 0.02, '1" MIN. AIRSPACE AT BAFFLE (R806.3)', 0.1, {
      fill: INK_SOFT,
      anchor: 'end',
    }),
  )
  return out
}

function atticPlate(
  nodes: NodeMap,
  box: Box,
  j: Jurisdiction,
): { plate: FloorplanGeometry[]; warnings: string[] } {
  const vent = computeAtticVentilation(nodes)
  const out: FloorplanGeometry[] = []

  out.push(text(box.x, box.y + 0.22, 'ROOF VENTING CALCULATION & DIAGRAM', 0.22, { weight: 800 }))
  out.push(rule(box.x, box.y + 0.3, box.w, 0.028))
  out.push(
    text(
      box.x,
      box.y + 0.5,
      `Attic ventilation per ${j.resolved ? j.codeShort : 'IRC 2021'} — Section R806.`,
      0.115,
      { fill: INK_SOFT },
    ),
  )

  let cursor = box.y + 0.72

  // ── the vented area, segment by segment ──────────────────────────────
  const areaTable: ScheduleTable = {
    title: 'VENTED ATTIC AREA',
    columns: [
      { key: 'mark', label: 'ROOF', weight: 0.7 },
      { key: 'type', label: 'TYPE', weight: 0.9 },
      { key: 'pitch', label: 'PITCH', weight: 0.8 },
      { key: 'size', label: 'FOOTPRINT', weight: 1.7 },
      { key: 'area', label: 'AREA SF', weight: 1 },
    ],
    rows: vent.segments.map((segment, i) => ({
      mark: `R${i + 1}`,
      type: segment.roofType.toUpperCase(),
      pitch: segment.pitch,
      size: `${feetInchesFromMetres(segment.widthM)} × ${feetInchesFromMetres(segment.depthM)}`,
      area: commas(segment.areaSqFt),
    })),
    issues: [],
  }
  areaTable.rows.push({
    mark: 'TOTAL',
    type: '',
    pitch: '',
    size: 'VENTED ATTIC AREA',
    area: commas(vent.areaSqFt),
  })
  // +0.02 guards the row-capacity division in `drawTable` against the
  // floating-point shortfall that silently drops the last row.
  const areaH = tableHeight(areaTable.rows.length) + 0.02
  out.push(
    ...drawTable(areaTable, box.x, cursor, box.w, areaH, {
      title: areaTable.title,
      legend: 'Footprint under the roof — segment width × depth. Eave overhangs excluded.',
    }),
  )
  cursor += areaH + 0.34

  // ── required net free area, both ratios ──────────────────────────────
  const sqFt150 = vent.required150SqIn / 144
  const sqFt300 = vent.required300SqIn / 144
  const reqTable: ScheduleTable = {
    title: 'REQUIRED NET FREE VENTILATING AREA',
    columns: [
      { key: 'mark', label: 'SECTION', weight: 0.9 },
      { key: 'rule', label: 'BASIS', weight: 2.6 },
      { key: 'ratio', label: 'RATIO', weight: 0.7 },
      { key: 'area', label: 'REQUIRED NFA', weight: 1.9 },
    ],
    rows: [
      {
        mark: 'R806.2',
        rule: 'Minimum vent area — no conditions',
        ratio: '1/150',
        area: `${sqFt150.toFixed(2)} SF = ${commas(vent.required150SqIn)} SQ IN`,
      },
      {
        mark: 'R806.2',
        rule: 'Exception — both conditions below met',
        ratio: '1/300',
        area: `${sqFt300.toFixed(2)} SF = ${commas(vent.required300SqIn)} SQ IN`,
      },
      {
        mark: '',
        rule: '· upper portion (ridge / gable / off-ridge), 40–50 %',
        ratio: '',
        area: `${commas(vent.upperShare.minSqIn)} – ${commas(vent.upperShare.maxSqIn)} SQ IN`,
      },
      {
        mark: '',
        rule: '· balance at eave / soffit / frieze, 50–60 %',
        ratio: '',
        area: `${commas(vent.lowerShare.minSqIn)} – ${commas(vent.lowerShare.maxSqIn)} SQ IN`,
      },
    ],
    issues: [],
  }
  const reqH = tableHeight(reqTable.rows.length) + 0.02
  out.push(
    ...drawTable(reqTable, box.x, cursor, box.w, reqH, {
      title: reqTable.title,
      legend: 'Both ratios are printed; Pascal does not choose between them.',
    }),
  )
  cursor += reqH + 0.4

  // ── what the 1/300 exception costs ───────────────────────────────────
  out.push(
    text(box.x, cursor, 'R806.2 EXCEPTION — BOTH CONDITIONS REQUIRED', 0.135, { weight: 800 }),
  )
  cursor += 0.19
  for (const condition of R806_2_EXCEPTION_CONDITIONS) {
    for (const line of wrapToWidth(condition, ATTIC_BODY, box.w)) {
      cursor += ATTIC_LEAD
      out.push(text(box.x, cursor, line, ATTIC_BODY))
    }
    cursor += 0.06
  }

  // ── the diagram ──────────────────────────────────────────────────────
  cursor += 0.5
  out.push(...ventDiagram({ x: box.x, y: cursor, w: box.w, h: 1.3 }))
  cursor += 1.58

  // ── R806.1, and the refusal to pick a vent product ───────────────────
  out.push(text(box.x, cursor, 'R806.1 VENTILATION REQUIRED', 0.135, { weight: 800 }))
  cursor += 0.19
  for (const note of R806_1_NOTES) {
    for (const line of wrapToWidth(note, ATTIC_BODY, box.w)) {
      cursor += ATTIC_LEAD
      out.push(text(box.x, cursor, line, ATTIC_BODY))
    }
    cursor += 0.06
  }

  const warnings = [...vent.warnings]
  if (cursor > box.y + box.h - WARNING_BAND) {
    warnings.unshift('Venting block is taller than its viewport — enlarge it.')
  }

  // ── the roof notes, in whatever column is left ───────────────────────
  // A3.0's right-hand strip is a whole sheet tall and the venting block only
  // needs its top third. Rather than leave two feet of blank paper beside the
  // roof plan, the roof's own note block finishes the column.
  const remaining = box.y + box.h - WARNING_BAND - cursor - 0.5
  if (remaining > 2) {
    const roofBlocks = blocksFor(roofNotes(j), box.w)
    const { placed, overflow } = packColumns(roofBlocks, 1, remaining)
    out.push(
      ...drawBlocks(placed, { x: box.x, y: cursor + 0.5 }, { count: 1, width: box.w, gap: 0 }),
    )
    if (overflow > 0) warnings.push(`${overflow} roof notes did not fit beside the roof plan.`)
  }

  return { plate: out, warnings }
}

/* -------------------------------------------------------- assemblies */

/**
 * The assemblies the sections cut through, as a schedule: every wall
 * assembly the level's walls carry (layers outside → in from
 * `resolveWallAssembly`, the framing from the Bones spec that framed it),
 * the roof/ceiling (the finish schedule's roofing, the sheathing and
 * rafters or trusses Bones framed, the ceiling insulation the energy code
 * asks for) and the floor (the platform Bones framed, or the slab). Every
 * R-value is the jurisdiction data's or reads "(verify)"; every layer
 * thickness is the assembly's own. Fire ratings print where a wall carries
 * one (the garage separation, a wall within 5 ft of a lot line).
 */
function assembliesPlate(
  nodes: NodeMap,
  box: Box,
  j: Jurisdiction,
  levelId: string | undefined,
): { plate: FloorplanGeometry[]; warnings: string[] } {
  const warnings: string[] = []
  const model = structuralModel(nodes, levelId)
  const spec = model?.spec
  const inch = (m: number) => formatInchFraction(m)
  const spacing = (m: number) => `${Math.round(m / 0.0254)}" o.c.`
  const level = levelId ? nodes[levelId] : undefined
  const building = typeof level?.parentId === 'string' ? nodes[level.parentId] : undefined
  const finishes = (building?.metadata as { finishes?: { roof?: { label?: string } } } | undefined)
    ?.finishes
  const requirements = prescriptiveRequirements(j)
  const req = (component: string): string =>
    requirements.rows.find((r) => r.component === component)?.value ?? '(verify)'
  const wallR = j.wallInsulation ? j.wallInsulation.value.replace(/^R(\d)/, 'R-$1') : '(verify)'

  type Row = { mark: string; assembly: string; construction: string; insulation: string; fire: string; ref: string }
  const rows: Row[] = []

  // walls, grouped by their assembly preset (or their bare thickness)
  const walls = Object.values(nodes).filter(
    (n) => n?.type === 'wall' && (!levelId || n.parentId === levelId) && n.visible !== false,
  )
  // a wall within 5 ft of the lot line is rated whether or not anyone wrote it on the node
  const separation = fireSeparation(nodes, levelId)
  const nearLine = (id: string): string => {
    const hit = separation.walls.find((w) => w.wallId === id && w.wallRule === 'rated')
    return hit && hit.distance !== null ? `R302.1 — ${formatSeparation(hit.distance)} to the lot line` : ''
  }
  const groups = new Map<string, { wall: AnyNodeLike; count: number; exterior: boolean; garage: boolean; rated: string }>()
  for (const wall of walls) {
    const assembly = wall.assembly as { preset?: string } | undefined
    const meta = (wall.metadata ?? {}) as Record<string, unknown>
    const rated = typeof meta.fireRated === 'string' ? meta.fireRated : nearLine(wall.id)
    const garage = meta.role === 'garage-separation'
    const key = `${assembly?.preset ?? `wall-${Math.round(((wall.thickness as number) ?? 0) * 1000)}`}|${garage}|${rated}`
    const hit = groups.get(key)
    if (hit) hit.count += 1
    else
      groups.set(key, {
        wall,
        count: 1,
        exterior: isExteriorWall(wall),
        garage,
        rated,
      })
  }
  let w = 1
  for (const g of [...groups.values()].sort((a, b) => Number(b.exterior) - Number(a.exterior))) {
    const resolved = resolveWallAssembly(g.wall as never)
    const stud = g.exterior ? spec?.exteriorStudSize : (spec as { interiorStudSize?: string } | undefined)?.interiorStudSize
    const layers = resolved.layers
      .map((layer) =>
        layer.role === 'framing'
          ? `${stud ?? layer.material} studs @ ${spec ? spacing(spec.studSpacing) : '16" o.c.'}${g.exterior ? ` + ${wallR} cavity` : ''}`
          : `${inch(layer.thickness)} ${layer.material}`,
      )
      .join(' / ')
    const fire = g.rated
      ? `1-HR both sides (ASTM E119): 5/8" Type X gyp. each face of the studs, e.g. UL U305 — verify the listed assembly. ${g.rated}`
      : g.garage
        ? '1/2" gyp. bd. on the garage side (R302.6)'
        : '—'
    rows.push({
      mark: `W${w++}`,
      assembly: `${g.exterior ? (g.rated ? 'EXTERIOR WALL — RATED' : 'EXTERIOR WALL') : g.garage ? 'GARAGE SEPARATION' : 'INTERIOR PARTITION'} (${g.count})`,
      construction: layers,
      insulation: g.exterior ? `${wallR} (${j.wallInsulation?.citation ?? 'verify'})` : '—',
      fire,
      ref: g.exterior ? 'R602.3, R703' : 'R602.3, R702.3',
    })
  }
  if (rows.length === 0) warnings.push('No walls on this level — no wall assemblies to schedule.')

  // roof / ceiling
  if (spec) {
    const roofing = finishes?.roof?.label ? `${finishes.roof.label} roofing` : 'roofing per schedule'
    const structure =
      model?.roofSystem === 'truss'
        ? `pre-engineered trusses @ ${spacing(spec.rafterSpacing)} (deferred submittal, R802.10.1)`
        : `${spec.rafterSize} rafters @ ${spacing(spec.rafterSpacing)} / ${spec.ceilingJoistSize} clg. joists @ ${spacing(spec.ceilingJoistSpacing)}`
    rows.push({
      mark: 'R1',
      assembly: 'ROOF / CEILING',
      construction: `${roofing} / underlayment (R905) / 7/16" WSP sheathing (R803.2) / ${structure} / 1/2" gyp. bd. ceiling`,
      insulation: `${req('Ceiling / attic')} at the ceiling, vented attic (R806)`,
      fire: '—',
      ref: 'R802, R803, R905',
    })
  }

  // floor
  if (model) {
    rows.push(
      model.raisedFloor
        ? {
            mark: 'F1',
            assembly: 'FLOOR — FRAMED PLATFORM',
            construction: `finish flooring / 23/32" T&G WSP subfloor (R503.2) / floor joists per S2.0 @ ${spec ? spacing(spec.joistSpacing) : '16" o.c.'} / crawl space, Class I vapor retarder on grade (R408)`,
            insulation: `${req('Floor')} between joists`,
            fire: '—',
            ref: 'R502, R503, R408',
          }
        : {
            mark: 'F1',
            assembly: 'FLOOR — SLAB ON GRADE',
            construction: 'finish flooring / 3-1/2" min. concrete slab (R506.1) / 6-mil vapor retarder (R506.2.3) / 4" base course / treated fill (R318)',
            insulation: `${req('Slab edge (R-value / depth)')} slab edge`,
            fire: '—',
            ref: 'R506, R318',
          },
    )
  }

  const table: ScheduleTable = {
    title: 'ASSEMBLIES',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.7 },
      { key: 'assembly', label: 'ASSEMBLY', weight: 1.8 },
      { key: 'construction', label: 'CONSTRUCTION — OUTSIDE TO INSIDE / TOP TO BOTTOM', weight: 4.6 },
      { key: 'insulation', label: 'INSULATION', weight: 2.1 },
      { key: 'fire', label: 'FIRE', weight: 2.6 },
      { key: 'ref', label: 'REF', weight: 1.1 },
    ],
    rows: rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, retagCode(v, j.codeTag)])),
    ),
    issues: [],
  }
  const plate = drawTable(table, box.x, box.y, box.w, box.h, {
    title: 'WALL, ROOF & FLOOR ASSEMBLIES',
    legend: `Layers from each wall's assembly; framing from the Bones spec that framed it; insulation from the ${j.codeShort} prescriptive table where the data cites it.`,
    wrap: true,
  })
  return { plate, warnings }
}

/**
 * Fire separation distance, as the site plan's table: every exterior wall
 * of the level, how far its face stands from the lot line at a right angle
 * (R202), how far the roof projects toward it, and what Table R302.1(1)
 * asks of the wall, the projection and the openings at that distance. The
 * walls the table rates are the ones the floor plan marks and the
 * assembly schedule lists as rated; a wall that breaks its rule (openings
 * where none are permitted, a roof too close) is called out.
 */
function fireSeparationPlate(
  nodes: NodeMap,
  box: Box,
  levelId: string | undefined,
): { plate: FloorplanGeometry[]; warnings: string[] } {
  const fs = fireSeparation(nodes, levelId)
  const warnings = fs.walls.flatMap((w) => w.issues.map((issue) => `${w.faces} wall: ${issue}`))
  const plate: FloorplanGeometry[] = []
  const ft = (m: number | null): string => (m === null ? '—' : formatSeparation(m))
  const wallCell = (w: FireSeparationWall): string =>
    w.toStreet ? 'none (street)' : w.wallRule === 'rated' ? '1-HR BOTH SIDES' : 'none'
  const projectionCell = (w: FireSeparationWall): string =>
    w.projectionRule === 'not-permitted'
      ? 'NOT PERMITTED'
      : w.projectionRule === 'rated-underside'
        ? '1-HR UNDERSIDE'
        : w.toStreet
          ? 'none (street)'
          : 'none'
  const openingsCell = (w: FireSeparationWall): string => {
    const pct = w.wallArea > 0 ? `${Math.round((w.openingArea / w.wallArea) * 100)}%` : '—'
    const rule =
      w.openingRule === 'not-permitted'
        ? 'NONE PERMITTED'
        : w.openingRule === 'limit-25'
          ? '25% MAX'
          : 'unlimited'
    return `${w.openings} (${pct}) — ${rule}`
  }
  // the lot edge the face looks at rides with the distance: 3 ft (left), 20 ft (street)
  const edgeOf = (w: FireSeparationWall): string => (w.edge ? (w.edge === 'front' ? 'street' : w.edge) : '?')
  const rows = fs.walls.map((w) => ({
    wall: `${w.name.toUpperCase()}${w.roofRole ? ` — ${w.roofRole.replace('-', ' ')}` : ''}`,
    faces: w.faces,
    distance: `${ft(w.distance)} (${edgeOf(w)})`,
    rating: wallCell(w),
    projection:
      w.projectionDistance !== null && w.projectionDistance < 0
        ? `${w.projectionKind} ${ft(w.projection)} → OVER THE LINE by ${ft(-w.projectionDistance)}`
        : `${w.projectionKind} ${ft(w.projection)} → ${ft(w.projectionDistance)}`,
    projectionRule: projectionCell(w),
    openings: openingsCell(w),
  }))
  const table: ScheduleTable = {
    title: 'FIRE SEPARATION',
    columns: [
      { key: 'wall', label: 'WALL', weight: 2.1 },
      { key: 'faces', label: 'FACES', weight: 0.65 },
      { key: 'distance', label: 'TO LOT LINE', weight: 1.4 },
      { key: 'rating', label: 'WALL RATING', weight: 1.4 },
      { key: 'projection', label: 'PROJECTION → LINE', weight: 1.5 },
      { key: 'projectionRule', label: 'PROJECTION', weight: 1.4 },
      { key: 'openings', label: 'OPENINGS', weight: 1.9 },
    ],
    rows,
    issues: [],
  }
  const tableOptions = {
    title: 'Fire separation distance — R302.1',
    legend:
      'Table R302.1(1): wall < 5 ft 1-hr both sides · projection < 2 ft not permitted, 2–5 ft 1-hr underside · openings < 3 ft none, 3–5 ft 25% max · penetrations < 3 ft per R302.4',
    wrap: true,
  }
  if (fs.measured) {
    plate.push(...drawTable(table, box.x, box.y, box.w, box.h, tableOptions))
  } else {
    plate.push({
      kind: 'text',
      x: box.x,
      y: box.y + 0.21,
      text: 'FIRE SEPARATION DISTANCE — R302.1',
      fontSize: 0.24,
      fill: INK,
      fontWeight: 800,
      fontFamily: SANS,
    })
  }
  // the caveats, wrapped under the table
  const top = box.y + (fs.measured ? measureTable(table, box.w, tableOptions) + 0.3 : 0.6)
  const chars = Math.max(30, Math.floor(box.w / (0.11 * CHAR_W)))
  let y = top
  for (const caveat of fs.caveats) {
    const words = caveat.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      if (line && line.length + 1 + word.length > chars) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line) lines.push(line)
    for (const text of lines) {
      if (y > box.y + box.h - 0.2) break
      plate.push({ kind: 'text', x: box.x, y, text, fontSize: 0.11, fill: INK_SOFT, fontFamily: SANS })
      y += 0.16
    }
    y += 0.06
  }
  return { plate, warnings }
}

/* ----------------------------------------------------------- provider */

export function buildGeneralNotesDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const vp = args.viewport
  if (!vp || vp.w <= 0 || vp.h <= 0) return null
  const box: Box = { x: vp.x, y: vp.y, w: vp.w, h: vp.h }
  const j = resolveJurisdiction(nodes)
  const key = args.notesKey ?? 'general'
  const empty = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  if (key === 'attic-ventilation') {
    const { plate, warnings } = atticPlate(nodes, box, j)
    return {
      primitives: [],
      bounds: empty,
      plate,
      warnings,
      noLabel: true,
      title: 'Roof venting calculation',
    }
  }

  if (key === 'roof') {
    const { plate, warnings } = notesPlate(box, 'Roof notes', roofNotes(j), j)
    return { primitives: [], bounds: empty, plate, warnings, noLabel: true, title: 'Roof notes' }
  }

  if (key === 'fire-separation') {
    const { plate, warnings } = fireSeparationPlate(nodes, box, args.levelId)
    return {
      primitives: [],
      bounds: empty,
      plate,
      warnings,
      noLabel: true,
      title: 'Fire separation distance',
    }
  }

  if (key === 'assemblies') {
    const { plate, warnings } = assembliesPlate(nodes, box, j, args.levelId)
    return {
      primitives: [],
      bounds: empty,
      plate,
      warnings,
      noLabel: true,
      title: 'Wall, roof & floor assemblies',
    }
  }

  const { plate, warnings } = notesPlate(box, 'General notes', generalNoteSections(j), j)
  return { primitives: [], bounds: empty, plate, warnings, noLabel: true, title: 'General notes' }
}

export function registerGeneralNotesProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('general-notes', (nodes, args) =>
    buildGeneralNotesDrawing(nodes, args as unknown as ProviderArgs),
  )
}

/* ----------------------------------------------------------- for tests */

/**
 * The flowed layout without the geometry — what the fit test asserts on: do
 * all the notes land inside the columns of a full ARCH D field, and does any
 * single line run past its column?
 */
export function layoutGeneralNotes(
  box: Box,
  sections: NoteSection[],
): {
  columns: number
  columnWidth: number
  blocks: number
  overflow: number
  longestLineIn: number
} {
  const columns = columnsFor(box.w)
  const blocks = blocksFor(sections, columns.width)
  // Matches `notesPlate`: header (~0.9 in) + a four-line caveat band.
  const columnHeight = Math.max(1, box.h - 0.95 - WARNING_BAND - 0.9)
  const balanced = balancedColumnHeight(blocks, columns.count, columnHeight)
  const { overflow } = packColumns(blocks, columns.count, balanced)
  const longestLineIn = blocks.reduce(
    (max, block) =>
      block.lines.reduce(
        (m, line) => Math.max(m, measureIn(line.value, line.size) + line.indent),
        max,
      ),
    0,
  )
  return {
    columns: columns.count,
    columnWidth: columns.width,
    blocks: blocks.length,
    overflow,
    longestLineIn,
  }
}
