/**
 * E1.0 — the electrical plan, derived live from the scene.
 *
 * Nothing on this sheet is stored. The walls come from the level, the devices
 * come from Bones' NEC layout engine walking those walls (`layoutElectrical`
 * → `assignCircuits`, packages/plugin-bones/src/engines/electrical.ts), the
 * panel schedule is `circuitSchedule` over the same fixtures, and the
 * homeruns are the `wire-run` members the router pulled along the walls. Move
 * a wall and the 6-ft walk re-runs; move a door and the wall spaces it breaks
 * change; move the site's service point and the meter, the panel beside it
 * and the service cable all follow.
 *
 * WHAT IS ON THE PAPER
 *   plan     screened-back architectural background + device symbols, each
 *            with its branch-circuit id; branch runs as light dashed lines
 *   plates   SYMBOLS LEGEND (only the symbols actually drawn), PANEL
 *            SCHEDULE (one row per branch circuit), ELECTRICAL NOTES (every
 *            line with its NEC / IRC citation, from Bones' rules data)
 *
 * VIEWPORT `system`. One viewport cannot hold twenty cited notes AND a
 * seventeen-row panel schedule AND the plan at a readable size, so the sheet
 * splits them and the viewport says which part it is:
 *   undefined      everything — for a viewport somebody added by hand
 *   'plan'         plan + legend + panel schedule (E1.0's drawing viewport)
 *   'notes'        the notes block alone, plate only (E1.0's notes column)
 *
 * WHAT IT DOES NOT CLAIM. The service size printed is the CODE MINIMUM Bones
 * reports (NEC 230.79(C)) — there is no Article 220 load calculation in the
 * model, and the notes say so rather than printing a confident 200 A that
 * nobody computed.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { type Bounds, EMPTY_BOUNDS, geometryListBounds, isEmpty, unionBounds } from '../bounds'
import { drawTable } from '../draw-table'
import {
  type DrawingProvider,
  type DrawingResult,
  firstLevelId,
  type ProviderArgs,
  viewportNote,
} from '../drawings'
import type { NodeMap } from '../model'
import type { ScheduleTable } from '../schedule'
import { INK_SOFT } from '../titleblock'
import type { Fixture } from '../../../plugin-bones/src/core/types'
import { circuitSchedule } from '../../../plugin-bones/src/engines/electrical'
import { circuitZoneHint } from '../../../plugin-bones/src/plans/circuit-colors'
import { basePlan } from './mep/base-plan'
import { leader, TagField } from './mep/declutter'
import { electricalAppliances } from './mep/items'
import { columnsOf, type PlateLayout, plateLayout } from './mep/layout'
import { fixturesOf, membersOf, mepModel } from './mep/model'
import {
  ELECTRICAL_ALARM_BASIS,
  ELECTRICAL_BASIS,
  electricalNotes,
  necEditionFor,
  RULES_DISCLAIMER,
} from './mep/notes'
import {
  type Box,
  capWarnings,
  caption,
  frame,
  heading,
  legendBlock,
  type LegendRow,
  notesColumn,
  notesColumnCount,
  PAD,
} from './mep/plate'
import { runEnds } from './mep/runs'
import * as sym from './mep/symbols'

export { capWarnings }

/* ------------------------------------------------------- symbol map */

export type DeviceSymbol = {
  /** Stable key — de-duplicates the legend. */
  key: string
  label: string
  /** Glyph builder, in symbol-local metres. */
  build: (s: sym.SymbolStyle) => FloorplanGeometry[]
  /** Whether the glyph takes the device's wall rotation. */
  oriented: boolean
  /** Tag letters printed beside the symbol (GFCI, WP/GFCI…). */
  qualifier?: string
}

/**
 * The symbol a fixture draws with. Qualifiers follow the engine's own meta
 * flags — `wr` (outdoor, NEC 210.52(E) / 406.9(B)), `counter` (210.52(C),
 * 44 in AFF), `basin` (210.52(D), 40 in AFF) — so the paper says what the
 * engine actually roughed in rather than an all-GFCI smear.
 */
