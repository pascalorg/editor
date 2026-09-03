/**
 * The 'structural' sheet drawing provider — the S-series, drawn LIVE from the
 * scene through the Bones framing engines.
 *
 * One viewport kind, many drawings: `args.system` picks which. The plans are
 * LIVE WINDOWS (world-metre `primitives` + `bounds`); the schedules, legends
 * and note blocks are PLATES (absolute sheet inches laid out inside
 * `args.viewport`), so a sheet is composed the way a real one is — a plan on
 * the left, a column of schedules and cited notes down the right.
 *
 *   foundation ............. S1.0 plan: slab, footings (hidden), stemwalls,
 *                            anchorage, footing type tags, slab callout
 *   foundation-schedules ... FOOTING SCHEDULE + ANCHORAGE SCHEDULE
 *   foundation-legend ...... FOUNDATION LEGEND (only what was drawn)
 *   foundation-notes ....... GENERAL FOUNDATION NOTES, cited
 *   floor-framing .......... S2.x plan: joists, rims, girders, posts, hangers
 *   floor-schedules ........ FLOOR BEAM SCHEDULE
 *   floor-notes ............ FLOOR FRAMING NOTES + FLOOR LEGEND
 *   roof-framing ........... S3.0 plan: rafters/trusses, ridge/hip/valley
 *   roof-schedules ......... ROOF BEAM SCHEDULE
 *   roof-notes ............. ROOF FRAMING NOTES + ROOF LEGEND
 *   wall-bracing ........... S4.0 plan: IRC R602.10 braced wall lines
 *   bracing-schedules ...... BRACED WALL LINE SCHEDULE + notes
 *   notes .................. SN1: design criteria, materials, fastening
 *
 * THE RULE THIS FILE KEEPS: no invented numbers. Every dimension, spacing and
 * size printed here is either a member's own geometry, a value from the
 * resolved `FramingSpec`, or a string from the jurisdiction data files — and
 * anything the engines do not derive prints as "(verify: IRC Rxxx)". Where
 * the engines produce nothing (a slab-on-grade storey has no floor framing;
 * a masonry house has no R602.10 braced wall lines) the sheet says so in
 * plain words instead of drawing something plausible.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { geometryListBounds, isEmpty } from '../bounds'
import type { DrawingProvider, DrawingResult, ProviderArgs } from '../drawings'
import { viewportNote } from '../drawings'
import type { NodeMap } from '../model'
import {
  bracingNotes,
  bracingPrimitives,
  bracingScheduleTable,
  hasBracedWallLines,
} from './structural/bracing'
import { pen } from './structural/draw'
import {
  anchorageScheduleTable,
  footingScheduleTable,
  foundationNotes,
  foundationPrimitives,
  foundationSummary,
} from './structural/foundation'
import {
  beamScheduleTable,
  floorBeamRows,
  floorFramingNotes,
  floorFramingPrimitives,
  noFloorFramingNotes,
  roofBeamRows,
  roofFramingNotes,
  roofFramingPrimitives,
} from './structural/framing'
import {
  membersOf,
  type StructuralModel,
  structuralModel,
  structuralWarnings,
} from './structural/model'
import {
  criteriaTable,
  fasteningScheduleTable,
  hardwareNotes,
  structuralNotes,
} from './structural/notes'
import {
  type Box,
  heading,
  type LegendEntry,
  legendBlockSized,
  type Note,
  notesBlockSized,
  scheduleBlock,
  stack,
} from './structural/plate'

/** Every `system` this provider answers to. */
export const STRUCTURAL_SYSTEMS = [
  'foundation',
  'foundation-schedules',
  'foundation-legend',
  'foundation-notes',
  'floor-framing',
  'floor-schedules',
  'floor-notes',
  'roof-framing',
  'roof-schedules',
  'roof-notes',
  'wall-bracing',
  'bracing-schedules',
  'notes',
] as const
export type StructuralSystem = (typeof STRUCTURAL_SYSTEMS)[number]

