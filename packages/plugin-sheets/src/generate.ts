/**
 * "Generate default set" — the sheets a small residential permit set always
 * has, created from what is actually in the scene.
 *
 *   A0.0  Cover            standard three-quarter view, project data, index
 *   A1.0  Site plan
 *   A2.x  Floor plan       one per level, with that level's room schedule
 *   A4.0  Exterior elevations   north / east / south / west
 *   A5.0  Building sections     one per section marker
 *   A8.0  Door & window schedules
 *
 * Idempotent by sheet NUMBER: a run only creates the sheets that are missing,
 * so pressing the button twice never doubles the set and never disturbs a
 * sheet somebody has already laid out.
 */
import { addSheet, addViewport, levelLabel, levels, sheets, type NodeMap } from './model'
import { collectWalls, wallBounds } from './pose'
import { DEFAULT_VIEWPORT_LAYERS, type SheetNode, type ViewportNode } from './schema'
import { fitScale, SCALE_PRESETS } from './scale'
import { sheetFrame } from './titleblock'

export type GeneratedSet = { created: string[]; skipped: string[] }

const PAPER = { size: 'arch-d' as const, widthIn: 36, heightIn: 24 }
const FRAME = sheetFrame(PAPER.widthIn, PAPER.heightIn)
const GAP = 0.5

const ARCH_SCALES = SCALE_PRESETS.filter((p) => p.scale <= 192)
const CIVIL_SCALES = SCALE_PRESETS.filter((p) => p.scale >= 96)

export type Plan = {
  number: string
  title: string
  viewports: (Omit<Partial<ViewportNode>, 'sheetId'> & { kind: ViewportNode['kind'] })[]
}

export function planDefaultSet(nodes: NodeMap): Plan[] {
  const out: Plan[] = []
  const levelNodes = levels(nodes)
  const walls = collectWalls(nodes as never)
  const footprint = wallBounds(walls)
  const buildingW = footprint ? footprint.maxX - footprint.minX : 12
  const buildingH = footprint ? footprint.maxZ - footprint.minZ : 12

  // A0.0 — cover.
  out.push({
    number: 'A0.0',
    title: 'Cover sheet',
    viewports: [
      {
        kind: 'view3d',
        pose: 'cover-front',
        title: 'Perspective',
        x: FRAME.x,
        y: FRAME.y,
        w: FRAME.w,
        h: FRAME.h * 0.66,
      },
      {
        kind: 'notes',
        title: 'Project data',
        text: projectDataText(nodes, levelNodes.length),
        x: FRAME.x,
        y: FRAME.y + FRAME.h * 0.66 + GAP,
        w: FRAME.w / 2 - GAP,
        h: FRAME.h * 0.34 - GAP,
      },
      {
        kind: 'notes',
        title: 'General notes',
        text: GENERAL_NOTES,
        x: FRAME.x + FRAME.w / 2,
        y: FRAME.y + FRAME.h * 0.66 + GAP,
        w: FRAME.w / 2,
        h: FRAME.h * 0.34 - GAP,
      },
    ],
  })

  // A1.0 — site plan.
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const polygon = (site?.polygon as { points?: [number, number][] } | undefined)?.points ?? []
  const lotW = polygon.length ? extent(polygon.map((p) => p[0])) : 40
  const lotH = polygon.length ? extent(polygon.map((p) => p[1])) : 40
  out.push({
    number: 'A1.0',
    title: 'Site plan',
    viewports: [
      {
        kind: 'site-plan',
        title: 'Site plan',
        scale: fitScale(lotW, lotH, FRAME.w, FRAME.h - 0.6, CIVIL_SCALES),
        x: FRAME.x,
        y: FRAME.y + 0.4,
        w: FRAME.w,
        h: FRAME.h - 0.6,
      },
    ],
  })

  // A2.x — one floor plan per level, with the level's room schedule.
  const planW = FRAME.w * 0.7
  const scheduleW = FRAME.w - planW - GAP
  const planScale = fitScale(buildingW * 1.15, buildingH * 1.15, planW, FRAME.h - 0.6, ARCH_SCALES)
  levelNodes.forEach((level, index) => {
    out.push({
      number: `A2.${index}`,
      title: `${levelLabel(level)} floor plan`,
      viewports: [
        {
          kind: 'plan',
          drawingType: 'floor-plan',
          levelId: level.id,
          title: `Floor plan — ${levelLabel(level)}`,
          scale: planScale,
          x: FRAME.x,
          y: FRAME.y + 0.4,
          w: planW,
          h: FRAME.h - 0.6,
        },
        {
          kind: 'schedule',
          scheduleOf: 'rooms',
          levelId: level.id,
          title: `Room schedule — ${levelLabel(level)}`,
          x: FRAME.x + planW + GAP,
          y: FRAME.y + 0.4,
          w: scheduleW,
          h: FRAME.h - 0.6,
        },
      ],
    })
  })

  // A4.0 — the four exterior elevations, 2 × 2.
  const cellW = (FRAME.w - GAP) / 2
  const cellH = (FRAME.h - 0.8 - GAP) / 2
  const elevationScale = fitScale(
    Math.max(buildingW, buildingH) * 1.1,
    6,
    cellW,
    cellH,
    ARCH_SCALES,
  )
  out.push({
    number: 'A4.0',
    title: 'Exterior elevations',
    viewports: (['north', 'east', 'south', 'west'] as const).map((direction, i) => ({
      kind: 'elevation' as const,
      direction,
      title: `${direction.toUpperCase()} elevation`,
      scale: elevationScale,
      x: FRAME.x + (i % 2) * (cellW + GAP),
      y: FRAME.y + 0.4 + Math.floor(i / 2) * (cellH + GAP),
      w: cellW,
      h: cellH,
    })),
  })

  // A5.0 — one section per marker, or an honest placeholder.
  const markers = Object.values(nodes).filter(
    (n) => typeof n?.type === 'string' && n.type.includes('section-marker'),
  )
  out.push({
    number: 'A5.0',
    title: 'Building sections',
    viewports:
      markers.length > 0
        ? markers.map((marker, i) => ({
            kind: 'section' as const,
            markerId: marker.id,
            title: (marker.name as string) || `Section ${i + 1}`,
            scale: elevationScale,
            x: FRAME.x,
            y: FRAME.y + 0.4 + i * ((FRAME.h - 0.6) / markers.length),
            w: FRAME.w,
            h: (FRAME.h - 0.6) / markers.length - GAP,
          }))
        : [
            {
              kind: 'notes' as const,
              title: 'Building sections',
              text: 'No section markers in this scene yet.\nPlace a section marker in the model and\nregenerate to fill this sheet.',
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w,
              h: FRAME.h - 0.6,
            },
          ],
  })

  // A8.0 — door and window schedules, one pair of columns per level.
  const columns = Math.max(1, levelNodes.length) * 2
  const colW = (FRAME.w - GAP * (columns - 1)) / columns
  const scheduleViewports: Plan['viewports'] = []
  const levelsForSchedule = levelNodes.length > 0 ? levelNodes : []
  levelsForSchedule.forEach((level, index) => {
    ;(['doors', 'windows'] as const).forEach((of, k) => {
      const slot = index * 2 + k
      scheduleViewports.push({
        kind: 'schedule',
        scheduleOf: of,
        levelId: level.id,
        title: `${of === 'doors' ? 'Door' : 'Window'} schedule — ${levelLabel(level)}`,
        x: FRAME.x + slot * (colW + GAP),
        y: FRAME.y + 0.4,
        w: colW,
        h: FRAME.h - 0.6,
      })
    })
  })
  out.push({
    number: 'A8.0',
    title: 'Door & window schedules',
    viewports:
      scheduleViewports.length > 0
        ? scheduleViewports
        : [
            {
              kind: 'notes',
              title: 'Schedules',
              text: 'No levels in this scene yet.',
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w,
              h: 2,
            },
          ],
  })

  return out
}