export function symbolFor(fixture: Fixture): DeviceSymbol | null {
  const meta = fixture.meta ?? {}
  switch (fixture.kind) {
    case 'receptacle':
      return {
        key: 'receptacle',
        label: 'Duplex receptacle, 125 V',
        build: (s) => sym.duplexReceptacle(s),
        oriented: true,
      }
    case 'receptacle-gfci':
      return {
        key:
          meta.counter === true
            ? 'receptacle-gfci-counter'
            : meta.basin === true
              ? 'receptacle-gfci-basin'
              : 'receptacle-gfci',
        label:
          meta.counter === true
            ? 'GFCI receptacle at countertop, 44 in AFF (NEC 210.52(C), 210.8(A))'
            : meta.basin === true
              ? 'GFCI receptacle at basin, 40 in AFF (NEC 210.52(D), 210.8(A))'
              : 'GFCI receptacle (NEC 210.8(A))',
        build: (s) => sym.duplexReceptacle(s),
        oriented: true,
        qualifier: meta.counter === true ? 'GFCI-C' : meta.basin === true ? 'GFCI-B' : 'GFCI',
      }
    case 'receptacle-wr-gfci':
      return {
        key: 'receptacle-wr-gfci',
        label: 'Weather-resistant GFCI receptacle, in-use cover (NEC 210.52(E), 406.9(B))',
        build: (s) => sym.duplexReceptacle(s),
        oriented: true,
        qualifier: 'WP/GFCI',
      }
    case 'switch':
      return {
        key: meta.threeWay === true ? 'switch-3' : 'switch',
        label:
          meta.threeWay === true
            ? 'Three-way wall switch (NEC 210.70(A))'
            : 'Wall switch (NEC 210.70(A))',
        build: (s) => sym.switchSymbol(s, meta.threeWay === true),
        oriented: false,
      }
    case 'light':
      return {
        key: 'light',
        label: 'Ceiling-mounted luminaire (NEC 210.70(A))',
        build: (s) => sym.ceilingLight(s),
        oriented: false,
      }
    case 'smoke-alarm':
      return {
        key: 'smoke-alarm',
        label: 'Smoke alarm — hardwired, battery back-up, interconnected (IRC R314)',
        build: (s) => sym.alarm(s, 'SD'),
        oriented: false,
      }
    case 'co-alarm':
      return {
        key: 'co-alarm',
        label: 'Carbon monoxide alarm (IRC R315)',
        build: (s) => sym.alarm(s, 'CO'),
        oriented: false,
      }
    case 'exhaust-fan':
      return {
        key: 'exhaust-fan',
        label: 'Exhaust fan, ducted to outside air',
        build: (s) => sym.exhaustFan(s),
        oriented: false,
      }
    case 'panel':
      return {
        key: 'panel',
        label: 'Service panelboard — clear working space (NEC 110.26(A))',
        build: (s) => sym.panelSymbol(s, 'P'),
        oriented: false,
      }
    case 'electric-meter':
      return {
        key: 'electric-meter',
        label: 'Electric meter — service entrance (NEC 230.66)',
        build: (s) => sym.meterSymbol(s, 'M'),
        oriented: false,
      }
    case 'disconnect':
      return {
        key: 'disconnect',
        label: 'Service disconnect, within sight of the unit (NEC 440.14)',
        build: (s) => sym.boxSymbol(s, 'DS'),
        oriented: false,
      }
    case 'thermostat':
      return {
        key: 'thermostat',
        label: 'Thermostat',
        build: (s) => sym.thermostat(s),
        oriented: false,
      }
    case 'equipment':
      return meta.equipment === 'condenser'
        ? {
            key: 'condenser',
            label: 'Outdoor condensing unit — dedicated branch circuit',
            build: (s) => sym.boxSymbol(s, 'CU'),
            oriented: false,
          }
        : {
            key: 'equipment',
            label: 'Mechanical equipment — dedicated branch circuit',
            build: (s) => sym.boxSymbol(s, 'AH'),
            oriented: false,
          }
    default:
      return null
  }
}

