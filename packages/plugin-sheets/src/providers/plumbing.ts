/**
 * P1.0 — the plumbing plan, derived live from the scene.
 *
 * The fixtures on this sheet are the ITEMS the user placed: every toilet,
 * tub, shower, lavatory, sink, washer and dishwasher in the model, tagged
 * with its schedule mark and the plumbing key letters (W waste, H hot, C
 * cold, G gas, T mixing valve). The rough-ins, the DWV tree, the supply
 * mains, the vent stack, the cleanouts, the water meter and the water heater
 * come from Bones' plumbing engine (`layoutPlumbing`,
 * packages/plugin-bones/src/engines/plumbing.ts) run over the same level.
 * Move a fixture and its trap, its branch drain and its supply runs move.
 *
 * WHAT IS ON THE PAPER
 *   plan     screened-back architectural background, fixture footprints with
 *            marks and key letters, Bones' rough-in symbols, and the piping —
 *            cold blue, hot red, DWV green, vents dashed
 *   plates   PLUMBING KEY (the letters), PIPING KEY (the line colours),
 *            PLUMBING NOTES (IRC-cited, from Bones' mep-rules data)
 *
 * VIEWPORT `system` — as on E1.0: undefined draws everything, 'plan' draws
 * the drawing and its keys, 'notes' draws the cited notes alone.
 *
 * The FIXTURE SCHEDULE is not drawn here: P1.0 carries it as its own
 * `schedule` viewport (plans/mep-set.ts), owned by schedule-fixtures.ts. The
 * marks printed on this plan are read from that schedule so the two agree.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { type Bounds, EMPTY_BOUNDS, geometryListBounds, isEmpty, unionBounds } from '../bounds'
import {
  type DrawingProvider,
  type DrawingResult,
  firstLevelId,
  type ProviderArgs,
  viewportNote,
} from '../drawings'
import type { NodeMap } from '../model'
import type { Fixture, Member } from '../../../plugin-bones/src/core/types'
import {
  PLUMBING_COLORS,
  plumbingPipeColor,
} from '../../../plugin-bones/src/plans/circuit-colors'
import { basePlan } from './mep/base-plan'
import { type PlacedItem, placedPlumbingItems, serviceLetters } from './mep/items'
import { columnsOf, type PlateLayout, plateLayout } from './mep/layout'
import { fixturesOf, mepModel } from './mep/model'
import { mepBasisLine, PLUMBING_KEY, plumbingNotes, RULES_DISCLAIMER } from './mep/notes'
import {
  type Box,
  capWarnings,
  caption,
  frame,
  heading,
  keyBlock,
  legendBlock,
  type LegendRow,
  notesColumn,
  notesColumnCount,
  PAD,
  runSwatch,
} from './mep/plate'
import { runEnds } from './mep/runs'
import * as sym from './mep/symbols'

/* ------------------------------------------------------------ piping */

/** Vent runs draw dashed; everything else solid. Colours are Bones'. */
const VENT_DASH = '0.09 0.07'

/** The ink every plumbing symbol and mark is drawn in. */
export const PIPE_INK = '#0f766e'

type PipeStyle = { color: string; dash?: string; label: string; key: string }

/**
 * The line a pipe run draws with, from the engine's own `sourceId` prefix —
 * the same mapping the 3D X-ray uses (`plumbingPipeColor`), so a pipe reads
 * as the same system in the model and on the paper.
 */
export function pipeStyle(member: Member): PipeStyle | null {
  const color = plumbingPipeColor(member.sourceId)
  if (member.role === 'vent-stack' || member.sourceId.startsWith('dwv-vent')) {
    return { color: PLUMBING_COLORS.dwv, dash: VENT_DASH, label: 'Vent', key: 'vent' }
  }
  if (!color) return null
  if (color === PLUMBING_COLORS.cold) {
    return { color, label: 'Cold water supply', key: 'cold' }
  }
  if (color === PLUMBING_COLORS.hot) {
    return { color, label: 'Hot water supply', key: 'hot' }
  }
  if (color === PLUMBING_COLORS.dwv) {
    return { color, label: 'Waste / drain (DWV)', key: 'dwv' }
  }
  return null
}

