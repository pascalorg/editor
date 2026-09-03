/**
 * "Generate default set" — the sheets a small residential permit set always
 * has, created from what is actually in the scene.
 *
 *   A0.0  Cover            project name block, hero 3D, sheet index,
 *                          computed project data, general notes
 *   A1.0  Site plan        with a north / graphic-scale / utilities-legend block
 *   A2.x  Floor plan       one per level, with that level's room schedule
 *   A2.n  Roof plan        (n = level count, so a one-storey scene gets A2.1)
 *   A4.0  Exterior elevations   north / east / south / west
 *   A5.0  Building sections     one per marker; two default cuts when there
 *                               are none
 *   A8.0  Door & window schedules
 *   S1.0  Foundation plan
 *   E1.0  Electrical plan
 *
 * Idempotent by sheet NUMBER: a run only creates the sheets that are missing,
 * so pressing the button twice never doubles the set and never disturbs a
 * sheet somebody has already laid out.
 */
import { generateId } from '@pascal-app/core'
import {
  type AnyNodeLike,
  addSheet,
  addViewport,
  levelLabel,
  levels,
  type NodeMap,
  removeViewport,
  scene,
  sceneNodes,
  sheets,
  viewports,
} from './model'
import { collectWalls, wallBounds } from './pose'
import { fitScale, SCALE_PRESETS } from './scale'
import { DEFAULT_VIEWPORT_LAYERS, type SheetNode, type ViewportNode } from './schema'
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

  // A0.0 — cover. Composed by `cover.ts`: a display-face project name block
  // over the front-quarter hero on the left, SHEET INDEX / PROJECT DATA /
  // GENERAL NOTES stacked down the right.
  out.push({ number: 'A0.0', title: 'Cover sheet', viewports: coverViewports() })

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

  // A3.0 — roof plan. NOT A2.1: A2.x is one number per level, so a roof plan
  // parked at A2.1 collides with the second storey's floor plan the moment a
  // level is added (and the generator, being idempotent by number, would then
  // silently skip that storey). A3.0 is stable for the life of the set.
  const roofNodes = Object.values(nodes).filter(
    (n) => n?.type === 'roof' || n?.type === 'roof-segment',
  )
  out.push({
    number: 'A3.0',
    title: 'Roof plan',
    viewports:
      roofNodes.length > 0 && levelNodes[0]
        ? [
            {
              kind: 'plan',
              drawingType: 'roof-plan',
              levelId: levelNodes[0].id,
              title: 'Roof plan',
              scale: planScale,
              layers: { ...DEFAULT_VIEWPORT_LAYERS, roomLabels: false, openingMarks: false },
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w,
              h: FRAME.h - 0.6,
            },
          ]
        : [
            {
              kind: 'notes',
              title: 'Roof plan',
              text: NO_ROOF_NOTE,
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w * 0.6,
              h: 3,
            },
          ],
  })

  // S1.0 — foundation plan.
  const slabNodes = Object.values(nodes).filter((n) => n?.type === 'slab')
  out.push({
    number: 'S1.0',
    title: 'Foundation plan',
    viewports:
      slabNodes.length > 0 && levelNodes[0]
        ? [
            {
              kind: 'plan',
              drawingType: 'foundation-plan',
              levelId: levelNodes[0].id,
              title: 'Foundation plan',
              scale: planScale,
              layers: {
                ...DEFAULT_VIEWPORT_LAYERS,
                roomLabels: false,
                openingMarks: false,
                furniture: false,
              },
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w,
              h: FRAME.h - 0.6,
            },
          ]
        : [
            {
              kind: 'notes',
              title: 'Foundation plan',
              text: NO_SLAB_NOTE,
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w * 0.6,
              h: 3,
            },
          ],
  })

  // E1.0 — electrical plan. The devices and the service come from Bones
  // (`bones:device` / `bones:service`); with Bones absent the sheet says so.
  const hasBones = Object.values(nodes).some(
    (n) => typeof n?.type === 'string' && n.type.startsWith('bones:'),
  )
  out.push({
    number: 'E1.0',
    title: 'Electrical plan',
    viewports:
      hasBones && levelNodes[0]
        ? levelNodes.map((level, index) => ({
            kind: 'plan' as const,
            drawingType: 'floor-plan',
            levelId: level.id,
            title: `Electrical plan — ${levelLabel(level)}`,
            scale: planScale,
            layers: {
              ...DEFAULT_VIEWPORT_LAYERS,
              furniture: false,
              electrical: true,
              siteUtilities: true,
              openingMarks: false,
              automaticDimensions: false,
            },
            x: FRAME.x + index * (FRAME.w / Math.max(1, levelNodes.length)),
            y: FRAME.y + 0.4,
            w: FRAME.w / Math.max(1, levelNodes.length) - (levelNodes.length > 1 ? GAP : 0),
            h: FRAME.h - 0.6,
          }))
        : [
            {
              kind: 'notes',
              title: 'Electrical plan',
              text: NO_BONES_NOTE,
              x: FRAME.x,
              y: FRAME.y + 0.4,
              w: FRAME.w * 0.6,
              h: 3.5,
            },
          ],
  })

  // A5.0 — building sections. Existing markers win; otherwise two default
  // cuts through the building centre (see `defaultSectionMarkers`), so the
  // sheet is never empty on a scene nobody has placed markers in.
  const markers = Object.values(nodes).filter(
    (n) => typeof n?.type === 'string' && n.type.includes('section-marker'),
  )
  const plannedCuts: { id?: string; label: string }[] =
    markers.length > 0
      ? markers.map((m, i) => ({
          id: m.id,
          label: (m.name as string) || (m.label as string) || `Section ${i + 1}`,
        }))
      : defaultSectionMarkers(nodes).map((spec) => ({ label: `Section ${spec.label}` }))
  out.push({
    number: 'A5.0',
    title: 'Building sections',
    viewports:
      plannedCuts.length > 0
        ? plannedCuts.map((cut, i) => ({
            kind: 'section' as const,
            markerId: cut.id,
            title: cut.label,
            scale: elevationScale,
            x: FRAME.x,
            y: FRAME.y + 0.4 + i * ((FRAME.h - 0.6) / plannedCuts.length),
            w: FRAME.w,
            h: (FRAME.h - 0.6) / plannedCuts.length - GAP,
          }))
        : [
            // No walls at all: nothing to cut, and an invented cut through
            // nothing would be a lie. The section viewport prints
            // `NO_SECTION_MARKER_NOTE` until there is something to cut.
            {
              kind: 'section' as const,
              title: 'Building section',
              scale: elevationScale,
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

  // SET ORDER: the architectural story reads first, then structural, then the
  // trades — stable within a group, so a second storey stays next to the first.
  const rank = (number: string): number => {
    if (/^A0/.test(number)) return 0
    if (/^A1/.test(number)) return 1
    if (/^A2/.test(number)) return 2
    if (/^A3/.test(number)) return 2.5
    if (/^A4/.test(number)) return 3
    if (/^A5/.test(number)) return 4
    if (/^A/.test(number)) return 5
    if (/^S/.test(number)) return 6
    if (/^E/.test(number)) return 7
    return 8
  }
  return out
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => rank(a.plan.number) - rank(b.plan.number) || a.index - b.index)
    .map((entry) => entry.plan)
}

/* ------------------------------------------------------------- cover */

/**
 * The cover's column geometry, in sheet inches. Shared by the generator and
 * `regenerateCover`, so a rebuild lands exactly where a fresh generate does.
 */
export const COVER_LAYOUT = (() => {
  const gap = 0.6
  const leftW = FRAME.w * 0.56
  const rightX = FRAME.x + leftW + gap
  const rightW = FRAME.w - leftW - gap
  const titleH = 3.9
  const indexH = FRAME.h * 0.34
  const dataH = FRAME.h * 0.32
  return {
    title: { x: FRAME.x, y: FRAME.y + 0.15, w: leftW, h: titleH },
    hero: { x: FRAME.x, y: FRAME.y + titleH + 0.55, w: leftW, h: FRAME.h - titleH - 1.1 },
    index: { x: rightX, y: FRAME.y + 0.15, w: rightW, h: indexH },
    data: { x: rightX, y: FRAME.y + 0.15 + indexH + 0.4, w: rightW, h: dataH },
    notes: {
      x: rightX,
      y: FRAME.y + 0.15 + indexH + dataH + 0.8,
      w: rightW,
      h: FRAME.h - indexH - dataH - 0.95,
    },
  }
})()

/** The five viewports the cover is made of. */
export function coverViewports(): Plan['viewports'] {
  const L = COVER_LAYOUT
  return [
    { kind: 'cover', coverBlock: 'title', title: 'Project', ...L.title },
    { kind: 'view3d', pose: 'cover-front', title: 'Perspective — front quarter', ...L.hero },
    { kind: 'cover', coverBlock: 'index', title: 'Sheet index', ...L.index },
    { kind: 'cover', coverBlock: 'data', title: 'Project data', ...L.data },
    { kind: 'cover', coverBlock: 'notes', title: 'General notes', ...L.notes },
  ]
}

/**
 * Replace A0.0's viewports with the current cover composition.
 *
 * `generateDefaultSet` is idempotent by sheet NUMBER, which is what stops it
 * disturbing a sheet somebody has laid out — but it also means an existing
 * scene never sees a new cover. This is the explicit opt-in: it deletes only
 * A0.0's viewports and lays the new ones down in their place. No other sheet
 * is touched.
 */
export function regenerateCover(): { ok: boolean; reason?: string; viewports?: number } {
  const nodes = sceneNodes()
  const cover = sheets(nodes).find((sheet) => sheet.number === 'A0.0')
  if (!cover) {
    return { ok: false, reason: 'no A0.0 sheet in this set — generate the default set first' }
  }
  for (const vp of viewports(nodes, cover.id)) removeViewport(vp.id)
  const created = coverViewports()
  for (const vp of created) {
    addViewport({ layers: { ...DEFAULT_VIEWPORT_LAYERS }, ...vp, sheetId: cover.id })
  }
  return { ok: true, viewports: created.length }
}

/* ------------------------------------------------ default section cuts */

export type SectionMarkerSpec = {
  label: string
  start: [number, number]
  end: [number, number]
  lookDirection: 'left' | 'right'
  depth: number
  levelId: string | null
}

/**
 * Two default cuts through the building — one longitudinal (along the longer
 * plan dimension), one transverse — both through the centre of the wall
 * footprint, so A5.0 is never an empty sheet.
 *
 * `lookDirection` is the side carrying more wall length. Plan axes are x right
 * and z down, so screen-left of a +x cut is −z and screen-left of a +z cut is
 * +x. Depth is the half-extent perpendicular to the cut plus the margin, so
 * everything behind the cut projects.
 *
 * Returns [] when there are no walls: an invented cut through nothing is worse
 * than the honest "place a marker" note.
 */
export function defaultSectionMarkers(nodes: NodeMap): SectionMarkerSpec[] {
  const walls = collectWalls(nodes as never)
  const bounds = wallBounds(walls)
  if (!bounds) return []
  const w = bounds.maxX - bounds.minX
  const d = bounds.maxZ - bounds.minZ
  if (w <= 0.01 || d <= 0.01) return []
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const margin = Math.max(1, Math.max(w, d) * 0.12)
  const levelId = levels(nodes)[0]?.id ?? null

  const alongX: SectionMarkerSpec = {
    label: 'A',
    start: [bounds.minX - margin, cz],
    end: [bounds.maxX + margin, cz],
    lookDirection: heavierSide(walls, 1, cz) < 0 ? 'left' : 'right',
    depth: d / 2 + margin,
    levelId,
  }
  const alongZ: SectionMarkerSpec = {
    label: 'B',
    start: [cx, bounds.minZ - margin],
    end: [cx, bounds.maxZ + margin],
    lookDirection: heavierSide(walls, 0, cx) > 0 ? 'left' : 'right',
    depth: w / 2 + margin,
    levelId,
  }
  return w >= d
    ? [alongX, alongZ]
    : [
        { ...alongZ, label: 'A' },
        { ...alongX, label: 'B' },
      ]
}

/** −1 or +1: which side of `at` on the given axis carries more wall length. */
function heavierSide(
  walls: readonly { start: readonly [number, number]; end: readonly [number, number] }[],
  axis: 0 | 1,
  at: number,
): number {
  let negative = 0
  let positive = 0
  for (const wall of walls) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const mid = (wall.start[axis] + wall.end[axis]) / 2
    if (mid < at) negative += length
    else positive += length
  }
  return positive > negative ? 1 : -1
}

/**
 * Create the default section markers when the scene has none, and return every
 * marker A5.0 should get a viewport for. The kind belongs to
 * `@pascal-app/plugin-sections` (`type: 'section-marker'`); the node is built
 * from its literal shape rather than imported, so Sheets takes no hard
 * dependency on a plugin that may not be installed.
 */
export function ensureSectionMarkers(nodes: NodeMap): AnyNodeLike[] {
  const existing = Object.values(nodes).filter(
    (n): n is AnyNodeLike => typeof n?.type === 'string' && n.type.includes('section-marker'),
  )
  if (existing.length > 0) return existing
  const specs = defaultSectionMarkers(nodes)
  if (specs.length === 0) return []
  const created: AnyNodeLike[] = specs.map((spec) => ({
    object: 'node',
    id: generateId('secmk'),
    type: 'section-marker',
    name: `Section ${spec.label}`,
    parentId: spec.levelId,
    visible: true,
    metadata: { createdBy: 'sheets-default-set' },
    label: spec.label,
    levelId: spec.levelId,
    start: spec.start,
    end: spec.end,
    lookDirection: spec.lookDirection,
    depth: spec.depth,
    sheetRef: null,
  }))
  scene().applyNodeChanges({
    create: created.map((node) => ({
      node,
      parentId: (node.parentId as string | null) ?? undefined,
    })),
  })
  return created
}

export const NO_ROOF_NOTE = [
  'ROOF PLAN — NOT DRAWN',
  '',
  'This scene has no roof or roof-segment nodes, so there is no',
  'ridge, hip, eave or slope to draw. Add a roof in the 3D view,',
  'then press "Generate default set" again — or delete this note',
  'viewport and add a plan viewport with drawing type "roof-plan".',
].join('\n')

export const NO_SLAB_NOTE = [
  'FOUNDATION PLAN — NOT DRAWN',
  '',
  'This scene has no slab nodes, so there is no foundation to draw.',
  'Draw a slab under the building, then generate the set again.',
  '',
  'Footings, stem walls and reinforcement are not modelled by Pascal;',
  'this sheet shows the slab outline, bearing walls and the grid only.',
].join('\n')

export const NO_BONES_NOTE = [
  'ELECTRICAL PLAN — NO DEVICES IN THIS SCENE',
  '',
  'Receptacles, switches, fixtures and the service panel are Bones',
  'kinds (bones:device, bones:service). None are in this scene.',
  '',
  'To add them: open the Bones panel (the rail’s plugin list — Bones is',
  'installed but not shown by default; enable it there), run the',
  'electrical engine for the level, then generate the set again.',
].join('\n')

const GENERAL_NOTES = [
  '1. All work shall comply with the adopted building code and',
  '   local amendments of the jurisdiction shown in the title block.',
  '2. Contractor shall verify all dimensions and conditions in the',
  '   field before starting work and report discrepancies.',
  '3. Do not scale drawings. Written dimensions govern.',
  '4. Dimensions are to face of stud unless noted otherwise.',
].join('\n')

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
  // Default section cuts must exist BEFORE the set is planned, so A5.0's
  // viewports can carry their marker ids rather than an empty placeholder.
  ensureSectionMarkers(nodes)
  const planningNodes = sceneNodes()
  const { create, keep } = missingSheets(planningNodes)
  const created: string[] = []
  const skipped: string[] = [...keep]
  let order = sheets(planningNodes).length

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