/* ---------------------------------------------------------- drawing */

export { runEnds }

export const ELECTRICAL_EMPTY_NOTE = [
  'ELECTRICAL PLAN',
  '',
  'No walls on this level, so there is nothing to lay devices out along.',
  'Draw the walls — and the zones, which drive GFCI, lighting and alarms —',
  'and this sheet derives itself.',
].join('\n')

export function buildElectricalDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const box: Box = {
    x: args.viewport.x,
    y: args.viewport.y,
    w: args.viewport.w,
    h: args.viewport.h,
  }
  const levelId = args.levelId ?? firstLevelId(nodes)
  if (!levelId) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: viewportNote(box, 'ELECTRICAL PLAN\n\nNo level in this scene yet.'),
      noLabel: true,
      title: 'Electrical plan',
    }
  }

  // The notes column is plate-only: no engine run, no geometry — just the
  // rules, so it prints identically on a scene that has not been drawn yet.
  if (args.system === 'notes') {
    const jurisdiction = mepModel(nodes, levelId)?.jurisdiction ?? 'AUTO'
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: notesOnly(box, jurisdiction, args.viewport.h),
      noLabel: true,
      title: 'Electrical notes',
    }
  }

  const model = mepModel(nodes, levelId)
  const warnings: string[] = [...(model?.warnings ?? [])]
  const fixtures = model ? fixturesOf(model, 'electrical') : []
  const layout = plateLayout(args.viewport)
  const style = sym.styleFor(args.viewport.scale)

  if (!model || fixtures.length === 0) {
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
          ELECTRICAL_EMPTY_NOTE,
        ),
        ...notesOnly(notesBox, model?.jurisdiction ?? 'AUTO', notesBox.h),
      ],
      warnings: capWarnings(warnings),
      noLabel: true,
      title: 'Electrical plan',
    }
  }

  /* ------------------------------------------------------ live plan */

  const base = basePlan(nodes, levelId, args.layers, 0.38)
  const primitives: FloorplanGeometry[] = []
  if (base.geometry) primitives.push(base.geometry)
  else {
    warnings.push(
      'architectural background unavailable — devices drawn without the floor plan under them',
    )
  }

  // Branch runs and homeruns, screened right back: they are context for the
  // device layout, not the drawing's subject.
  const runs: FloorplanGeometry[] = []
  for (const member of membersOf(model, 'electrical', ['wire-run'])) {
    const ends = runEnds(member)
    if (!ends) continue
    const [a, b] = ends
    runs.push({
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke: '#9a6b2f',
      strokeWidth: style.unit * 0.055,
      strokeDasharray: `${(style.unit * 0.55).toFixed(4)} ${(style.unit * 0.38).toFixed(4)}`,
      opacity: 0.5,
    })
  }
  if (runs.length > 0) primitives.push({ kind: 'group', children: runs })

  const used = new Map<string, DeviceSymbol>()
  const devices: FloorplanGeometry[] = []
  const labels: FloorplanGeometry[] = []
  let unmapped = 0

  // Tags dodge each other; the symbols never move — a construction document
  // locates them. Every glyph centre is reserved first so a tag never lands
  // on another device's symbol either.
  const field = new TagField(style.unit * 1.55, [
    style.unit * 1.7,
    style.unit * 2.6,
    style.unit * 3.6,
  ])
  for (const fixture of fixtures) {
    field.reserve(fixture.position[0], fixture.position[2])
  }
  // Room names are already on the paper; a circuit tag must not land on one.
  for (const spot of base.labelSpots) field.reserve(spot.x, spot.y)

  for (const fixture of fixtures) {
    const symbol = symbolFor(fixture)
    if (!symbol) {
      unmapped += 1
      continue
    }
    used.set(symbol.key, symbol)
    const [x, , z] = fixture.position
    // A wall device's glyph faces out of its wall. The engine's `rotationY`
    // is `atan2(nx, nz)` for the face's outward plan normal; the renderer
    // rotates CLOCKWISE in the y-down plan frame, so the angle that sends
    // the symbol's local −Y (its straps) onto that normal is PI − rotationY.
    const rotation = symbol.oriented ? Math.PI - fixture.rotationY : 0
    devices.push(sym.stamp(symbol.build(style), x, z, rotation))

    // Tags are stamped UNROTATED — a circuit number upside-down on the north
    // wall is exactly the defect this separation exists to prevent.
    const tags: FloorplanGeometry[] = []
    if (symbol.qualifier) {
      tags.push(sym.tag(style, symbol.qualifier, 0, -style.unit * 0.95, { size: 0.5 }))
    }
    if (fixture.kind === 'panel') {
      const amps = Number(fixture.meta?.minServiceAmps ?? 0)
      tags.push(
        sym.tag(style, amps > 0 ? `${amps}A MIN` : 'PANEL', 0, -style.unit * 1.0, { size: 0.52 }),
      )
    }
    const circuit = typeof fixture.meta?.circuit === 'string' ? fixture.meta.circuit : ''
    if (circuit) {
      tags.push(
        sym.tag(style, circuit, 0, style.unit * (symbol.oriented ? 1.4 : 1.6), {
          size: 0.5,
          fill: sym.SYMBOL_ACCENT,
        }),
      )
    }
    if (tags.length > 0) {
      const spot = field.place(x, z)
      if (spot.moved > style.unit * 1.2) {
        labels.push(leader({ x, y: z }, { x: spot.x, y: spot.y }, style.unit * 0.045, INK_SOFT))
      }
      labels.push(sym.stamp(tags, spot.x, spot.y, 0))
    }
  }
  if (unmapped > 0) {
    warnings.push(`${unmapped} electrical fixture(s) have no plan symbol and are not drawn`)
  }

  // Appliances that need a branch circuit — the range, the dryer, the
  // condenser, the fans. Bones lays out receptacles, lighting and alarms; the
  // APPLIANCES are placed items, and which of them take a circuit is the
  // fixture schedule's own classification, so the plan and the schedule
  // cannot disagree about it. Each is marked with the schedule's label.
  const appliances = electricalAppliances(nodes, levelId)
  for (const appliance of appliances.items) {
    const symbol: DeviceSymbol = appliance.fan
      ? {
          key: 'ceiling-fan',
          label: 'Paddle fan — switched (see fixture schedule)',
          build: (s) => sym.ceilingFan(s),
          oriented: false,
        }
      : {
          key: 'appliance',
          label: 'Appliance outlet on its own branch circuit (see fixture schedule)',
          build: (s) => sym.dedicatedReceptacle(s),
          oriented: false,
        }
    used.set(symbol.key, symbol)
    devices.push(sym.stamp(symbol.build(style), appliance.plan[0], appliance.plan[1], 0))
    const spot = field.place(appliance.plan[0], appliance.plan[1])
    if (spot.moved > style.unit * 1.2) {
      labels.push(
        leader(
          { x: appliance.plan[0], y: appliance.plan[1] },
          { x: spot.x, y: spot.y },
          style.unit * 0.045,
          INK_SOFT,
        ),
      )
    }
    labels.push(
      sym.stamp(
        [
          sym.tag(style, appliance.mark, 0, style.unit * 1.5, {
            size: 0.5,
            fill: sym.SYMBOL_ACCENT,
          }),
        ],
        spot.x,
        spot.y,
        0,
      ),
    )
  }
  if (appliances.skipped.length > 0) {
    warnings.push(
      `${appliances.skipped.length} appliance(s) on an unresolvable host frame are not plotted: ${appliances.skipped.slice(0, 3).join(', ')}`,
    )
  }

  primitives.push({ kind: 'group', children: devices })
  primitives.push({ kind: 'group', children: labels })

  /* --------------------------------------------------------- bounds */

  const drawn = unionBounds(base.bounds, geometryListBounds([{ kind: 'group', children: devices }]))
  const bounds = shiftCentre(isEmpty(drawn) ? EMPTY_BOUNDS : drawn, layout.shift)

  /* --------------------------------------------------------- plates */

  const rows = circuitSchedule(fixtures)
  const panel = fixtures.find((f) => f.kind === 'panel')
  const serviceAmps = Number(panel?.meta?.minServiceAmps ?? 0) || 100
  const plate = electricalPlates({
    layout,
    style,
    legend: [...used.values()],
    rows,
    serviceAmps,
    jurisdiction: model.jurisdiction,
    withNotes: args.system !== 'plan',
  })

  warnings.push(...serviceWarnings(model.serviceSync, fixtures))
  if (rows.length === 0) warnings.push('no branch circuits assigned — panel schedule is empty')

  return {
    primitives,
    bounds,
    plate,
    warnings: capWarnings(warnings),
    title: 'Electrical plan',
  }
}

