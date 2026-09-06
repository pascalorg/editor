/**
 * Turning one viewport into marks on paper.
 *
 * A viewport resolves to one of two things:
 *  - a LIVE WINDOW: `FloorplanGeometry` in world (plan) metres plus the world
 *    rectangle the viewport frames. The screen mounts it in a nested `<svg>`
 *    with that viewBox; the PDF hands the same tree to the pdfkit renderer
 *    with the same viewBox. One geometry, two back ends.
 *  - a PLATE: geometry already in sheet inches (tables, notes, placeholders).
 *
 * Cross-workstream drawings (WS1's site plan, WS6's sections and elevations)
 * arrive through `registerSheetDrawingProvider`. Until a workstream lands,
 * its viewports draw an honest "pending" note rather than silently nothing.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import {
  type Bounds,
  boundsSize,
  geometryListBounds,
  isEmpty,
  padBounds,
  rotateBounds,
  unionBounds,
} from './bounds'
import { buildCoverBlock, type CoverBlock } from './cover'
import { drawTable, SCHEDULE_LEGEND } from './draw-table'
import type { AnyNodeLike, NodeMap } from './model'
import { levelLabel, sheets } from './model'
import { fireSeparationMarks } from './notes/fire-separation'
import { codeTagOf, resolveState, retagCode } from './notes/jurisdiction'
import { scaleLabel, sheetInchesToWorld, worldToSheetInches } from './scale'
import { adaptSchedule, buildSchedule, type ScheduleTable } from './schedule'
import { enrichOpeningSchedule } from './schedule-openings'
import type { ViewportLayers, ViewportNode } from './schema'
import { INK, INK_SOFT, MONO, SANS } from './titleblock'

/* ------------------------------------------------- provider registry */

