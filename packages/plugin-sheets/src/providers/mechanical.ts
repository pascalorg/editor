/**
 * M1.0 — the mechanical plan, derived live from Bones' HVAC engine
 * (packages/plugin-bones/src/engines/hvac.ts) the way E1.0 and P1.0 are
 * from theirs: the attic trunk and branches as double-line ducts on the
 * architectural background, the supply registers and the return grille as
 * symbols, the indoor unit, the outdoor unit(s), the thermostat and the
 * exhaust fans — and, in the notes column, the MANUAL J-LITE LOAD the
 * equipment was sized by (IRC M1401.3: equipment per ACCA Manual S from
 * Manual J loads), the system, the selection and the cited mechanical
 * notes. Every figure on the sheet is the engine's own, with its basis.
 *
 * Steve (2026-09-07): "I want the hvac to make sure it's real world styles
 * and transitions, sized correctly for the house, include manual j load
 * calcs automated to the plans, make sure the ducts and stuff work".
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { type Bounds, EMPTY_BOUNDS, geometryListBounds, isEmpty, unionBounds } from '../bounds'
import { drawTable } from '../draw-table'
import { type DrawingProvider, type DrawingResult, firstLevelId, type ProviderArgs, viewportNote } from '../drawings'
import type { NodeMap } from '../model'
import type { ScheduleTable } from '../schedule'
import type { Fixture, Member } from '../../../plugin-bones/src/core/types'
import type { CoolingPlan } from '../../../plugin-bones/src/engines/hvac'
import { basePlan } from './mep/base-plan'
import { columnsOf, type PlateLayout, plateLayout } from './mep/layout'
import { fixturesOf, mepModel } from './mep/model'
import { mepBasisLine } from './mep/notes'
import {
  type Box,
  capWarnings,
  caption,
  frame,
  heading,
  legendBlock,
  type LegendRow,
  notesColumn,
  PAD,
} from './mep/plate'
import * as sym from './mep/symbols'

export const DUCT_INK = '#1d4ed8'
export const MECH_INK = '#111827'

export const MECHANICAL_EMPTY_NOTE = [
  'MECHANICAL PLAN',
  '',
  'No HVAC could be laid out on this level: Bones found nothing to condition',
  '(no habitable rooms), or the HVAC system is switched off in the Bones panel.',
  'Turn it on and regenerate the sheet.',
].join('\n')

/** Cited mechanical notes — every one names its section. */
export function mechanicalNotes(system: string | null): string[] {
  const sys =
    system === 'heat-pump-split'
      ? 'a split heat pump (indoor air handler with electric strip backup, outdoor unit on a pad)'
      : system === 'ac-gas-furnace'
        ? 'a gas furnace (upflow) with an evaporator coil and an outdoor AC condenser; the furnace vents through a B-vent to above the roof (G2427 / M1801) and takes combustion air per G2407'
        : system === 'packaged'
          ? 'a packaged heating + cooling unit on a pad outside; supply and return plenums through the exterior wall into the attic'
          : system === 'mini-split'
            ? 'a ductless multi-zone system: wall heads in the habitable rooms, refrigerant line sets to the outdoor unit(s) by the installer (M1411)'
            : 'a split system: indoor air handler, outdoor condenser'
  return [
    `System: ${sys}. Equipment sized per ACCA Manual S from the Manual J load on this sheet (IRC M1401.3); the load is a schematic sensible calculation with a latent allowance — a full Manual J by the mechanical contractor governs.`,
    'Ducts: the supply trunk and branches run in the attic above the ceiling joists, never notched through top plates (M1601.1 / R602.6); supply boots drop through the ceiling; the trunk steps down after each takeoff (Manual D). Seal and insulate ducts in unconditioned space (N1103.3 / IECC R403.3, R-8 attic).',
    'Duct leakage: test to ≤ 4 cfm per 100 sq ft of conditioned floor area at 25 Pa (IECC R403.3.5 / N1103.3.5) unless every duct is inside the thermal envelope.',
    'Return air: one central return grille in a conditioned room, sized ~200 sq in per ton; no return air from a garage, bathroom or kitchen (M1602.2). Closable rooms get a door undercut or a jumper duct (M1602.2).',
    'Bath exhaust fans 50 cfm intermittent to the outdoors (M1505.4 / R303.3); the clothes dryer vents to the outdoors in 4 in rigid metal, ≤ 35 ft with elbow deductions (M1502).',
    'Condensate: primary drain to an approved point, secondary drain or float switch on attic units (M1411.3); attic equipment gets a service platform and a passage ≥ 30 in wide (M1305.1.3).',
    'Outdoor unit on a level pad ≥ 3 in above grade, 12 in clear to the wall and the service side clear per the listing (M1401.5 / M1403); a disconnect within sight (NEC 440.14).',
    'Thermostat 48–52 in AFF on an interior wall away from supply air; programmable per N1103.1.1 (IECC R403.1.1).',
  ]
}