export function buildStructuralDrawing(nodes: NodeMap, args: ProviderArgs): DrawingResult | null {
  const box: Box = args.viewport
  const system = (args.system ?? 'foundation') as StructuralSystem
  const model = structuralModel(nodes, args.levelId)
  if (!model) {
    return plateOnly(viewportNote(box, NO_LEVEL_NOTE), 'Structural', [
      'No level in this scene — nothing to frame.',
    ])
  }
  if (model.walls.length === 0) {
    return plateOnly(viewportNote(box, noWallsNote(model)), `Structural — ${model.levelLabel}`, [
      `${model.levelLabel} has no walls: the framing engines have nothing to derive.`,
    ])
  }

  switch (system) {
    case 'foundation':
      return foundationPlan(model, args)
    case 'foundation-schedules':
      return foundationSchedules(model, box)
    case 'foundation-legend':
      return foundationLegend(model, args)
    case 'foundation-notes':
      return notesPlate(
        box,
        'General foundation notes',
        foundationNotes(model),
        foundationSummary(model),
      )
    case 'floor-framing':
      return floorPlan(model, args)
    case 'floor-schedules':
      return floorSchedules(model, box)
    case 'floor-notes':
      return framingNotesPlate(model, args, 'floor')
    case 'roof-framing':
      return roofPlan(model, args)
    case 'roof-schedules':
      return roofSchedules(model, box)
    case 'roof-notes':
      return framingNotesPlate(model, args, 'roof')
    case 'wall-bracing':
      return bracingPlan(model, args)
    case 'bracing-schedules':
      return bracingSchedules(model, box)
    case 'notes':
      return structuralNotesSheet(model, box)
    default:
      return plateOnly(viewportNote(box, unknownSystemNote(system)), 'Structural', [
        `Unknown structural system "${String(system)}".`,
      ])
  }
}

export function registerStructuralProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('structural', (nodes, args) =>
    buildStructuralDrawing(nodes, args as unknown as ProviderArgs),
  )
}

/* ------------------------------------------------------------- plans */

function foundationPlan(model: StructuralModel, args: ProviderArgs): DrawingResult {
  const p = pen(args.viewport.scale || 48)
  const drawn = foundationPrimitives(model, p)
  if (membersOf(model, 'foundation', 'footing').length === 0 && model.slabs.length === 0) {
    return plateOnly(
      viewportNote(args.viewport, NO_FOUNDATION_NOTE),
      `Foundation plan — ${model.levelLabel}`,
      drawn.warnings,
    )
  }
  return live(drawn.primitives, `Foundation & anchorage plan — ${model.levelLabel}`, [
    ...drawn.warnings,
    ...modelWarnings(model),
  ])
}

function roofPlan(model: StructuralModel, args: ProviderArgs): DrawingResult {
  const p = pen(args.viewport.scale || 48)
  const drawn = roofFramingPrimitives(model, p)
  if (membersOf(model, 'roof-framing').length === 0) {
    return plateOnly(
      viewportNote(args.viewport, noRoofNote(model)),
      `Roof framing plan — ${model.levelLabel}`,
      drawn.warnings,
    )
  }
  return live(drawn.primitives, `Roof framing plan — ${model.levelLabel}`, [
    ...drawn.warnings,
    ...modelWarnings(model),
  ])
}

function floorPlan(model: StructuralModel, args: ProviderArgs): DrawingResult {
  if (membersOf(model, 'floor-framing').length === 0) {
    return notesPlate(
      args.viewport,
      `Floor framing — ${model.levelLabel}`,
      noFloorFramingNotes(model),
      'No framed floor on this level',
    )
  }
  const p = pen(args.viewport.scale || 48)
  const drawn = floorFramingPrimitives(model, p)
  return live(drawn.primitives, `Floor framing plan — ${model.levelLabel}`, [
    ...drawn.warnings,
    ...modelWarnings(model),
  ])
}

function bracingPlan(model: StructuralModel, args: ProviderArgs): DrawingResult {
  if (!hasBracedWallLines(model)) {
    return notesPlate(
      args.viewport,
      `Braced wall plan — ${model.levelLabel}`,
      bracingNotes(model),
      'No IRC R602.10 braced wall lines on this level',
    )
  }
  const drawn = bracingPrimitives(model, pen(args.viewport.scale || 48))
  return live(drawn.primitives, `Braced wall plan (IRC R602.10) — ${model.levelLabel}`, [
    ...drawn.warnings,
    ...modelWarnings(model),
  ])
}

/* ------------------------------------------------------------ plates */

function foundationSchedules(model: StructuralModel, box: Box): DrawingResult {
  return stackedPlate(box, `Foundation schedules — ${model.levelLabel}`, [
    scheduleBlock(
      footingScheduleTable(model),
      'Footing schedule',
      'Sizes are the pours the foundation engine derived; bearing depth follows the jurisdiction frost line (IRC R403.1.4.1).',
    ),
    scheduleBlock(
      anchorageScheduleTable(model),
      'Anchorage schedule',
      'Sill anchorage and hold-downs as placed by the foundation engine (IRC R403.1.6 / R602.11.1).',
    ),
  ])
}

function foundationLegend(model: StructuralModel, args: ProviderArgs): DrawingResult {
  const entries = foundationPrimitives(model, pen(args.viewport.scale || 48)).legend
  return legendPlate(args.viewport, 'Foundation legend', entries)
}