export type DrawingResult = {
  /** World-metre drawing for the live window. Empty when the result is plate-only. */
  primitives: FloorplanGeometry[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /**
   * Paper geometry in ABSOLUTE sheet inches (tables, legends, notes, keys),
   * drawn over the live window. `args.viewport` carries the box to lay it
   * out in. A provider may return ONLY a plate (leave `primitives` empty).
   */
  plate?: FloorplanGeometry[]
  /** Everything the provider could not compute exactly — printed, never silent. */
  warnings?: string[]
  /** The plate carries its own heading; suppress the numbered label strip. */
  noLabel?: boolean
  /** Override the caption in the label strip. */
  title?: string
}

/** What every provider is handed besides the node map. */
export type ProviderArgs = {
  levelId?: string
  markerId?: string
  direction?: 'north' | 'east' | 'south' | 'west'
  layers: ViewportLayers
  /** `ViewportNode.system` — structural family / MEP sub-plan. */
  system?: string
  /** `ViewportNode.notesKey` — which discipline's notes. */
  notesKey?: string
  /** The viewport box in absolute sheet inches, and its drawing scale (world:paper). */
  viewport: { x: number; y: number; w: number; h: number; scale: number }
}
export type DrawingProvider = (
  nodes: NodeMap,
  args: Record<string, unknown>,
) => DrawingResult | null

const providers = new Map<string, DrawingProvider>()

/**
 * Register a `build<X>Drawing` from another workstream. Called once at
 * bootstrap — e.g. `registerSheetDrawingProvider('section', buildSectionDrawing)`.
 */
export function registerSheetDrawingProvider(key: string, provider: DrawingProvider): void {
  providers.set(key, provider)
}

function provider(key: string): DrawingProvider | undefined {
  const registered = providers.get(key)
  if (registered) return registered
  const bag = editor as unknown as Record<string, unknown>
  if (key === 'site-plan') {
    // WS1's builder takes the whole scene snapshot, not (nodes, args).
    const build = bag.buildSitePlanDrawing
    if (typeof build !== 'function') return undefined
    return () =>
      (build as (scene: unknown) => DrawingResult)(
        (useScene as unknown as { getState: () => unknown }).getState(),
      )
  }
  // WS6's section / elevation builders land through
  // `registerSheetDrawingProvider`; if they are ever re-exported from the
  // editor package under these names, pick them up automatically too.
  const exportName = key === 'section' ? 'buildSectionDrawing' : 'buildElevationDrawing'
  const candidate = bag[exportName]
  return typeof candidate === 'function' ? (candidate as DrawingProvider) : undefined
}

/* ---------------------------------------------------------- layers */

/** The viewport's layer switches, as the annotation-visibility record. */
export function annotationVisibility(layers: ViewportLayers) {
  return {
    automaticDimensions: layers.automaticDimensions,
    contextualDimensions: layers.contextualDimensions,
    manualDimensions: layers.manualDimensions,
    measurements: layers.measurements,
    openingMarks: layers.openingMarks,
    structuralGrids: layers.structuralGrids,
    roomLabels: layers.roomLabels,
    stairAnnotations: layers.stairAnnotations,
  }
}

/**
 * Dimension primitives are ANNOTATIONS, not model geometry.
 *
 * The distinction is not cosmetic. `FloorplanDimensionRenderer` sizes ticks
 * and label either in WORLD metres (0.15 m text) or in PAPER points (8 pt),
 * depending on whether it is handed an `annotationUnitsPerPoint`. A plan at
 * 1/4" = 1'-0" happens to make 0.15 m read as ~0.12 in of paper, so world
 * sizing looks right there — but a site plan at 1" = 20' is five times
 * coarser and the same text lands under 2 pt. That is why WS1's four yard
 * dimension strings were on the sheet all along and still invisible.
 *
 * So a provided drawing is split: dimensions go to the ANNOTATION channel,
 * which `paper.tsx` and `sheet-export.ts` both render in paper points.
 */
const DIMENSION_KINDS = new Set(['dimension', 'dimension-string', 'dimension-label'])

function dimensionLayerFor(geometry: FloorplanGeometry, layers: ViewportLayers): boolean {
  const role = (geometry as { metadata?: { annotationRole?: unknown } }).metadata?.annotationRole
  if (role === 'manual-dimension' || role === 'construction-dimension') {
    return layers.manualDimensions
  }
  if (role === 'contextual-dimension') return layers.contextualDimensions
  return layers.automaticDimensions
}

/**
 * Split a provided drawing's primitives into the model channel and the
 * annotation channel, dropping dimensions whose layer switch is off.
 *
 * Untransformed groups are descended into so a provider may nest freely; a
 * group carrying a `transform` stays whole in the model channel, because
 * lifting a child out of it would lose that transform.
 */
export function splitProvidedGeometry(
  primitives: readonly FloorplanGeometry[],
  layers: ViewportLayers,
): { model: FloorplanGeometry[]; annotations: FloorplanGeometry[] } {
  const model: FloorplanGeometry[] = []
  const annotations: FloorplanGeometry[] = []
  const walk = (list: readonly FloorplanGeometry[]) => {
    for (const geometry of list) {
      if (geometry.kind === 'group' && !geometry.transform) {
        walk(geometry.children)
        continue
      }
      if (!DIMENSION_KINDS.has(geometry.kind)) {
        model.push(geometry)
        continue
      }
      if (dimensionLayerFor(geometry, layers)) annotations.push(geometry)
    }
  }
  walk(primitives)
  return { model, annotations }
}

const FURNITURE_TYPES = new Set(['item', 'shelf', 'cabinet', 'cabinet-module'])
const MEP_TYPES = new Set([
  'duct-segment',
  'duct-fitting',
  'duct-terminal',
  'hvac-equipment',
  'lineset',
  'liquid-line',
  'pipe-segment',
  'pipe-fitting',
  'pipe-trap',
])

/** Bones kinds that belong to the ELECTRICAL layer, not the framing layer. */
const BONES_ELECTRICAL = new Set(['bones:device', 'bones:service'])

/**
 * The kinds a ROOF PLAN shows. `resolveNodeForDrawingType`
 * (`packages/editor/src/lib/floorplan/drawing-coordination.ts`) only ever
 * consults `def.extensions['pascal:editor/floorplan'].resolveForDrawing`, and
 * the ONLY kind in the tree that implements it is `construction-dimension` —
 * so `drawingType: 'roof-plan'` on its own would draw a floor plan with the
 * roof linework on top of it. The filter is therefore ours to apply: a roof
 * plan is the roof, its penetrations and its drainage, and nothing else.
 */
const ROOF_PLAN_TYPES = new Set([
  'roof',
  'roof-segment',
  'skylight',
  'chimney',
  'dormer',
  'cupola',
  'gutter',
  'downspout',
  'ridge-vent',
  'box-vent',
  'eyebrow-vent',
  'turbine-vent',
  'solar-panel',
  'lean-to-extension',
  'construction-dimension',
  'structural-grid',
  'measurement',
])

/** The kinds a FOUNDATION PLAN shows — the slab, what bears on it, the grid. */
const FOUNDATION_PLAN_TYPES = new Set([
  'slab',
  'wall',
  'column',
  'stair',
  'stair-segment',
  'construction-dimension',
  'structural-grid',
  'measurement',
])

/**
 * The kinds a FLOOR PLAN does not show: the roof and what rides on it live on
 * the roof plan (A3.0). The roof kind draws its ridges, drip edge and pitch
 * arrows as one group, so it is all-or-nothing per drawing type.
 */
const FLOOR_PLAN_EXCLUDED_TYPES = new Set([
  'roof',
  'roof-segment',
  'gutter',
  'downspout',
  'ridge-vent',
  'box-vent',
  'eyebrow-vent',
  'turbine-vent',
  'solar-panel',
])

/** Whether a node type is drawn under this viewport's layer switches. */
export function acceptsNode(layers: ViewportLayers, type: string, category?: string): boolean {
  if (FURNITURE_TYPES.has(type)) return layers.furniture
  if (MEP_TYPES.has(type)) return layers.mep
  if (BONES_ELECTRICAL.has(type)) return layers.electrical
  if (type.startsWith('bones:')) return layers.framing
  if (type.startsWith('utilities:')) return layers.siteUtilities
  if (type === 'terrain' || type === 'scan') return layers.terrain
  if (category === 'analysis') return false
  return true
}

/**
 * The layer switches, narrowed by what the drawing type is ABOUT. A roof plan
 * that also drew every wall and door would just be a floor plan with ridges on
 * it — which is exactly what `drawingType` alone produces today.
 */
export function acceptsNodeForDrawing(
  layers: ViewportLayers,
  type: string,
  category: string | undefined,
  drawingType: string | undefined,
): boolean {
  if (drawingType === 'roof-plan' && !ROOF_PLAN_TYPES.has(type)) return false
  if (drawingType === 'foundation-plan' && !FOUNDATION_PLAN_TYPES.has(type)) return false
  if ((drawingType ?? 'floor-plan') === 'floor-plan' && FLOOR_PLAN_EXCLUDED_TYPES.has(type)) {
    return false
  }
  return acceptsNode(layers, type, category)
}

/* ------------------------------------------------------- resolution */

export type LiveWindow = {
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
  /** The world rectangle the viewport frames, in ROTATED plan metres. */
  view: { x: number; y: number; width: number; height: number }
  rotationDeg: number
}

export type DrawnViewport = {
  /** Geometry already in sheet inches, relative to the paper origin. */
  plate: FloorplanGeometry[]
  live: LiveWindow | null
  /** A caption for the viewport label strip. */
  title: string
  /** The scale actually drawn (a fitted viewport may not use `viewport.scale`). */
  scale: number | undefined
  /**
   * Cover blocks and other composed plates carry their own headings; the
   * numbered viewport label strip would only repeat them.
   */
  noLabel?: boolean
  /**
   * Plans only: where true north points ON THE PAPER, degrees clockwise from
   * up. Drawn as the north arrow beside the viewport title.
   */
  northDeg?: number
}

/**
 * A dashed placeholder box with plain words in it. `message` may carry
 * newlines; the lines are centred as a block so a real explanation fits
 * instead of running off the edge of the paper.
 */
function note(vp: ViewportNode, message: string): FloorplanGeometry[] {
  const lines = message.split('\n')
  const lineHeight = 0.24
  const top = vp.y + vp.h / 2 - ((lines.length - 1) * lineHeight) / 2
  return [
    {
      kind: 'rect',
      x: vp.x,
      y: vp.y,
      width: vp.w,
      height: vp.h,
      fill: 'none',
      stroke: INK_SOFT,
      strokeWidth: 0.008,
      strokeDasharray: '0.08 0.06',
    },
    ...lines.map<FloorplanGeometry>((line, i) => ({
      kind: 'text',
      x: vp.x + vp.w / 2,
      y: top + i * lineHeight,
      text: line,
      fontSize: 0.16,
      fill: INK_SOFT,
      textAnchor: 'middle',
      fontFamily: 'Helvetica, Arial, sans-serif',
    })),
  ]
}

/**
 * What a section sheet says when the scene has no section markers. Named
 * because both the sheet and the rail quote the same route.
 */
export const NO_SECTION_MARKER_NOTE = [
  'No section markers in this scene yet.',
  '',
  'Place a section marker in the 2D plan:',
  'Sections panel → Section marker tool.',
  '',
  'Then use Sections in the Sheets rail to add a viewport for it.',
].join('\n')

function textBlock(vp: ViewportNode, body: string): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const lineHeight = 0.2
  const lines = body.split('\n')
  lines.forEach((l, i) => {
    if (i * lineHeight > vp.h) return
    out.push({
      kind: 'text',
      x: vp.x,
      y: vp.y + 0.16 + i * lineHeight,
      text: l,
      fontSize: 0.13,
      fill: INK,
      fontFamily: 'Helvetica, Arial, sans-serif',
    })
  })
  return out
}