/** The Manual J-lite load as a two-column table — each term, its figure, its basis. */
export function manualJTable(plan: CoolingPlan | null, system: string | null): ScheduleTable {
  const rows: Record<string, string>[] = []
  const row = (item: string, value: string) => rows.push({ item, value })
  if (!plan) {
    row('Load', 'not computed — no conditioned rooms on this level')
    return { title: 'Manual J-lite cooling load', columns: cols(), rows, issues: [] }
  }
  const load = plan.load
  if (load) {
    row('Climate zone', `${load.zone} (design ${load.outdoorDesignC}°C out / ${load.indoorDesignC}°C in, ΔT ${load.deltaTK.toFixed(1)} K)`)
    row('Conditioned area', `${Math.round(load.conditionedAreaM2 * 10.7639).toLocaleString('en-US')} sq ft, ${load.bedrooms} bedrooms → ${load.occupants} occupants`)
    row('Envelope UA', `${load.uaWPerK.toFixed(0)} W/K (walls ${load.uaWallsWPerK.toFixed(0)}, windows ${load.uaWindowsWPerK.toFixed(0)}, ceiling ${load.uaCeilingWPerK.toFixed(0)})`)
    row('Envelope conduction', `${btu(load.envelopeW)} Btu/h`)
    row('Glazing solar gain', `${btu(load.solarW)} Btu/h`)
    row('Internal gains', `${btu(load.internalW)} Btu/h`)
    row('Infiltration', `${btu(load.infiltrationW)} Btu/h`)
    row('Sensible total', `${Math.round(load.totalBtuH).toLocaleString('en-US')} Btu/h (${load.sensibleTons.toFixed(2)} t)`)
    row('Latent allowance', `× ${load.latentFactor}${load.moistureRegime ? ` (regime ${load.moistureRegime})` : ' (no regime)'} → ${load.loadTons.toFixed(2)} t design load`)
  } else {
    row('Load basis', `sq ft rule — ${plan.sizingNote}`)
  }
  row('Manual S selection', `${plan.totalTons} t${plan.withinManualSBand ? ' (within 95–115 %)' : ' (OUTSIDE the 95–115 % band — verify)'}`)
  row('Installed', `${plan.count} × ${plan.unitTons} t = ${plan.installedTons} t${plan.installedWithinBand ? '' : ' (outside the band — verify)'}`)
  row('System', systemName(system))
  return { title: 'Manual J-lite cooling load', columns: cols(), rows, issues: [] }
}

const cols = () => [
  { key: 'item', label: 'Item', weight: 1 },
  { key: 'value', label: 'Value / basis', weight: 2.2 },
]
const btu = (w: number): string => Math.round(w * 3.412142).toLocaleString('en-US')