/** How the meter got its spot — said on the paper, not assumed. */
function serviceWarnings(
  sync: { wallId: string; wallT: number; heightAff: number; synthesized: boolean } | null,
  fixtures: readonly Fixture[],
): string[] {
  const out: string[] = []
  if (!fixtures.some((f) => f.kind === 'electric-meter')) {
    out.push('no electric meter placed — the service chain is incomplete')
    return out
  }
  if (!sync) {
    out.push(
      'no site service point — meter and panel are auto-placed; set the service point so the site plan, this sheet and the model agree',
    )
    return out
  }
  if (sync.synthesized) {
    out.push(
      `meter located from the site service point (${sync.wallId.slice(-6)} at ${(sync.wallT * 100).toFixed(0)}% of the wall, ${sync.heightAff.toFixed(2)} m AFF)`,
    )
  }
  return out
}

/* ----------------------------------------------------------- plates */

function electricalPlates(input: {
  layout: PlateLayout
  style: sym.SymbolStyle
  legend: DeviceSymbol[]
  rows: ReturnType<typeof circuitSchedule>
  serviceAmps: number
  jurisdiction: string
  withNotes: boolean
}): FloorplanGeometry[] {
  const { layout, legend, rows, serviceAmps, jurisdiction, withNotes } = input
  const out: FloorplanGeometry[] = []
  const notes = electricalNotes({ serviceAmps })

  if (layout.mode === 'column') {
    const col: Box = {
      x: layout.plates.x + PAD,
      y: layout.plates.y + PAD,
      w: layout.plates.w - PAD * 2,
      h: layout.plates.h - PAD * 2,
    }
    let y = col.y
    y += block(out, { ...col, y, h: col.h }, 'Symbols legend', (inner) =>
      drawLegend(out, inner, legend, input.style),
    )
    y += 0.2
    y += block(out, { ...col, y, h: Math.max(1, col.y + col.h - y) }, '', (inner) =>
      drawPanelSchedule(out, inner, rows, serviceAmps),
    )
    if (!withNotes) return out
    y += 0.2
    block(out, { ...col, y, h: Math.max(0.8, col.y + col.h - y) }, 'Electrical notes', (inner) =>
      drawNotes(out, inner, notes, jurisdiction, 0.1),
    )
    return out
  }

  const columnCount = withNotes ? Math.max(2, layout.stackColumns) : 1
  const boxes = columnsOf(layout.plates, columnCount)
  const first = boxes[0]
  const rest = boxes.slice(1)
  if (first) {
    const inner: Box = {
      x: first.x + PAD,
      y: first.y + PAD,
      w: first.w - PAD * 2,
      h: first.h - PAD * 2,
    }
    let y = inner.y
    y += block(out, { ...inner, y, h: inner.h }, 'Symbols legend', (b) =>
      drawLegend(out, b, legend, input.style),
    )
    y += 0.18
    block(out, { ...inner, y, h: Math.max(0.8, inner.y + inner.h - y) }, '', (b) =>
      drawPanelSchedule(out, b, rows, serviceAmps),
    )
  }
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
    block(out, inner, index === 0 ? 'Electrical notes' : '', (b) =>
      index === rest.length - 1
        ? drawNotes(out, b, slice, jurisdiction, 0.092, index * perColumn)
        : notesColumn(out, b, slice, 0.092, index * perColumn).height,
    )
  })
  return out
}