function floorSchedules(model: StructuralModel, box: Box): DrawingResult {
  return stackedPlate(box, `Floor beam schedule — ${model.levelLabel}`, [
    scheduleBlock(
      beamScheduleTable(
        floorBeamRows(model),
        'Floor beam schedule',
        'No floor girders derived on this level — a slab-on-grade storey has no framed floor.',
      ),
      'Floor beam schedule',
      'Girders from the floor-framing engine (IRC Table R502.3.1(2), SPF #2 assumed). LENGTH is the member’s own cut length.',
    ),
  ])
}

function roofSchedules(model: StructuralModel, box: Box): DrawingResult {
  return stackedPlate(box, `Roof beam schedule — ${model.levelLabel}`, [
    scheduleBlock(
      beamScheduleTable(
        roofBeamRows(model),
        'Roof beam schedule',
        'No headers, ridges or beams derived on this level.',
      ),
      'Roof beam schedule',
      'Headers sized from IRC Table R602.7(1); a nominal 4x is that table’s two-ply built-up 2x member. LENGTH is the member’s own cut length, not a clear span.',
    ),
  ])
}

function bracingSchedules(model: StructuralModel, box: Box): DrawingResult {
  return stackedPlate(box, `Braced wall schedule — ${model.levelLabel}`, [
    scheduleBlock(
      bracingScheduleTable(model),
      'Braced wall line schedule',
      'Lines identified by the wall-bracing engine; panel lengths are NOT verified (IRC R602.10.3).',
    ),
    notesBlockSized('Braced wall notes', bracingNotes(model), 1, box.w),
  ])
}

function framingNotesPlate(
  model: StructuralModel,
  args: ProviderArgs,
  kind: 'floor' | 'roof',
): DrawingResult {
  const p = pen(args.viewport.scale || 48)
  const drawn = kind === 'roof' ? roofFramingPrimitives(model, p) : floorFramingPrimitives(model, p)
  const notes = kind === 'roof' ? roofFramingNotes(model) : floorFramingNotes(model)
  const title = kind === 'roof' ? 'Roof framing notes' : 'Floor framing notes'
  const legendTitle = kind === 'roof' ? 'Roof legend' : 'Floor legend'
  return stackedPlate(args.viewport, `${title} — ${model.levelLabel}`, [
    notesBlockSized(title, notes, args.viewport.w > 7 ? 2 : 1, args.viewport.w),
    legendBlockSized(legendTitle, drawn.legend),
  ])
}

function structuralNotesSheet(model: StructuralModel, box: Box): DrawingResult {
  // SN1 is a whole sheet, so it lays itself out in two columns: criteria and
  // fastening on the left, the numbered notes flowing beside them.
  const gap = 0.5
  const leftW = Math.min(box.w * 0.46, 13)
  const rightW = Math.max(2, box.w - leftW - gap)
  const left: Box = { x: box.x, y: box.y, w: leftW, h: box.h }
  const right: Box = { x: box.x + leftW + gap, y: box.y, w: rightW, h: box.h }

  const out: FloorplanGeometry[] = stack(left, [
    scheduleBlock(
      criteriaTable(model),
      'Design criteria',
      `Jurisdiction ${model.jurisdiction} — ${model.jurisdictionSource}`,
    ),
    scheduleBlock(
      fasteningScheduleTable(),
      'Fastening schedule',
      'IRC 2021 Table R602.3(1) — common connections.',
    ),
    notesBlockSized('Connector hardware', hardwareNotes(), 1, left.w),
  ])
  const head = heading(right, 'Structural notes', `${model.levelLabel} — ${model.profile.name}`)
  out.push(...head.geometry)
  out.push(
    ...notesBlockSized('', structuralNotes(model), right.w > 8 ? 2 : 1, right.w).render({
      x: right.x,
      y: right.y + head.height,
      w: right.w,
      h: right.h - head.height,
    }),
  )
  return plateOnly(out, `Structural notes — ${model.levelLabel}`, [])
}

/* ------------------------------------------------------- composition */

function live(primitives: FloorplanGeometry[], title: string, warnings: string[]): DrawingResult {
  const bounds = textAwareBounds(primitives)
  return {
    primitives,
    bounds: isEmpty(bounds) ? { minX: -6, minY: -6, maxX: 6, maxY: 6 } : bounds,
    title,
    warnings: dedupe(warnings).slice(0, 6),
  }
}

/**
 * `geometryListBounds` measures a text primitive by its ANCHOR POINT, so a
 * callout parked off the right edge of the building fits the window while its
 * words hang outside it and get cropped. The plan callouts on these sheets
 * are deliberately hung off the drawing, so the bounds have to know roughly
 * how wide the words are — half an em per character, plus the line's own
 * position, which is exactly the estimate `plate.ts` wraps with.
 */