export function systemName(system: string | null): string {
  switch (system) {
    case 'heat-pump-split':
      return 'Split heat pump'
    case 'ac-gas-furnace':
      return 'AC + gas furnace'
    case 'packaged':
      return 'Packaged unit'
    case 'mini-split':
      return 'Ductless mini-split'
    default:
      return 'Split system (air handler + condenser)'
  }
}

/** A duct member's plan footprint as a closed outline (three.js yaw: +x → (cos, −sin), +z → (sin, cos)). */
function ductOutline(m: Member): [number, number][] {
  const [dx, , dz] = m.dims
  const yaw = m.rotation[1]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const [px, , pz] = m.position
  const corner = (x: number, z: number): [number, number] => [px + x * c + z * s, pz - x * s + z * c]
  return [corner(-dx / 2, -dz / 2), corner(dx / 2, -dz / 2), corner(dx / 2, dz / 2), corner(-dx / 2, dz / 2)]
}

function registerSymbol(s: sym.SymbolStyle, kind: 'supply' | 'return'): FloorplanGeometry[] {
  const half = s.unit * 0.6
  const out: FloorplanGeometry[] = [
    { kind: 'rect', x: -half, y: -half, width: half * 2, height: half * 2, fill: sym.PAPER_WHITE, stroke: DUCT_INK, strokeWidth: s.stroke },
  ]
  if (kind === 'supply') {
    out.push({ kind: 'line', x1: -half, y1: -half, x2: half, y2: half, stroke: DUCT_INK, strokeWidth: s.stroke })
  } else {
    out.push({ kind: 'line', x1: -half, y1: -half, x2: half, y2: half, stroke: DUCT_INK, strokeWidth: s.stroke })
    out.push({ kind: 'line', x1: -half, y1: half, x2: half, y2: -half, stroke: DUCT_INK, strokeWidth: s.stroke })
  }
  return out
}

type Legend = { key: string; label: string; build: (s: sym.SymbolStyle) => FloorplanGeometry[] }