/* ---------------------------------------------------- fixture glyphs */

/** A placed fixture's footprint and glyph, in level-local metres. */
export function fixtureGlyph(item: PlacedItem, s: sym.SymbolStyle): FloorplanGeometry[] {
  const w = Math.max(0.15, item.width)
  const d = Math.max(0.15, item.depth)
  const ink = PIPE_INK
  const out: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -w / 2,
      y: -d / 2,
      width: w,
      height: d,
      fill: '#ffffff',
      fillOpacity: 0.55,
      stroke: ink,
      strokeWidth: s.stroke * 0.7,
    },
  ]
  switch (item.cls.glyph) {
    case 'wc':
      // Tank against the back, bowl forward.
      out.push({
        kind: 'circle',
        cx: 0,
        cy: d * 0.1,
        r: Math.min(w, d) * 0.3,
        fill: 'none',
        stroke: ink,
        strokeWidth: s.stroke * 0.6,
      })
      out.push({
        kind: 'rect',
        x: -w * 0.36,
        y: -d / 2 + d * 0.04,
        width: w * 0.72,
        height: d * 0.2,
        fill: 'none',
        stroke: ink,
        strokeWidth: s.stroke * 0.6,
      })
      break
    case 'basin':
    case 'sink':
      out.push({
        kind: 'rect',
        x: -w * 0.36,
        y: -d * 0.3,
        width: w * 0.72,
        height: d * 0.6,
        rx: Math.min(w, d) * 0.08,
        fill: 'none',
        stroke: ink,
        strokeWidth: s.stroke * 0.6,
      })
      out.push({
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: Math.min(w, d) * 0.07,
        fill: ink,
        stroke: 'none',
      })
      break
    case 'tub':
      out.push({
        kind: 'rect',
        x: -w * 0.44,
        y: -d * 0.38,
        width: w * 0.88,
        height: d * 0.76,
        rx: Math.min(w, d) * 0.12,
        fill: 'none',
        stroke: ink,
        strokeWidth: s.stroke * 0.6,
      })
      out.push({
        kind: 'circle',
        cx: -w * 0.32,
        cy: 0,
        r: Math.min(w, d) * 0.06,
        fill: ink,
        stroke: 'none',
      })
      break
    case 'shower':
      out.push({ kind: 'line', x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2, stroke: ink, strokeWidth: s.stroke * 0.5 })
      out.push({ kind: 'line', x1: w / 2, y1: -d / 2, x2: -w / 2, y2: d / 2, stroke: ink, strokeWidth: s.stroke * 0.5 })
      out.push({
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: Math.min(w, d) * 0.09,
        fill: ink,
        stroke: 'none',
      })
      break
    default:
      break
  }
  return out
}

/** The Bones plumbing fixture symbols — rough-ins and service points. */
export function bonesPlumbingSymbol(
  fixture: Fixture,
  s: sym.SymbolStyle,
): { key: string; label: string; children: FloorplanGeometry[] } | null {
  const ink = PIPE_INK
  switch (fixture.kind) {
    case 'stub-out':
      return {
        key: 'stub-out',
        label: 'Supply / drain rough-in',
        children: sym.hexMark(s, 'RI', ink),
      }
    case 'vent-stack':
      return {
        key: 'vent-stack',
        label: '3 in DWV vent stack through roof (IRC P3103.1)',
        children: sym.ventStack(s, ink),
      }
    case 'cleanout':
      return { key: 'cleanout', label: 'Cleanout (IRC P3005.2)', children: sym.hexMark(s, 'CO', ink) }
    case 'water-meter':
      return {
        key: 'water-meter',
        label: 'Water service meter and shut-off (IRC P2903.7)',
        children: sym.meterSymbol(s, 'WM'),
      }
    case 'water-heater':
      return {
        key: 'water-heater',
        label: 'Water heater — T&P relief, pan and seismic restraint (IRC P2801, P2803)',
        children: sym.boxSymbol(s, 'WH'),
      }
    default:
      return null
  }
}