/**
 * The notes on their own. Long cited notes do not fit beside a plan and a
 * seventeen-row panel schedule, so E1.0 gives them a viewport
 * (`system: 'notes'`) and they flow across as many columns as fit — which is
 * how the reference sheet prints them too.
 */
function notesOnly(box: Box, jurisdiction: string, height: number): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const notes = electricalNotes({ serviceAmps: 100 })
  const inner: Box = { x: box.x + PAD, y: box.y + PAD, w: box.w - PAD * 2, h: height - PAD * 2 }
  const columns = columnsOf(inner, notesColumnCount(inner.w))
  const count = columns.length
  const perColumn = Math.ceil(notes.length / count)
  columns.forEach((column, index) => {
    const slice = notes.slice(index * perColumn, (index + 1) * perColumn)
    if (slice.length === 0) return
    block(out, column, index === 0 ? 'Electrical notes' : 'Electrical notes (cont.)', (b) =>
      index === columns.length - 1
        ? drawNotes(out, b, slice, jurisdiction, 0.1, index * perColumn)
        : notesColumn(out, b, slice, 0.1, index * perColumn).height,
    )
  })
  return out
}

/**
 * One framed block with an optional heading. The frame is spliced in UNDER
 * the block's own marks so its white fill never paints over them; the return
 * value is the height consumed including the frame's padding.
 */
