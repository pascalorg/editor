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
import { drawTable } from './draw-table'
import { adaptSchedule, buildSchedule, type ScheduleTable } from './schedule'
import { INK, INK_SOFT } from './titleblock'
import type { AnyNodeLike, NodeMap } from './model'
import { levelLabel } from './model'
import { sheetInchesToWorld } from './scale'
import type { ViewportLayers, ViewportNode } from './schema'

/* ------------------------------------------------- provider registry */

export type DrawingResult = {
  primitives: FloorplanGeometry[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
export type DrawingProvider = (nodes: NodeMap, args: Record<string, unknown>) => DrawingResult | null

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

/** Whether a node type is drawn under this viewport's layer switches. */
export function acceptsNode(layers: ViewportLayers, type: string, category?: string): boolean {
  if (FURNITURE_TYPES.has(type)) return layers.furniture
  if (MEP_TYPES.has(type)) return layers.mep
  if (type.startsWith('bones:')) return layers.framing
  if (type.startsWith('utilities:')) return layers.siteUtilities
  if (type === 'terrain' || type === 'scan') return layers.terrain
  if (category === 'analysis') return false
  return true
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
}

function note(vp: ViewportNode, message: string): FloorplanGeometry[] {
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
    {
      kind: 'text',
      x: vp.x + vp.w / 2,
      y: vp.y + vp.h / 2,
      text: message,
      fontSize: 0.16,
      fill: INK_SOFT,
      textAnchor: 'middle',
      fontFamily: 'Helvetica, Arial, sans-serif',
    },
  ]
}

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
}

export function resolveViewport(vp: ViewportNode, ctx: ResolveContext): DrawnViewport {
  const { nodes } = ctx
  switch (vp.kind) {
    case 'plan':
      return resolvePlan(vp, nodes)
    case 'site-plan':
    case 'section':
    case 'elevation':
      return resolveProvided(vp, nodes)
    case 'schedule':
      return resolveSchedule(vp, nodes)
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
        return {
          plate: note(vp, vp.kind === 'view3d' ? 'view — not captured yet' : 'no image'),
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
      return { plate: note(vp, 'unsupported viewport'), live: null, title: vp.title, scale: undefined }
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
    accept: (node, category) => acceptsNode(vp.layers, node.type, category),
  })
  const model = combine(entries.map((e) => e.model))
  const annotations = combine(entries.map((e) => e.annotations))
  if (!model && !annotations) {
    return { plate: note(vp, 'nothing on this level to draw'), live: null, title, scale: vp.scale }
  }
  const rotationDeg = editor.resolveSheetRotationDeg(nodes as never, levelId as never)
  const bounds = vp.crop
    ? vp.crop
    : padBounds(
        unionBounds(geometryListBounds([model]), geometryListBounds([annotations])),
        0.4,
      )
  return {
    plate: [],
    live: { model, annotations, view: windowFor(vp, bounds, rotationDeg), rotationDeg },
    title,
    scale: vp.scale,
  }
}

function resolveProvided(vp: ViewportNode, nodes: NodeMap): DrawnViewport {
  const build = provider(vp.kind)
  const title =
    vp.title ||
    (vp.kind === 'site-plan'
      ? 'Site plan'
      : vp.kind === 'section'
        ? 'Building section'
        : `${(vp.direction ?? 'north').toUpperCase()} elevation`)
  if (!build) {
    const pending =
      vp.kind === 'site-plan' ? 'site plan — pending' : `${vp.kind} — pending`
    return { plate: note(vp, pending), live: null, title, scale: vp.scale }
  }
  let result: DrawingResult | null = null
  try {
    result = build(nodes, {
      levelId: vp.levelId,
      markerId: vp.markerId,
      direction: vp.direction,
      layers: vp.layers,
    })
  } catch (error) {
    return {
      plate: note(vp, `${vp.kind} failed: ${(error as Error).message ?? 'error'}`),
      live: null,
      title,
      scale: vp.scale,
    }
  }
  if (!result || result.primitives.length === 0) {
    return { plate: note(vp, `${vp.kind} — nothing to draw`), live: null, title, scale: vp.scale }
  }
  const model: FloorplanGeometry = { kind: 'group', children: result.primitives }
  return {
    plate: [],
    live: { model, annotations: null, view: windowFor(vp, padBounds(result.bounds, 0.4), 0), rotationDeg: 0 },
    title,
    scale: vp.scale,
  }
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
    return { plate: note(vp, 'no level'), live: null, title: vp.title || 'Schedule', scale: undefined }
  }
  const table =
    (of !== 'rooms' ? hostSchedule(nodes, levelId, of) : null) ??
    buildSchedule(nodes as never, levelId, of)
  const title = vp.title || table.title
  if (table.rows.length === 0) {
    return { plate: note(vp, `${title.toLowerCase()} — nothing scheduled`), live: null, title, scale: undefined }
  }
  return { plate: drawTable(table, vp.x, vp.y, vp.w, vp.h), live: null, title, scale: undefined }
}

export function firstLevelId(nodes: NodeMap): string | undefined {
  const levels = Object.values(nodes).filter((n): n is AnyNodeLike => n?.type === 'level')
  levels.sort((a, b) => (((a.level as number) ?? 0) - ((b.level as number) ?? 0)))
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
