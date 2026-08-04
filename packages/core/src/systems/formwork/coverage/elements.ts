import type { ColumnNode } from '../../../schema/nodes/column'
import type { DoorNode } from '../../../schema/nodes/door'
import type { SlabNode } from '../../../schema/nodes/slab'
import type { WallNode } from '../../../schema/nodes/wall'
import { getWallAssemblyThickness } from '../../../schema/nodes/wall'
import type { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import type { FormworkMode, TopSurface } from '../../../schema/formwork'

/** Every castable kind carries `ShutteringFields`, so one reading serves all. */
type ShutteredNode = { formworkType?: 'plywood' | 'aluminium' | 'steel-panel' | 'none' }

function shutteringEnabled(node: ShutteredNode): boolean {
  return node.formworkType !== undefined && node.formworkType !== 'none'
}

/**
 * Normalises the castable elements the coverage engine understands into one
 * shape, so face classification doesn't branch on node kind more than the
 * physics forces it to. Walls contribute two sides and two ends; columns are
 * point-like on the centreline and carry their plan outline; slabs are a
 * polygon with a soffit and a perimeter.
 */

export interface Vec2 {
  x: number
  y: number
}

export type CastableKind = 'wall' | 'column' | 'slab'

/**
 * A void through a castable element, in its own elevation frame: `along` runs
 * from the start end, `centreY` up from the base. Openings both remove face
 * area and add reveal faces, and the reveals are the half everyone forgets.
 */
export interface ElementOpening {
  id: AnyNodeId
  kind: 'door' | 'window'
  /** Distance along the centreline to the opening centre, m. */
  along: number
  /** Height of the opening centre above the element base, m. */
  centreY: number
  width: number
  height: number
}

/**
 * Plan outline of an element whose footprint is not a centreline band — a
 * column (always convex) or a slab. Areas and perimeters are precomputed
 * because every consumer needs them and none should re-derive a shoelace.
 */
export interface ElementPlan {
  /** Closed outline, without a repeated final point. */
  outline: Vec2[]
  /** Voids right through the element. */
  holes: Vec2[][]
  /** Area enclosed by `outline`, m² — holes not yet taken off. */
  areaSqM: number
  /** `areaSqM` less every hole, m² — the concrete actually placed. */
  netAreaSqM: number
  perimeterM: number
  /** Combined hole perimeter, m. A hole needs edge forms just as the rim does. */
  holePerimeterM: number
  /** Each hole's area, m² — the standard's opening rule applies per hole. */
  holeAreasSqM: number[]
}

export interface CastableElement {
  id: AnyNodeId
  kind: CastableKind
  /** Plan centreline. For a column or slab, start === end === its centre. */
  start: Vec2
  end: Vec2
  /** Structural core thickness in meters — excludes finish layers. */
  coreThickness: number
  height: number
  /** Half-extent perpendicular to the centreline, used for abutment tests. */
  halfWidth: number
  /** Plan footprint, for kinds that are not a centreline band. */
  plan?: ElementPlan
  /**
   * How a column's vertical surface is formed: a `box` of four flat panels, or
   * a single `shaft` wrapped by a tube or a bespoke n-sided form.
   */
  faceLayout?: 'box' | 'shaft'
  /**
   * Slab rim faces to form. One is the usual case; an upstand or a downstand
   * edge beam needs formwork on both sides of the rim.
   */
  edgeFaceCount?: number
  /**
   * Soffit height above the floor it is propped off, m. Absent when nobody has
   * stated it, and left absent rather than guessed: the height decides the
   * falsework stage, and an invented prop length is worse than a gap on the item.
   */
  soffitHeightAboveSupport?: number
  /**
   * Arc offset at the wall's midpoint, m. Non-zero means the faces are curved,
   * which every standard classifies separately from a plane vertical face.
   */
  curveOffset?: number
  castOrder?: number
  pourId?: string
  formworkMode: FormworkMode
  againstEarthSide?: 'a' | 'b'
  topSurface: TopSurface
  /** Per-element pour caps. Each overrides the project limit when tighter. */
  maxLiftHeight?: number
  maxPourLength?: number
  maxPourVolume?: number
  /**
   * False until the host names a shuttering system, and false again when it
   * names `'none'`. Read the same way for every kind: a column or a slab the
   * user has not shuttered is not silently formed on its behalf.
   */
  formworkEnabled: boolean
  openings: ElementOpening[]
}

const DEFAULT_WALL_HEIGHT = 2.5
const DEFAULT_COLUMN_HEIGHT = 2.5

/** Facets used to approximate each non-rectangular column cross-section. */
const COLUMN_FACETS: Partial<Record<ColumnNode['crossSection'], number>> = {
  round: 32,
  octagonal: 8,
  'sixteen-sided': 16,
}

function wallHeight(wall: WallNode): number {
  return wall.height ?? DEFAULT_WALL_HEIGHT
}

type OpeningNode = DoorNode | WindowNode

function openingHostId(opening: OpeningNode): string | null {
  return opening.wallId ?? opening.parentId
}

function polygonArea(outline: Vec2[]): number {
  let twice = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2
    const b = outline[(i + 1) % outline.length] as Vec2
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

function polygonPerimeter(outline: Vec2[]): number {
  let total = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2
    const b = outline[(i + 1) % outline.length] as Vec2
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

function planFrom(outline: Vec2[], holes: Vec2[][]): ElementPlan {
  const holeAreasSqM = holes.map(polygonArea)
  const areaSqM = polygonArea(outline)
  return {
    outline,
    holes,
    areaSqM,
    netAreaSqM: Math.max(0, areaSqM - holeAreasSqM.reduce((sum, area) => sum + area, 0)),
    perimeterM: polygonPerimeter(outline),
    holePerimeterM: holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0),
    holeAreasSqM,
  }
}

/**
 * Voids hosted by `hostId`, in the host's own elevation frame. `position[0]`
 * is the distance along the wall from its start and `position[1]` the centre
 * height — the wall-child convention every opening tool writes.
 */
export function openingsForHost(hostId: AnyNodeId, nodes: AnyNode[]): ElementOpening[] {
  const out: ElementOpening[] = []
  for (const node of nodes) {
    if (node.type !== 'door' && node.type !== 'window') continue
    if (node.visible === false) continue
    const opening = node as OpeningNode
    if (openingHostId(opening) !== hostId) continue
    out.push({
      id: opening.id as AnyNodeId,
      kind: node.type,
      along: opening.position[0],
      centreY: opening.position[1],
      width: opening.width,
      height: opening.height,
    })
  }
  return out
}

/**
 * A column's plan corners. Rotation is about Y in the Three.js sense, so local
 * (x, z) maps to world (x·cos + z·sin, −x·sin + z·cos) — ignoring it puts every
 * rotated column's faces on the wrong lines.
 */
function columnOutline(column: ColumnNode): Vec2[] {
  const centre = { x: column.position[0], y: column.position[2] }
  const cos = Math.cos(column.rotation)
  const sin = Math.sin(column.rotation)
  const toWorld = (lx: number, lz: number): Vec2 => ({
    x: centre.x + lx * cos + lz * sin,
    y: centre.y - lx * sin + lz * cos,
  })

  const facets = COLUMN_FACETS[column.crossSection]
  if (facets !== undefined) {
    const out: Vec2[] = []
    for (let i = 0; i < facets; i++) {
      const angle = (2 * Math.PI * i) / facets
      out.push(toWorld(column.radius * Math.cos(angle), column.radius * Math.sin(angle)))
    }
    return out
  }

  const halfW = column.width / 2
  const halfD = column.depth / 2
  // Fixed corner order so `classifyColumnFaces` can map edge index to face role.
  return [toWorld(-halfW, -halfD), toWorld(halfW, -halfD), toWorld(halfW, halfD), toWorld(-halfW, halfD)]
}

export function toCastableElement(
  node: AnyNode,
  openings: ElementOpening[] = [],
): CastableElement | null {
  if (node.type === 'wall') {
    const wall = node as WallNode
    const core = getWallAssemblyThickness(wall)
    return {
      id: wall.id as AnyNodeId,
      kind: 'wall',
      start: { x: wall.start[0], y: wall.start[1] },
      end: { x: wall.end[0], y: wall.end[1] },
      coreThickness: core,
      height: wallHeight(wall),
      halfWidth: core / 2,
      curveOffset: wall.curveOffset,
      castOrder: wall.castOrder,
      pourId: wall.pourId,
      formworkMode: wall.formworkMode ?? 'double-sided',
      againstEarthSide: wall.againstEarthSide,
      topSurface: wall.topSurface ?? { kind: 'open', slopeDeg: 0 },
      maxLiftHeight: wall.maxLiftHeight,
      maxPourLength: wall.maxPourLength,
      maxPourVolume: wall.maxPourVolume,
      formworkEnabled: shutteringEnabled(wall),
      openings,
    }
  }

  if (node.type === 'column') {
    const column = node as ColumnNode
    const centre: Vec2 = { x: column.position[0], y: column.position[2] }
    const outline = columnOutline(column)
    const facets = COLUMN_FACETS[column.crossSection]
    const plan = planFrom(outline, [])
    // A true circle is not its own inscribed polygon: the shaft is billed at
    // π·D·h, so the faceted outline is for footprint tests only.
    const round = column.crossSection === 'round'
    // Columns read as a point on the centreline; `halfWidth` carries their
    // plan extent so a wall ending inside one still registers as abutting.
    const extent = facets !== undefined ? column.radius : Math.max(column.width, column.depth) / 2
    return {
      id: column.id as AnyNodeId,
      kind: 'column',
      start: centre,
      end: centre,
      coreThickness: extent * 2,
      height: column.height ?? DEFAULT_COLUMN_HEIGHT,
      halfWidth: extent,
      plan: round
        ? {
            ...plan,
            areaSqM: Math.PI * column.radius * column.radius,
            netAreaSqM: Math.PI * column.radius * column.radius,
            perimeterM: 2 * Math.PI * column.radius,
          }
        : plan,
      faceLayout: facets === undefined ? 'box' : 'shaft',
      castOrder: column.castOrder,
      pourId: column.pourId,
      formworkMode: column.formworkMode ?? 'double-sided',
      againstEarthSide: column.againstEarthSide,
      topSurface: column.topSurface ?? { kind: 'open', slopeDeg: 0 },
      maxLiftHeight: column.maxLiftHeight,
      maxPourLength: column.maxPourLength,
      maxPourVolume: column.maxPourVolume,
      formworkEnabled: shutteringEnabled(column),
      openings,
    }
  }

  if (node.type === 'slab') {
    const slab = node as SlabNode
    if (slab.polygon.length < 3 || slab.thickness <= 0) return null
    const outline = slab.polygon.map(([x, y]) => ({ x, y }))
    const holes = slab.holes.filter((hole) => hole.length >= 3).map((hole) => hole.map(([x, y]) => ({ x, y })))
    const plan = planFrom(outline, holes)
    if (plan.areaSqM <= 0) return null
    // `start === end` so the element yields exactly one pour unit. Bay-splitting
    // a slab is a polygon partition, not a cut along a centreline, so
    // `maxPourLength` and `maxPourVolume` do not apply to it yet.
    const centroid: Vec2 = {
      x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
      y: outline.reduce((sum, p) => sum + p.y, 0) / outline.length,
    }
    return {
      id: slab.id as AnyNodeId,
      kind: 'slab',
      start: centroid,
      end: centroid,
      coreThickness: slab.thickness,
      height: slab.thickness,
      halfWidth: 0,
      plan,
      edgeFaceCount: slab.edgeFaceCount ?? 1,
      soffitHeightAboveSupport: slab.soffitHeightAboveSupport,
      castOrder: slab.castOrder,
      pourId: slab.pourId,
      formworkMode: slab.formworkMode ?? 'double-sided',
      againstEarthSide: slab.againstEarthSide,
      topSurface: slab.topSurface ?? { kind: 'open', slopeDeg: 0 },
      maxLiftHeight: slab.maxLiftHeight,
      maxPourLength: slab.maxPourLength,
      maxPourVolume: slab.maxPourVolume,
      formworkEnabled: shutteringEnabled(slab),
      openings,
    }
  }

  return null
}

export function collectCastableElements(nodes: AnyNode[]): CastableElement[] {
  const out: CastableElement[] = []
  for (const node of nodes) {
    const element = toCastableElement(node, openingsForHost(node.id as AnyNodeId, nodes))
    if (element) out.push(element)
  }
  return out
}

export function elementLength(element: CastableElement): number {
  return Math.hypot(element.end.x - element.start.x, element.end.y - element.start.y)
}

/** Shortest distance from `point` to the element's centreline segment. */
export function distanceToCentreline(element: CastableElement, point: Vec2): number {
  const vx = element.end.x - element.start.x
  const vy = element.end.y - element.start.y
  const lengthSq = vx * vx + vy * vy
  if (lengthSq < 1e-12) return Math.hypot(point.x - element.start.x, point.y - element.start.y)
  const t = Math.max(
    0,
    Math.min(1, ((point.x - element.start.x) * vx + (point.y - element.start.y) * vy) / lengthSq),
  )
  return Math.hypot(element.start.x + t * vx - point.x, element.start.y + t * vy - point.y)
}