function block(
  out: FloorplanGeometry[],
  box: Box,
  title: string,
  body: (inner: Box) => number,
): number {
  const marker = out.length
  let used = 0
  if (title) used += heading(out, box, title)
  used += body({ ...box, y: box.y + used, h: Math.max(0, box.h - used) })
  const framed: FloorplanGeometry[] = []
  frame(framed, { ...box, h: used })
  out.splice(marker, 0, ...framed)
  return used + PAD * 2
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
  // The basis line quotes the rules file's OWN statement of its code basis
  // rather than a second copy of it written here, plus the adoption snapshot
  // for the resolved jurisdiction when there is one.
  const edition = necEditionFor(jurisdiction)
  used += caption(
    out,
    { ...box, y: box.y + used + 0.06, h: 0.8 },
    `Basis: ${ELECTRICAL_BASIS}. ${ELECTRICAL_ALARM_BASIS}.${edition ? ` Adoption — ${edition}.` : ''} ${RULES_DISCLAIMER}`,
  )
  return used
}

function drawLegend(
  out: FloorplanGeometry[],
  box: Box,
  legend: readonly DeviceSymbol[],
  style: sym.SymbolStyle,
): number {
  if (legend.length === 0) return caption(out, box, 'No electrical devices on this level.')
  // The swatch is the SAME builder the plan uses, rebuilt at a paper size —
  // a legend drawing a different glyph from the drawing is worse than none.
  const swatchStyle: sym.SymbolStyle = { unit: 0.16, stroke: 0.018, ink: style.ink }
  const rows: LegendRow[] = [...legend]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((symbol) => ({
      swatch: symbol.build(swatchStyle),
      label: symbol.qualifier ? `${symbol.label}  [${symbol.qualifier}]` : symbol.label,
      key: symbol.key,
    }))
  const printed = legendBlock(out, box, rows)
  let height = printed.height
  if (printed.overflow > 0) {
    height += caption(
      out,
      { ...box, y: box.y + height, h: 0.4 },
      `+${printed.overflow} more symbols — enlarge this viewport.`,
    )
  }
  return height
}

/**
 * The panel schedule: one row per branch circuit the engine assigned, with
 * the breaker, the conductor, the device count, the connected VA and the
 * protection mark — every value read off the fixtures, never typed in.
 */