/* ---------------------------------------------------------- drawing */

export const PLUMBING_EMPTY_NOTE = [
  'PLUMBING PLAN',
  '',
  'No plumbing fixtures on this level yet.',
  'Place the fixtures — toilets, tubs, showers, sinks, the washer —',
  'and this sheet derives itself from them.',
].join('\n')

export function buildPlumbingDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const box: Box = { x: args.viewport.x, y: args.viewport.y, w: args.viewport.w, h: args.viewport.h }
  const levelId = args.levelId ?? firstLevelId(nodes)
  if (!levelId) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: viewportNote(box, 'PLUMBING PLAN\n\nNo level in this scene yet.'),
      noLabel: true,
      title: 'Plumbing plan',
    }
  }

  if (args.system === 'notes') {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: notesOnly(box, mepModel(nodes, levelId)?.jurisdiction ?? 'AUTO'),
      noLabel: true,
      title: 'Plumbing notes',
    }
  }

  const model = mepModel(nodes, levelId)
  const warnings: string[] = [...(model?.warnings ?? [])]
  const plumbing = model ? fixturesOf(model, 'plumbing') : []
  const { items, skipped, unscheduled } = placedPlumbingItems(nodes, levelId)
  const layout = plateLayout(args.viewport)
  const style = sym.styleFor(args.viewport.scale)

  if (skipped.length > 0) {
    warnings.push(
      `${skipped.length} fixture(s) hosted on a roof face, block face or shelf are not plotted: ${skipped.slice(0, 3).join(', ')}`,
    )
  }
  if (unscheduled > 0) {
    warnings.push(
      `${unscheduled} fixture(s) are not on the fixture schedule — their marks are derived here; check the schedule`,
    )
  }

  if (items.length === 0 && plumbing.length === 0) {
    const notesBox =
      layout.mode === 'column' ? layout.plates : { ...box, y: box.y + box.h * 0.4, h: box.h * 0.6 }
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: [
        ...viewportNote(
          {
            x: box.x,
            y: box.y,
            w: layout.mode === 'column' ? layout.plan.w : box.w,
            h: box.h * 0.38,
          },
          PLUMBING_EMPTY_NOTE,
        ),
        ...notesOnly(notesBox, model?.jurisdiction ?? 'AUTO'),
      ],
      warnings: capWarnings(warnings),
      noLabel: true,
      title: 'Plumbing plan',
    }
  }

  /* ------------------------------------------------------ live plan */

  const base = basePlan(nodes, levelId, args.layers, 0.34)
  const primitives: FloorplanGeometry[] = []
  if (base.geometry) primitives.push(base.geometry)
  else {
    warnings.push(
      'architectural background unavailable — fixtures drawn without the floor plan under them',
    )
  }

  // Piping first, so the fixtures and their tags read over it.
  const pipes: FloorplanGeometry[] = []
  const pipeKeys = new Map<string, PipeStyle>()
  for (const member of model?.members ?? []) {
    if (member.system !== 'plumbing') continue
    const styling = pipeStyle(member)
    if (!styling) continue
    pipeKeys.set(styling.key, styling)
    const ends = runEnds(member)
    if (!ends) continue
    const [a, b] = ends
    pipes.push({
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke: styling.color,
      strokeWidth: style.unit * 0.14,
      ...(styling.dash ? { strokeDasharray: styling.dash } : {}),
      opacity: 0.95,
      strokeLinecap: 'round',
    })
  }
  if (pipes.length > 0) primitives.push({ kind: 'group', children: pipes })

  // Placed fixtures: footprint, glyph, mark bubble and key letters.
  const fixtureGeometry: FloorplanGeometry[] = []
  const fixtureLabels: FloorplanGeometry[] = []
  for (const item of items) {
    fixtureGeometry.push(sym.stamp(fixtureGlyph(item, style), item.plan[0], item.plan[1], item.rotation))
    const letters = serviceLetters(item.cls.service)
    const tags: FloorplanGeometry[] = [
      ...markBubble(style, item.mark, 0, -(Math.max(item.depth, 0.3) / 2) - style.unit * 0.85),
    ]
    if (letters) {
      tags.push(
        sym.tag(style, letters, 0, Math.max(item.depth, 0.3) / 2 + style.unit * 1.0, {
          size: 0.52,
          fill: PIPE_INK,
        }),
      )
    }
    fixtureLabels.push(sym.stamp(tags, item.plan[0], item.plan[1], 0))
  }

  // Bones' own rough-in and service symbols.
  const bonesLegend = new Map<
    string,
    { key: string; label: string; build: (s: sym.SymbolStyle) => FloorplanGeometry[] }
  >()

  // The DWV stack is a vertical MEMBER, not a fixture — it projects to a
  // point in plan, so it is drawn as its own symbol rather than as a
  // zero-length line. Without this the one thing every plumbing plan has to
  // show, the vent through the roof, was missing from the drawing.
  for (const member of model?.members ?? []) {
    if (member.system !== 'plumbing' || member.role !== 'vent-stack') continue
    bonesLegend.set('vent-stack', {
      key: 'vent-stack',
      label: '3 in DWV vent stack through roof (IRC P3103.1)',
      build: (s) => sym.ventStack(s, PIPE_INK),
    })
    fixtureGeometry.push(
      sym.stamp(sym.ventStack(style, PIPE_INK), member.position[0], member.position[2], 0),
    )
    fixtureLabels.push(
      sym.stamp(
        [sym.tag(style, 'VTR', 0, -style.unit * 1.0, { size: 0.5, fill: PIPE_INK })],
        member.position[0],
        member.position[2],
        0,
      ),
    )
    if (typeof member.flag === 'string' && member.flag.length > 0) warnings.push(member.flag)
  }

  for (const fixture of plumbing) {
    const symbol = bonesPlumbingSymbol(fixture, style)
    if (!symbol) continue
    bonesLegend.set(symbol.key, {
      key: symbol.key,
      label: symbol.label,
      build: (s) => bonesPlumbingSymbol(fixture, s)?.children ?? [],
    })
    fixtureGeometry.push(sym.stamp(symbol.children, fixture.position[0], fixture.position[2], 0))
    // A Bones label carrying a warning glyph is a real finding — hoist it.
    if (typeof fixture.label === 'string' && fixture.label.includes('⚠')) {
      warnings.push(fixture.label.replace(/^.*⚠\s*/, '⚠ '))
    }
  }
  primitives.push({ kind: 'group', children: fixtureGeometry })
  primitives.push({ kind: 'group', children: fixtureLabels })

  /* --------------------------------------------------------- bounds */

  const drawn = unionBounds(
    base.bounds,
    geometryListBounds([{ kind: 'group', children: fixtureGeometry }]),
  )
  const bounds = shiftCentre(isEmpty(drawn) ? EMPTY_BOUNDS : drawn, layout.shift)

  /* --------------------------------------------------------- plates */

  const plate = plumbingPlates({
    layout,
    style,
    items,
    pipeKeys: [...pipeKeys.values()],
    bonesLegend: [...bonesLegend.values()],
    withNotes: args.system !== 'plan',
    jurisdiction: model?.jurisdiction ?? 'AUTO',
  })

  if (!plumbing.some((f) => f.kind === 'water-heater')) {
    warnings.push('no water heater modelled — hot-water source not shown')
  }
  if (!plumbing.some((f) => f.kind === 'vent-stack')) {
    warnings.push('no vent stack modelled — every building drain needs a vent to outdoors (IRC P3102.1)')
  }

  return {
    primitives,
    bounds,
    plate,
    warnings: capWarnings(warnings),
    title: 'Plumbing plan',
  }
}