function textAwareBounds(primitives: readonly FloorplanGeometry[]) {
  let bounds = geometryListBounds(primitives as FloorplanGeometry[])
  const visit = (list: readonly FloorplanGeometry[], dx: number, dy: number) => {
    for (const g of list) {
      if (g.kind === 'group') {
        // A rotated group's text is measured by its anchor only: the extent
        // arrows it carries are already inside the drawing.
        if (!g.transform?.rotate) {
          visit(
            g.children,
            dx + (g.transform?.translate?.[0] ?? 0),
            dy + (g.transform?.translate?.[1] ?? 0),
          )
        }
        continue
      }
      if (g.kind !== 'text') continue
      const width = g.text.length * g.fontSize * 0.58
      const x = g.x + dx
      const left =
        g.textAnchor === 'end' ? x - width : g.textAnchor === 'middle' ? x - width / 2 : x
      bounds = {
        minX: Math.min(bounds.minX, left),
        minY: Math.min(bounds.minY, g.y + dy - g.fontSize),
        maxX: Math.max(bounds.maxX, left + width),
        maxY: Math.max(bounds.maxY, g.y + dy + g.fontSize * 0.3),
      }
    }
  }
  visit(primitives, 0, 0)
  return bounds
}

function plateOnly(plate: FloorplanGeometry[], title: string, warnings: string[]): DrawingResult {
  return {
    primitives: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    plate,
    title,
    warnings: dedupe(warnings).slice(0, 6),
    noLabel: true,
  }
}

function stackedPlate(
  box: Box,
  title: string,
  blocks: readonly { height: number; render: (at: Box) => FloorplanGeometry[]; label: string }[],
): DrawingResult {
  return plateOnly(stack(box, blocks), title, [])
}

function notesPlate(
  box: Box,
  title: string,
  notes: readonly Note[],
  subtitle?: string,
): DrawingResult {
  const head = heading(box, title, subtitle)
  const body = notesBlockSized('', notes, box.w > 7 ? 2 : 1, box.w).render({
    x: box.x,
    y: box.y + head.height,
    w: box.w,
    h: box.h - head.height,
  })
  return plateOnly([...head.geometry, ...body], title, [])
}

function legendPlate(box: Box, title: string, entries: readonly LegendEntry[]): DrawingResult {
  return plateOnly(
    legendBlockSized(title, entries).render({ x: box.x, y: box.y, w: box.w, h: box.h }),
    title,
    entries.length === 0
      ? ['Nothing was drawn on the matching plan, so this legend is empty.']
      : [],
  )
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list.filter(Boolean))]
}

/**
 * The level's own compute warnings, trimmed to the ones a STRUCTURAL reader
 * needs: Bones warns about plumbing, HVAC and electrical on the same level,
 * and those belong on the M/E sheets, not here.
 */
const modelWarnings = structuralWarnings

/* -------------------------------------------------------------- notes */

const NO_LEVEL_NOTE = [
  'STRUCTURAL — NO LEVEL IN THIS SCENE',
  '',
  'The framing engines derive every member from a level’s walls, slabs',
  'and roofs. This scene has no level, so there is nothing to frame.',
  '',
  'Nothing has been invented to fill this viewport.',
].join('\n')

function noWallsNote(model: StructuralModel): string {
  return [
    'STRUCTURAL — NOTHING TO FRAME',
    '',
    `${model.levelLabel} has no walls, so the framing engines produced no`,
    'members: no footings, no bearing lines, no roof framing.',
    '',
    'Draw the walls, then generate the set again. No footing size,',
    'spacing or member has been invented to fill this sheet.',
  ].join('\n')
}

const NO_FOUNDATION_NOTE = [
  'FOUNDATION — NOT DERIVED FOR THIS LEVEL',
  '',
  'Bones derives the foundation on the GROUND storey only, and only',
  'while the Foundation system is enabled on that level’s X-ray node.',
  '',
  'Enable it (or point this viewport at the ground level) and the slab,',
  'footings, stemwalls and anchorage will draw themselves.',
].join('\n')

function noRoofNote(model: StructuralModel): string {
  return [
    'ROOF FRAMING — NOT DERIVED FOR THIS LEVEL',
    '',
    `The roof engine produced no members for ${model.levelLabel}.`,
    'A roof is framed from the roof and roof-segment nodes in the scene,',
    'by the highest storey whose X-ray has Roof enabled.',
    '',
    'Add a roof, or point this viewport at the storey that owns it.',
    'No rafter size, pitch or spacing has been invented here.',
  ].join('\n')
}

function unknownSystemNote(system: string): string {
  return [
    'STRUCTURAL — UNKNOWN SYSTEM',
    '',
    `This viewport asks for system "${system}", which this provider`,
    'does not draw. The systems it does draw are:',
    '',
    ...STRUCTURAL_SYSTEMS.map((s) => `  · ${s}`),
  ].join('\n')
}

export type { StructuralModel }
/** Re-exported so the plan-set module can ask what exists before it lays out. */
export { hasBracedWallLines, structuralModel }