export function panelScheduleTable(
  rows: ReturnType<typeof circuitSchedule>,
  serviceAmps: number,
  /** Characters the DESCRIPTION cell can hold at the drawn column width. */
  descriptionChars = 26,
): ScheduleTable {
  return {
    title: 'Panel schedule',
    columns: PANEL_COLUMNS,
    rows: rows.map((row) => ({
      circuit: row.circuit,
      // `drawTable` does not clip a cell, so a long zone hint would run under
      // the next column. Truncated HERE, where the column width is known.
      description: clip(circuitZoneHint(row.circuit), descriptionChars),
      breaker: String(row.breakerA),
      awg: String(row.gaugeAwg),
      count: String(row.devices),
      va: String(Math.round(row.va)),
      // 'DF' is the trade's own word for a dual-function AFCI/GFCI breaker,
      // and it is the only one that fits the column at this width. The
      // caption under the table spells it out.
      type: row.afci && row.gfci ? 'DF' : row.afci ? 'AFCI' : row.gfci ? 'GFCI' : '—',
      service: `${serviceAmps}`,
    })),
    issues: [],
  }
}

/**
 * The schedule's columns. Weights are sized against the ~4-in plate column
 * they are drawn in: every cell's widest real value has to fit inside its own
 * cell, because `draw-table.ts` paints text without clipping.
 */
const PANEL_COLUMNS = [
  { key: 'circuit', label: 'CKT', weight: 0.95 },
  { key: 'description', label: 'DESCRIPTION', weight: 2.2 },
  { key: 'breaker', label: 'AMPS', weight: 0.6 },
  { key: 'awg', label: 'AWG', weight: 0.5 },
  { key: 'count', label: 'DEV', weight: 0.5 },
  { key: 'va', label: 'VA', weight: 0.62 },
  { key: 'type', label: 'TYPE', weight: 0.62 },
]

const PANEL_WEIGHT_TOTAL = PANEL_COLUMNS.reduce((sum, column) => sum + column.weight, 0)

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function drawPanelSchedule(
  out: FloorplanGeometry[],
  box: Box,
  rows: ReturnType<typeof circuitSchedule>,
  serviceAmps: number,
): number {
  // The DESCRIPTION column's share of the box, in characters at the 0.115-in
  // body size `draw-table.ts` sets (≈0.5 em average advance, 0.08-in pads).
  const descriptionW = (box.w * 2.2) / PANEL_WEIGHT_TOTAL - 0.16
  const descriptionChars = Math.max(8, Math.floor(descriptionW / 0.058))
  const table = panelScheduleTable(rows, serviceAmps, descriptionChars)
  if (table.rows.length === 0) {
    let used = heading(out, box, 'Panel schedule')
    used += caption(out, { ...box, y: box.y + used, h: 0.4 }, 'No branch circuits assigned.')
    return used
  }
  const connectedVa = rows.reduce((sum, row) => sum + row.va, 0)
  const tableH = Math.max(0.9, box.h - 0.72)
  out.push(
    ...drawTable(table, box.x, box.y, box.w, tableH, {
      title: table.title,
      // Kept SHORT: `draw-table.ts` sets the legend on one unwrapped line, so
      // anything longer than the column runs off the plate.
      legend: 'TYPE: DF = dual-function AFCI/GFCI breaker',
    }),
  )
  const used = Math.min(tableH, 0.52 + 0.28 + rows.length * 0.24)
  return (
    used +
    caption(
      out,
      { ...box, y: box.y + used + 0.02, h: 0.6 },
      `Service ${serviceAmps} A minimum (NEC 230.79(C)). ${Math.round(connectedVa)} VA connected across ${rows.length} branch circuits — a connected total, not an Article 220 calculated load.`,
    )
  )
}

/* ---------------------------------------------------------- helpers */

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

export function registerElectricalProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('electrical', (nodes, args) =>
    buildElectricalDrawing(nodes, args as unknown as ProviderArgs),
  )
}