/**
 * Fit a world drawing into the viewport box. The viewport's `scale` is
 * honoured; the window is centred on the drawing (or on the viewport's crop
 * when one is set).
 */
export function windowFor(
  vp: ViewportNode,
  drawingBounds: Bounds,
  rotationDeg: number,
): LiveWindow['view'] {
  const rotated = isEmpty(drawingBounds) ? drawingBounds : rotateBounds(drawingBounds, rotationDeg)
  const width = sheetInchesToWorld(vp.w, vp.scale)
  const height = sheetInchesToWorld(vp.h, vp.scale)
  const centre = isEmpty(rotated)
    ? { x: 0, y: 0 }
    : { x: (rotated.minX + rotated.maxX) / 2, y: (rotated.minY + rotated.maxY) / 2 }
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height }
}

export type ResolveContext = {
  nodes: NodeMap
  /** Data URLs captured for view3d viewports this session, keyed by viewport id. */
  captures?: Record<string, string>
  /**
   * Why a view3d viewport has no image, keyed by viewport id. A blank box
   * tells the reader nothing; the reason is printed on the paper instead.
   */
  captureNotes?: Record<string, string>
}

/** Break a sentence into lines of at most `max` characters, on word breaks. */
export function wrapWords(text: string, max = 46): string {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > max) {
        out.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

export function resolveViewport(vp: ViewportNode, ctx: ResolveContext): DrawnViewport {
  const { nodes } = ctx
  switch (vp.kind) {
    case 'plan':
      return resolvePlan(vp, nodes)
    case 'site-plan':
    case 'section':
    case 'elevation':
    case 'structural':
    case 'electrical':
    case 'plumbing':
    case 'energy':
    case 'general-notes':
      return resolveProvided(vp, nodes)
    case 'schedule':
      return resolveSchedule(vp, nodes)
    case 'cover':
      return {
        plate: buildCoverBlock({
          block: (vp.coverBlock ?? 'title') as CoverBlock,
          nodes,
          x: vp.x,
          y: vp.y,
          w: vp.w,
          h: vp.h,
          index: sheets(nodes).map((s) => ({ number: s.number, title: s.title })),
        }),
        live: null,
        title: vp.title || 'Cover',
        scale: undefined,
        noLabel: true,
      }
    case 'notes':
      return {
        plate: textBlock(vp, vp.text || 'General notes'),
        live: null,
        title: vp.title || 'General notes',
        scale: undefined,
      }
    case 'image':
    case 'view3d': {
      const url = ctx.captures?.[vp.id] || vp.dataUrl
      if (!url) {
        const reason = ctx.captureNotes?.[vp.id]
        const message =
          vp.kind !== 'view3d'
            ? 'No image placed in this viewport yet.'
            : reason
              ? wrapWords(`This view could not be captured. ${reason}`)
              : wrapWords(
                  'Capturing the standard three-quarter view… if this stays here, ' +
                    'the 3D viewer is not running behind the Sheets workspace — open the ' +
                    'model once, then press Recapture in the Layers tab.',
                )
        return {
          plate: note(vp, message),
          live: null,
          title: vp.title || (vp.kind === 'view3d' ? 'Perspective' : 'Image'),
          scale: undefined,
        }
      }
      return {
        plate: [
          {
            kind: 'image',
            url,
            center: [vp.x + vp.w / 2, vp.y + vp.h / 2],
            width: vp.w,
            height: vp.h,
            preserveAspectRatio: 'xMidYMid meet',
          },
        ],
        live: null,
        title: vp.title || (vp.kind === 'view3d' ? 'Perspective' : 'Image'),
        scale: undefined,
      }
    }
    default:
      return {
        plate: note(vp, 'unsupported viewport'),
        live: null,
        title: vp.title,
        scale: undefined,
      }
  }
}

function resolvePlan(vp: ViewportNode, nodes: NodeMap): DrawnViewport {
  const levelId = vp.levelId ?? firstLevelId(nodes)
  const level = levelId ? nodes[levelId] : undefined
  const title = vp.title || `${drawingLabel(vp.drawingType)} — ${levelLabel(level)}`
  if (!levelId) {
    return { plate: note(vp, 'no level in this scene'), live: null, title, scale: vp.scale }
  }
  const entries = editor.collectSheetGeometry({
    nodes: nodes as never,
    levelId: levelId as never,
    drawingType: (vp.drawingType ?? 'floor-plan') as never,
    annotationVisibility: annotationVisibility(vp.layers),
    accept: (node, category) =>
      acceptsNodeForDrawing(vp.layers, node.type, category, vp.drawingType),
  })
  const model = combine(entries.map((e) => e.model))
  const rotationDeg = editor.resolveSheetRotationDeg(nodes as never, levelId as never)
  // the walls Table R302.1(1) rates carry their mark on the floor plan
  const marks =
    (vp.drawingType ?? 'floor-plan') === 'floor-plan' ? fireSeparationMarks(nodes, levelId, rotationDeg) : []
  const annotations = combine([
    ...entries.map((e) => e.annotations),
    ...(marks.length > 0 ? [{ kind: 'group', children: marks } as FloorplanGeometry] : []),
  ])
  if (!model && !annotations) {
    return { plate: note(vp, 'nothing on this level to draw'), live: null, title, scale: vp.scale }
  }
  const bounds = vp.crop
    ? vp.crop
    : padBounds(unionBounds(geometryListBounds([model]), geometryListBounds([annotations])), 0.4)
  return {
    plate: [],
    live: { model, annotations, view: windowFor(vp, bounds, rotationDeg), rotationDeg },
    title,
    scale: vp.scale,
    northDeg: northOnPaperDeg(nodes, rotationDeg),
  }
}

/**
 * True north on the paper for a plan window: plan "up" (−z) is the level's
 * north when the site carries no rotation; the site's `northRotation`
 * (radians, clockwise from plan up) and the sheet's own plan rotation both
 * turn it. Also accounts for the building's yaw, which rotates the level frame
 * on the lot.
 */
function northOnPaperDeg(nodes: NodeMap, sheetRotationDeg: number): number {
  const north = northRotationOf(nodes)
  const building = Object.values(nodes).find((n) => n?.type === 'building')
  const yaw = Array.isArray(building?.rotation) ? Number(building.rotation[1] ?? 0) : 0
  const degrees = (north * 180) / Math.PI - (yaw * 180) / Math.PI + sheetRotationDeg
  return ((degrees % 360) + 360) % 360
}

const PROVIDED_TITLES: Record<string, string> = {
  'site-plan': 'Site plan',
  section: 'Building section',
  structural: 'Structural plan',
  electrical: 'Electrical plan',
  plumbing: 'Plumbing plan',
  energy: 'Energy compliance',
  'general-notes': 'General notes',
}

function resolveProvided(vp: ViewportNode, nodes: NodeMap): DrawnViewport {
  const build = provider(vp.kind)
  const title =
    vp.title ||
    (vp.kind === 'elevation'
      ? `${(vp.direction ?? 'north').toUpperCase()} elevation`
      : (PROVIDED_TITLES[vp.kind] ?? vp.kind))
  // A section viewport with nothing to cut is the ordinary state of a fresh
  // scene, not a failure. Say how to fix it rather than "pending".
  if (vp.kind === 'section' && !vp.markerId && sectionMarkers(nodes).length === 0) {
    return { plate: note(vp, NO_SECTION_MARKER_NOTE), live: null, title, scale: vp.scale }
  }
  if (!build) {
    const pending = vp.kind === 'site-plan' ? 'site plan — pending' : `${vp.kind} — pending`
    return { plate: note(vp, pending), live: null, title, scale: vp.scale }
  }
  let result: DrawingResult | null = null
  try {
    const args: ProviderArgs = {
      levelId: vp.levelId ?? firstLevelId(nodes),
      markerId: vp.markerId,
      direction: vp.direction,
      layers: vp.layers,
      system: vp.system,
      notesKey: vp.notesKey,
      viewport: { x: vp.x, y: vp.y, w: vp.w, h: vp.h, scale: vp.scale },
    }
    result = build(nodes, args as unknown as Record<string, unknown>)
  } catch (error) {
    return {
      plate: note(vp, `${vp.kind} failed: ${(error as Error).message ?? 'error'}`),
      live: null,
      title,
      scale: vp.scale,
    }
  }
  if (result) result = retagResult(result, nodes)
  const plate = result?.plate ?? []
  const warningPlate = warningsPlate(vp, result?.warnings ?? [])
  const resolvedTitle = result?.title || title
  if (!result || (result.primitives.length === 0 && plate.length === 0)) {
    return { plate: note(vp, `${vp.kind} — nothing to draw`), live: null, title, scale: vp.scale }
  }
  if (result.primitives.length === 0) {
    // Plate-only viewport: a table, a notes block, a key. No scale applies.
    return {
      plate: [...plate, ...warningPlate],
      live: null,
      title: resolvedTitle,
      scale: undefined,
      noLabel: result.noLabel,
    }
  }
  const split = splitProvidedGeometry(result.primitives, vp.layers)
  const cornerPlate =
    vp.kind === 'site-plan' && vp.layers.siteUtilities
      ? siteCornerBlocks(vp, nodes, northRotationOf(nodes))
      : vp.kind === 'site-plan'
        ? siteCornerBlocks(vp, {}, northRotationOf(nodes))
        : []
  return {
    plate: [...cornerPlate, ...plate, ...warningPlate],
    live: {
      model: combine(split.model.length > 0 ? [{ kind: 'group', children: split.model }] : []),
      annotations: combine(
        split.annotations.length > 0 ? [{ kind: 'group', children: split.annotations }] : [],
      ),
      view: windowFor(vp, padBounds(result.bounds, 0.4), 0),
      rotationDeg: 0,
    },
    title: resolvedTitle,
    scale: vp.scale,
    noLabel: result.noLabel,
    northDeg:
      vp.kind === 'site-plan' || vp.kind === 'structural' || vp.kind === 'electrical' || vp.kind === 'plumbing'
        ? northOnPaperDeg(nodes, 0)
        : undefined,
  }
}

/**
 * Provider warnings, printed small in the viewport's bottom-left corner. A
 * drawing that could not be computed exactly says so on the paper itself.
 */
function warningsPlate(vp: ViewportNode, warnings: string[]): FloorplanGeometry[] {
  if (warnings.length === 0) return []
  const lineHeight = 0.13
  const shown = warnings.slice(0, 6)
  return shown.map<FloorplanGeometry>((text, i) => ({
    kind: 'text',
    x: vp.x + 0.08,
    y: vp.y + vp.h - 0.08 - (shown.length - 1 - i) * lineHeight,
    text: `\u26a0 ${text}`.slice(0, 160),
    fontSize: 0.09,
    fill: '#b45309',
    fontFamily: 'Helvetica, Arial, sans-serif',
  }))
}

/**
 * The jurisdiction's code name on every citation a provider printed: the
 * providers write "IRC R403.1.6" (the base code's numbering, which every
 * IRC adoption keeps), and a Florida set reads "FBC-R R403.1.6", a
 * California set "CRC R403.1.6" (`retagCode`). Text primitives and the
 * `text` of anything nested in a group are walked; nothing else changes.
 */
const TAG_CACHE = new WeakMap<object, string>()
function codeTagFor(nodes: NodeMap): string {
  const hit = TAG_CACHE.get(nodes as object)
  if (hit) return hit
  const state = resolveState(nodes)
  // resolved = the adoption table knows the state; the tag map is keyed the same way
  const tag = codeTagOf(state, Boolean(state))
  TAG_CACHE.set(nodes as object, tag)
  return tag
}

function retagGeometry(g: FloorplanGeometry, tag: string): FloorplanGeometry {
  const rec = g as unknown as { text?: unknown; children?: unknown[] }
  let out = g
  if (typeof rec.text === 'string' && rec.text.includes('IRC')) {
    out = { ...(g as object), text: retagCode(rec.text, tag) } as FloorplanGeometry
  }
  if (Array.isArray(rec.children)) {
    const children = (rec.children as FloorplanGeometry[]).map((c) => retagGeometry(c, tag))
    out = { ...(out as object), children } as FloorplanGeometry
  }
  return out
}

export function retagResult(result: DrawingResult, nodes: NodeMap): DrawingResult {
  const tag = codeTagFor(nodes)
  if (tag === 'IRC') return result
  return {
    ...result,
    primitives: result.primitives.map((g) => retagGeometry(g, tag)),
    plate: result.plate?.map((g) => retagGeometry(g, tag)),
    warnings: result.warnings?.map((w) => retagCode(w, tag)),
  }
}

/** A dashed placeholder box with a message — for providers that have nothing to draw yet. */
export function viewportNote(
  box: { x: number; y: number; w: number; h: number },
  message: string,
): FloorplanGeometry[] {
  return note(box as ViewportNode, message)
}

/* ------------------------------------------- site-plan corner blocks */

/**
 * The utility kinds a site plan can carry (WS4's `plugin-utilities`), with the
 * swatch each one is drawn with. A legend entry is only printed for a kind
 * that is ACTUALLY in the scene — a legend listing symbols that are not on the
 * drawing is worse than no legend.
 */
export const SITE_UTILITY_LEGEND: { type: string; label: string; dash?: string; color: string }[] =
  [
    { type: 'utilities:water-line', label: 'WATER SERVICE', dash: '0.10 0.05', color: '#2563eb' },
    { type: 'utilities:sewer-line', label: 'SANITARY SEWER', dash: '0.16 0.06', color: '#65a30d' },
    {
      type: 'utilities:gas-line',
      label: 'GAS SERVICE',
      dash: '0.14 0.05 0.03 0.05',
      color: '#ca8a04',
    },
    {
      type: 'utilities:electric-line',
      label: 'ELECTRIC SERVICE',
      dash: '0.12 0.06',
      color: '#dc2626',
    },
    { type: 'utilities:storm-line', label: 'STORM DRAIN', dash: '0.20 0.06', color: '#0891b2' },
    { type: 'utilities:utility-line', label: 'UTILITY RUN', dash: '0.12 0.06', color: '#7c3aed' },
    { type: 'utilities:utility-pole', label: 'UTILITY POLE', color: '#7c3aed' },
    { type: 'utilities:service-point', label: 'SERVICE POINT', color: '#7c3aed' },
  ]

/**
 * A north arrow + graphic scale bar + utilities legend, in SHEET INCHES, in
 * the bottom-left corner of a site-plan viewport.
 *
 * A graphic scale bar is the one thing on a site plan that survives being
 * photocopied at the counter, which is why it is drawn here rather than left
 * to the numeric scale in the title block. The bar length is chosen as a round
 * number of feet that is at most 2.4 in of paper at the viewport's scale.
 */
export function siteCornerBlocks(
  vp: ViewportNode,
  nodes: NodeMap,
  northRotation: number,
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const pad = 0.22
  const legend = SITE_UTILITY_LEGEND.filter((entry) =>
    Object.values(nodes).some((n) => n?.type === entry.type),
  )
  const legendH = legend.length > 0 ? 0.34 + legend.length * 0.22 : 0
  const boxW = Math.min(3.2, vp.w * 0.34)
  const boxH = 1.42 + legendH
  const x = vp.x + pad
  const y = vp.y + vp.h - pad - boxH

  out.push({
    kind: 'rect',
    x,
    y,
    width: boxW,
    height: boxH,
    fill: '#ffffff',
    stroke: INK,
    strokeWidth: 0.014,
  })

  // North arrow: a filled needle, rotated by the site's north rotation.
  const nx = x + 0.42
  const ny = y + 0.62
  const r = 0.34
  out.push({
    kind: 'group',
    transform: { translate: [nx, ny], rotate: northRotation },
    children: [
      {
        kind: 'polygon',
        points: [
          [0, -r],
          [r * 0.42, r * 0.55],
          [0, r * 0.24],
          [-r * 0.42, r * 0.55],
        ],
        fill: INK,
        stroke: INK,
        strokeWidth: 0.008,
      },
    ],
  })
  out.push({
    kind: 'text',
    x: nx,
    y: y + 1.16,
    text: 'N',
    fontSize: 0.2,
    fill: INK,
    fontWeight: 800,
    fontFamily: SANS,
    textAnchor: 'middle',
  })

  // Graphic scale bar.
  const barX = x + 0.94
  const barY = y + 0.66
  const barMax = boxW - 1.16
  const feet = chooseBarFeet(vp.scale, barMax)
  const barW = worldToSheetInches(feet * 0.3048, vp.scale)
  const half = barW / 2
  out.push({ kind: 'rect', x: barX, y: barY, width: half, height: 0.11, fill: INK, stroke: 'none' })
  out.push({
    kind: 'rect',
    x: barX + half,
    y: barY,
    width: half,
    height: 0.11,
    fill: '#ffffff',
    stroke: INK,
    strokeWidth: 0.008,
  })
  out.push({
    kind: 'rect',
    x: barX,
    y: barY,
    width: barW,
    height: 0.11,
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.008,
  })
  for (const [i, label] of ['0', `${feet / 2}`, `${feet}`].entries()) {
    out.push({
      kind: 'text',
      x: barX + (barW * i) / 2,
      y: barY - 0.06,
      text: label,
      fontSize: 0.12,
      fill: INK,
      fontFamily: MONO,
      fontWeight: 600,
      textAnchor: 'middle',
    })
  }
  out.push({
    kind: 'text',
    x: barX,
    y: barY + 0.32,
    text: `FEET   ${scaleLabel(vp.scale)}`,
    fontSize: 0.12,
    fill: INK_SOFT,
    fontFamily: MONO,
    fontWeight: 600,
  })

  if (legend.length > 0) {
    let ly = y + 1.34
    out.push({
      kind: 'text',
      x: x + 0.18,
      y: ly,
      text: 'UTILITIES LEGEND',
      fontSize: 0.135,
      fill: INK,
      fontWeight: 800,
      fontFamily: SANS,
    })
    out.push({
      kind: 'line',
      x1: x + 0.18,
      y1: ly + 0.07,
      x2: x + boxW - 0.18,
      y2: ly + 0.07,
      stroke: INK,
      strokeWidth: 0.012,
    })
    ly += 0.28
    for (const entry of legend) {
      if (entry.dash) {
        out.push({
          kind: 'line',
          x1: x + 0.18,
          y1: ly - 0.05,
          x2: x + 0.74,
          y2: ly - 0.05,
          stroke: entry.color,
          strokeWidth: 0.022,
          strokeDasharray: entry.dash,
        })
      } else {
        out.push({
          kind: 'circle',
          cx: x + 0.46,
          cy: ly - 0.05,
          r: 0.075,
          fill: '#ffffff',
          stroke: entry.color,
          strokeWidth: 0.022,
        })
      }
      out.push({
        kind: 'text',
        x: x + 0.86,
        y: ly,
        text: entry.label,
        fontSize: 0.115,
        fill: INK,
        fontFamily: SANS,
        fontWeight: 600,
      })
      ly += 0.22
    }
  }
  return out
}

/** The largest round number of feet whose bar still fits `maxIn` of paper. */
export function chooseBarFeet(scale: number, maxIn: number): number {
  const steps = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400]
  let best = steps[0] as number
  for (const feet of steps) {
    if (worldToSheetInches(feet * 0.3048, scale) <= maxIn) best = feet
  }
  return best
}