/** The mark bubble a fixture carries — the schedule's letters, in a circle. */
function markBubble(s: sym.SymbolStyle, mark: string, dx: number, dy: number): FloorplanGeometry[] {
  const r = s.unit * 0.72
  return [
    { kind: 'circle', cx: dx, cy: dy, r, fill: '#ffffff', stroke: PIPE_INK, strokeWidth: s.stroke * 0.8 },
    {
      kind: 'text',
      x: dx,
      y: dy + s.unit * 0.2,
      text: mark,
      fontSize: s.unit * 0.55,
      fill: PIPE_INK,
      fontWeight: 800,
      fontFamily: sym.SANS,
      textAnchor: 'middle',
    },
  ]
}

/* ----------------------------------------------------------- plates */

function plumbingPlates(input: {
  layout: PlateLayout
  style: sym.SymbolStyle
  items: readonly PlacedItem[]
  pipeKeys: readonly PipeStyle[]
  bonesLegend: readonly { key: string; label: string; build: (s: sym.SymbolStyle) => FloorplanGeometry[] }[]
  withNotes: boolean
  jurisdiction: string
}): FloorplanGeometry[] {
  const { layout, items, pipeKeys, bonesLegend, withNotes, jurisdiction } = input
  const out: FloorplanGeometry[] = []
  const notes = plumbingNotes()

  const drawKeys = (col: Box): number => {
    let y = col.y
    y += block(out, { ...col, y, h: col.h }, 'Plumbing key', (inner) => {
      const printed = keyBlock(out, inner, usedKeyRows(items))
      let used = printed.height
      if (printed.overflow > 0) {
        used += caption(out, { ...inner, y: inner.y + used, h: 0.4 }, `+${printed.overflow} more.`)
      }
      return used
    })
    y += 0.18
    y += block(out, { ...col, y, h: Math.max(0.8, col.y + col.h - y) }, 'Piping key', (inner) => {
      const rows: LegendRow[] = [
        ...pipeKeys.map((p) => ({ swatch: runSwatch(p.color, p.dash), label: p.label, key: p.key })),
        ...bonesLegend.map((entry) => ({
          swatch: entry.build({ unit: 0.16, stroke: 0.018, ink: PIPE_INK }),
          label: entry.label,
          key: entry.key,
        })),
      ]
      if (rows.length === 0) return caption(out, inner, 'No piping modelled on this level.')
      const printed = legendBlock(out, inner, rows)
      let used = printed.height
      if (printed.overflow > 0) {
        used += caption(
          out,
          { ...inner, y: inner.y + used, h: 0.4 },
          `+${printed.overflow} more — enlarge this viewport.`,
        )
      }
      return used
    })
    return y - col.y
  }

  if (layout.mode === 'column') {
    const col: Box = {
      x: layout.plates.x + PAD,
      y: layout.plates.y + PAD,
      w: layout.plates.w - PAD * 2,
      h: layout.plates.h - PAD * 2,
    }
    const used = drawKeys(col)
    if (!withNotes) return out
    const y = col.y + used + 0.18
    block(out, { ...col, y, h: Math.max(0.8, col.y + col.h - y) }, 'Plumbing notes', (inner) =>
      drawNotes(out, inner, notes, jurisdiction, 0.1),
    )
    return out
  }

  const boxes = columnsOf(layout.plates, withNotes ? Math.max(2, layout.stackColumns) : 1)
  const first = boxes[0]
  if (first) {
    drawKeys({ x: first.x + PAD, y: first.y + PAD, w: first.w - PAD * 2, h: first.h - PAD * 2 })
  }
  const rest = boxes.slice(1)
  if (!withNotes || rest.length === 0) return out
  const perColumn = Math.ceil(notes.length / rest.length)
  rest.forEach((column, index) => {
    const inner: Box = {
      x: column.x + PAD,
      y: column.y + PAD,
      w: column.w - PAD * 2,
      h: column.h - PAD * 2,
    }
    const slice = notes.slice(index * perColumn, (index + 1) * perColumn)
    if (slice.length === 0) return
    block(out, inner, index === 0 ? 'Plumbing notes' : 'Plumbing notes (cont.)', (b) =>
      index === rest.length - 1
        ? drawNotes(out, b, slice, jurisdiction, 0.092, index * perColumn)
        : notesColumn(out, b, slice, 0.092, index * perColumn).height,
    )
  })
  return out
}