const GENERAL_NOTES = [
  '1. All work shall comply with the adopted building code and',
  '   local amendments of the jurisdiction shown in the title block.',
  '2. Contractor shall verify all dimensions and conditions in the',
  '   field before starting work and report discrepancies.',
  '3. Do not scale drawings. Written dimensions govern.',
  '4. Dimensions are to face of stud unless noted otherwise.',
].join('\n')

function projectDataText(nodes: NodeMap, levelCount: number): string {
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const parcel = (site?.parcel ?? {}) as Record<string, unknown>
  const lines = [`LEVELS  ${levelCount}`]
  if (typeof parcel.lotAreaSqFt === 'number') {
    lines.push(`LOT AREA  ${Math.round(parcel.lotAreaSqFt).toLocaleString()} SF`)
  }
  if (typeof parcel.apn === 'string' && parcel.apn) lines.push(`APN  ${parcel.apn}`)
  const zone = site?.zone
  if (typeof zone === 'string' && zone) lines.push(`ZONE  ${zone}`)
  lines.push('', 'Values not shown are still to be filled in.')
  return lines.join('\n')
}

function extent(values: number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

/**
 * The idempotency test, as a pure function: which planned sheets are not in
 * the scene yet. A number that already exists is left completely alone — the
 * generator never touches a sheet somebody has laid out.
 */
export function missingSheets(nodes: NodeMap): { create: Plan[]; keep: string[] } {
  const existing = new Set(sheets(nodes).map((s) => s.number))
  const create: Plan[] = []
  const keep: string[] = []
  for (const plan of planDefaultSet(nodes)) {
    if (existing.has(plan.number)) keep.push(plan.number)
    else create.push(plan)
  }
  return { create, keep }
}

/**
 * Create the missing sheets. Returns which numbers were created and which
 * were left alone — the caller reports both, so "nothing happened" is never
 * ambiguous.
 */
export function generateDefaultSet(nodes: NodeMap): GeneratedSet {
  const { create, keep } = missingSheets(nodes)
  const created: string[] = []
  const skipped: string[] = [...keep]
  let order = sheets(nodes).length

  for (const plan of create) {
    const sheet: SheetNode = addSheet({
      number: plan.number,
      title: plan.title,
      size: PAPER.size,
      order: order++,
    })
    for (const vp of plan.viewports) {
      addViewport({ layers: { ...DEFAULT_VIEWPORT_LAYERS }, ...vp, sheetId: sheet.id })
    }
    created.push(plan.number)
  }
  return { created, skipped }
}