export function buildMechanicalDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const box: Box = { x: args.viewport.x, y: args.viewport.y, w: args.viewport.w, h: args.viewport.h }
  const levelId = args.levelId ?? firstLevelId(nodes)
  if (!levelId) {
    return { primitives: [], bounds: EMPTY_BOUNDS, plate: viewportNote(box, 'MECHANICAL PLAN\n\nNo level in this scene yet.'), noLabel: true, title: 'Mechanical plan' }
  }
  const model = mepModel(nodes, levelId)
  const plan = model?.hvacPlan ?? null
  const system = model?.hvacSystem ?? null
  if (args.system === 'notes') {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: notesPlate(box, plan, system, model?.jurisdiction ?? 'AUTO'),
      noLabel: true,
      title: 'Mechanical notes',
    }
  }
  const warnings: string[] = [...(model?.warnings ?? []).filter((w) => /hvac|duct|condenser|air handler|furnace|mini-split|packaged|manual|return air|tonnage|cooling/i.test(w))]
  const hvac = model ? fixturesOf(model, 'hvac') : []
  const ducts = (model?.members ?? []).filter((m) => m.system === 'hvac' && m.role === 'duct-run')
  const layout = plateLayout(args.viewport)
  const style = sym.styleFor(args.viewport.scale)
  if (hvac.length === 0 && ducts.length === 0) {
    return {
      primitives: [],
      bounds: EMPTY_BOUNDS,
      plate: [...viewportNote({ x: box.x, y: box.y, w: layout.mode === 'column' ? layout.plan.w : box.w, h: box.h * 0.38 }, MECHANICAL_EMPTY_NOTE)],
      warnings: capWarnings(warnings),
      noLabel: true,
      title: 'Mechanical plan',
    }
  }
  const base = basePlan(nodes, levelId, args.layers, 0.34)
  const primitives: FloorplanGeometry[] = []
  if (base.geometry) primitives.push(base.geometry)
  else warnings.push('architectural background unavailable — ducts drawn without the floor plan under them')
  // ducts first: double-line outlines of each run's plan footprint
  const ductGeometry: FloorplanGeometry[] = ducts.map((m) => ({
    kind: 'polygon',
    points: ductOutline(m),
    fill: 'none',
    stroke: DUCT_INK,
    strokeWidth: style.unit * 0.12,
    opacity: 0.95,
  }))
  if (ductGeometry.length > 0) primitives.push({ kind: 'group', children: ductGeometry })
  const legend = new Map<string, Legend>()
  const glyphs: FloorplanGeometry[] = []
  const tags: FloorplanGeometry[] = []
  const put = (key: string, label: string, build: (s: sym.SymbolStyle) => FloorplanGeometry[], f: Fixture, tag?: string) => {
    legend.set(key, { key, label, build })
    glyphs.push(sym.stamp(build(style), f.position[0], f.position[2], 0))
    if (tag) tags.push(sym.stamp([sym.tag(style, tag, 0, -style.unit * 1.0, { size: 0.5, fill: MECH_INK })], f.position[0], f.position[2], 0))
    if (typeof f.label === 'string' && f.label.includes('⚠')) warnings.push(f.label.replace(/^.*⚠\s*/, '⚠ '))
  }
  for (const f of hvac) {
    const equipment = typeof f.meta?.equipment === 'string' ? f.meta.equipment : ''
    switch (f.kind) {
      case 'register':
        put('supply', 'Supply register (ceiling boot from the attic branch)', (s) => registerSymbol(s, 'supply'), f)
        break
      case 'return':
        put('return', 'Return grille (central, sized ~200 sq in / ton — M1602)', (s) => registerSymbol(s, 'return'), f, 'R')
        break
      case 'thermostat':
        put('thermostat', 'Thermostat', (s) => sym.thermostat(s), f)
        break
      case 'exhaust-fan':
        put('exhaust', 'Exhaust fan to the outdoors (M1505 / M1502)', (s) => sym.exhaustFan(s), f)
        break
      case 'disconnect':
        put('disconnect', 'Outdoor unit disconnect (NEC 440.14)', (s) => sym.boxSymbol(s, 'D'), f)
        break
      case 'equipment':
        if (equipment === 'condenser') put('outdoor', `Outdoor unit on a pad — ${systemName(system)}`, (s) => sym.boxSymbol(s, 'CU'), f)
        else if (equipment === 'mini-split-head') put('head', 'Ductless wall head', (s) => sym.boxSymbol(s, 'DH'), f)
        else put('indoor', `Indoor unit — ${systemName(system)}`, (s) => sym.boxSymbol(s, system === 'ac-gas-furnace' ? 'F' : 'AH'), f)
        break
      default:
        break
    }
  }
  primitives.push({ kind: 'group', children: glyphs })
  primitives.push({ kind: 'group', children: tags })
  const drawn = unionBounds(base.bounds, geometryListBounds([{ kind: 'group', children: [...glyphs, ...ductGeometry] }]))
  const bounds = shiftCentre(isEmpty(drawn) ? EMPTY_BOUNDS : drawn, layout.shift)
  const plate = mechanicalPlates({ layout, legend: [...legend.values()], hasDucts: ducts.length > 0, withNotes: args.system !== 'plan', plan, system, jurisdiction: model?.jurisdiction ?? 'AUTO' })
  return { primitives, bounds, plate, warnings: capWarnings(warnings), noLabel: true, title: 'Mechanical plan' }
}

function shiftCentre(b: Bounds, shift: { x: number; y: number }): Bounds {
  return { minX: b.minX + shift.x, minY: b.minY + shift.y, maxX: b.maxX + shift.x, maxY: b.maxY + shift.y }
}