/** The key rows — every letter, so the reader can decode any tag on the plan. */
function usedKeyRows(items: readonly PlacedItem[]): { letter: string; label: string }[] {
  if (items.length === 0) return PLUMBING_KEY
  const used = new Set<string>()
  for (const item of items) {
    for (const letter of serviceLetters(item.cls.service).split(',')) {
      if (letter) used.add(letter)
    }
  }
  // Gas is kept in the key even when no gas fixture is placed only if the
  // key would otherwise be empty; a letter that is not on the drawing is
  // exactly what a legend must not claim.
  const rows = PLUMBING_KEY.filter((row) => used.has(row.letter))
  return rows.length > 0 ? rows : PLUMBING_KEY
}

/**
 * The notes viewport: the cited notes alone. The plumbing key and piping key
 * are the plan viewport's plates, printed once beside the plan; a second key
 * here was the same box twice on P1.0.
 */
function notesOnly(box: Box, jurisdiction: string): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const notes = plumbingNotes()
  const inner: Box = { x: box.x + PAD, y: box.y + PAD, w: box.w - PAD * 2, h: box.h - PAD * 2 }
  const notesBox: Box = { ...inner, h: Math.max(0.8, inner.h) }
  const columns = columnsOf(notesBox, notesColumnCount(notesBox.w))
  const count = columns.length
  const perColumn = Math.ceil(notes.length / count)
  columns.forEach((column, index) => {
    const slice = notes.slice(index * perColumn, (index + 1) * perColumn)
    if (slice.length === 0) return
    block(out, column, index === 0 ? 'Plumbing notes' : 'Plumbing notes (cont.)', (b) =>
      index === columns.length - 1
        ? drawNotes(out, b, slice, jurisdiction, 0.1, index * perColumn)
        : notesColumn(out, b, slice, 0.1, index * perColumn).height,
    )
  })
  return out
}