/**
 * Section markers anywhere in the scene. WS6 owns the kind; match on the
 * name so this package does not have to depend on a package that may not be
 * installed yet.
 */
export function sectionMarkers(nodes: NodeMap): AnyNodeLike[] {
  return Object.values(nodes).filter(
    (n): n is AnyNodeLike => typeof n?.type === 'string' && n.type.includes('section-marker'),
  )
}

/**
 * Doors and windows publish their own schedule through the registry, and the
 * marks in it are the ones the plan's bubbles print. Use that when it is
 * there; fall back to this package's own deterministic numbering when the
 * kind contributes nothing (and always, for rooms).
 */
function hostSchedule(
  nodes: NodeMap,
  levelId: string,
  of: 'doors' | 'windows',
): ScheduleTable | null {
  try {
    const tables = editor.collectFloorplanSchedules(nodes as never, levelId as never, 'imperial')
    const wanted = of === 'doors' ? 'doors' : 'windows'
    const match = tables.find(
      (t) => t.id === wanted || t.title.toLowerCase().startsWith(of.slice(0, -1)),
    )
    return match ? adaptSchedule(match) : null
  } catch {
    return null
  }
}

function resolveSchedule(vp: ViewportNode, nodes: NodeMap): DrawnViewport {
  const levelId = vp.levelId ?? firstLevelId(nodes)
  const of = vp.scheduleOf ?? 'doors'
  if (!levelId) {
    return {
      plate: note(vp, 'no level'),
      live: null,
      title: vp.title || 'Schedule',
      scale: undefined,
    }
  }
  const base =
    (of === 'doors' || of === 'windows' ? hostSchedule(nodes, levelId, of) : null) ??
    buildSchedule(nodes as never, levelId, of)
  // QTY / EGRESS / TEMPERED / STATUS, derived from the model (schedule-openings.ts).
  const table =
    of === 'doors' || of === 'windows'
      ? enrichOpeningSchedule(base, nodes as never, levelId, of)
      : base
  const title = vp.title || table.title
  if (table.rows.length === 0) {
    return {
      plate: note(vp, `${title.toLowerCase()} — nothing scheduled`),
      live: null,
      title,
      scale: undefined,
    }
  }
  // The table draws its own title and legend, so the numbered viewport label
  // strip is suppressed rather than printing the same words twice.
  return {
    plate: drawTable(table, vp.x, vp.y, vp.w, vp.h, {
      title,
      legend: of === 'rooms' ? 'Areas are to the inside face of finish.' : SCHEDULE_LEGEND,
    }),
    live: null,
    title,
    scale: undefined,
    noLabel: true,
  }
}

/** The site node's north rotation in radians; 0 when there is no site node. */
function northRotationOf(nodes: NodeMap): number {
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const value = site?.northRotation
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function firstLevelId(nodes: NodeMap): string | undefined {
  const levels = Object.values(nodes).filter((n): n is AnyNodeLike => n?.type === 'level')
  levels.sort((a, b) => ((a.level as number) ?? 0) - ((b.level as number) ?? 0))
  return levels[0]?.id
}

export function drawingLabel(drawingType: string | undefined): string {
  switch (drawingType) {
    case 'foundation-plan':
      return 'Foundation plan'
    case 'reflected-ceiling-plan':
      return 'Reflected ceiling plan'
    case 'roof-plan':
      return 'Roof plan'
    case 'site-plan':
      return 'Site plan'
    default:
      return 'Floor plan'
  }
}

function combine(list: readonly (FloorplanGeometry | null)[]): FloorplanGeometry | null {
  const children = list.filter((g): g is FloorplanGeometry => g !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0] ?? null
  return { kind: 'group', children }
}

export { boundsSize }