function block(out: FloorplanGeometry[], box: Box, title: string, body: (inner: Box) => number): number {
  const marker = out.length
  let used = 0
  if (title.trim()) used += heading(out, box, title)
  used += body({ ...box, y: box.y + used, h: Math.max(0, box.h - used) })
  const framed: FloorplanGeometry[] = []
  frame(framed, { ...box, h: used })
  out.splice(marker, 0, ...framed)
  return used + PAD * 2
}

function mechanicalPlates(input: { layout: PlateLayout; legend: readonly Legend[]; hasDucts: boolean; withNotes: boolean; plan: CoolingPlan | null; system: string | null; jurisdiction: string }): FloorplanGeometry[] {
  const { layout, legend, hasDucts, withNotes, plan, system, jurisdiction } = input
  const out: FloorplanGeometry[] = []
  const drawKey = (col: Box): number => {
    return block(out, col, 'Mechanical key', (inner) => {
      const rows: LegendRow[] = [
        ...(hasDucts
          ? [{ swatch: [{ kind: 'rect', x: 0, y: -0.05, width: 0.28, height: 0.1, fill: 'none', stroke: DUCT_INK, strokeWidth: 0.018 } as FloorplanGeometry], label: 'Supply / return duct in the attic (plan footprint)', key: 'duct' }]
          : []),
        ...legend.map((entry) => ({ swatch: entry.build({ unit: 0.16, stroke: 0.018, ink: MECH_INK }), label: entry.label, key: entry.key })),
      ]
      if (rows.length === 0) return caption(out, inner, 'No HVAC modelled on this level.')
      const printed = legendBlock(out, inner, rows)
      let used = printed.height
      if (printed.overflow > 0) used += caption(out, { ...inner, y: inner.y + used, h: 0.4 }, `+${printed.overflow} more — enlarge this viewport.`)
      return used
    })
  }
  if (layout.mode === 'column') {
    const col: Box = { x: layout.plates.x + PAD, y: layout.plates.y + PAD, w: layout.plates.w - PAD * 2, h: layout.plates.h - PAD * 2 }
    const used = drawKey(col)
    if (!withNotes) return out
    const y = col.y + used + 0.18
    out.push(...notesPlate({ ...col, y, h: Math.max(0.8, col.y + col.h - y) }, plan, system, jurisdiction))
    return out
  }
  const boxes = columnsOf(layout.plates, withNotes ? Math.max(2, layout.stackColumns) : 1)
  const first = boxes[0]
  if (first) drawKey({ x: first.x + PAD, y: first.y + PAD, w: first.w - PAD * 2, h: first.h - PAD * 2 })
  const second = boxes[1]
  if (withNotes && second) out.push(...notesPlate({ x: second.x + PAD, y: second.y + PAD, w: second.w - PAD * 2, h: second.h - PAD * 2 }, plan, system, jurisdiction))
  return out
}

/** The load table over the cited notes. */
function notesPlate(box: Box, plan: CoolingPlan | null, system: string | null, jurisdiction: string): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const inner: Box = { x: box.x + PAD, y: box.y + PAD, w: box.w - PAD * 2, h: box.h - PAD * 2 }
  const table = manualJTable(plan, system)
  const tableH = Math.min(inner.h * 0.55, 0.32 + table.rows.length * 0.26 + 0.2)
  let y = inner.y
  y += block(out, { ...inner, y, h: tableH }, '', (b) => {
    const drawn = drawTable(table, b.x, b.y, b.w, b.h, { wrap: true })
    out.push(...drawn)
    return b.h
  })
  y += 0.1
  block(out, { ...inner, y, h: Math.max(0.8, inner.y + inner.h - y) }, 'Mechanical notes', (b) => {
    const notes = [...mechanicalNotes(system), `Basis: ${mepBasisLine(jurisdiction)}`]
    return notesColumn(out, b, notes, 0.1).height
  })
  return out
}

export function registerMechanicalProvider(register: (key: string, provider: DrawingProvider) => void): void {
  register('mechanical', (nodes, args) => buildMechanicalDrawing(nodes, args as unknown as ProviderArgs))
}