function drawNotes(
  out: FloorplanGeometry[],
  box: Box,
  notes: readonly string[],
  jurisdiction: string,
  fontSize: number,
  startIndex = 0,
): number {
  const printed = notesColumn(out, box, notes, fontSize, startIndex)
  let used = printed.height
  if (printed.overflow > 0) {
    used += caption(
      out,
      { ...box, y: box.y + used + 0.03, h: 0.4 },
      `+${printed.overflow} further notes not shown — enlarge this viewport.`,
    )
  }
  used += caption(
    out,
    { ...box, y: box.y + used + 0.06, h: 0.7 },
    `Basis: ${mepBasisLine(jurisdiction)} ${RULES_DISCLAIMER}`,
  )
  return used
}

/** One framed block with an optional heading; see the twin in electrical.ts. */
function block(
  out: FloorplanGeometry[],
  box: Box,
  title: string,
  body: (inner: Box) => number,
): number {
  const marker = out.length
  let used = 0
  if (title.trim()) used += heading(out, box, title)
  used += body({ ...box, y: box.y + used, h: Math.max(0, box.h - used) })
  const framed: FloorplanGeometry[] = []
  frame(framed, { ...box, h: used })
  out.splice(marker, 0, ...framed)
  return used + PAD * 2
}

function shiftCentre(bounds: Bounds, shift: { x: number; y: number }): Bounds {
  if (isEmpty(bounds)) return bounds
  return {
    minX: bounds.minX + shift.x,
    maxX: bounds.maxX + shift.x,
    minY: bounds.minY + shift.y,
    maxY: bounds.maxY + shift.y,
  }
}

/* --------------------------------------------------------- registry */

export function registerPlumbingProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('plumbing', (nodes, args) => buildPlumbingDrawing(nodes, args as unknown as ProviderArgs))
}
