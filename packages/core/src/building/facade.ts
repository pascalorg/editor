import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  type FenceNode,
  FRENCH_DOOR_SEGMENTS,
  PanelNode,
  type SlabNode,
  type WallNode,
  WindowNode,
} from '../schema'
import {
  type FacadeMode,
  type FacadeSurface,
  readLiveWallFacade,
  readWallFacade,
  type WallFacade,
} from '../systems/facade/facade-config'
import {
  bayCladdingRects,
  bayVariant,
  bayWidth,
  dressFacadeUnit,
  type FacadeBayPlacement,
  type FacadeCladding,
  type FacadeDressPlacement,
  type FacadeGridRegion,
  type FacadeOpeningPlacement,
  type FacadeOpeningStyle,
  type FacadePaint,
  type FacadeRoomFrontage,
  type FacadeUnit,
  type FacadeUnitObstacle,
  FacadeUnitSchema,
  type FacadeVariationContext,
  facadeColumnBin,
  isPaintOnlyUnit,
  resolveFacadeUnit,
} from '../systems/facade/facade-unit'
import { pointInPolygon } from '../systems/slab/slab-support'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { indexRepetitions, type RepetitionPlan, reconcileRepetitions } from '../utils/repetition'
import { areSemanticValuesEqual } from '../utils/semantic-equal'
import { facadeBalconyNodes } from './facade-balconies'
import { alongLine, faceLine, facePieces, typicalPieces } from './facade-pieces'
import {
  type FacadeRun,
  type FacadeRunEnd,
  type FacadeTargetWall,
  type FacadeWallTarget,
  facadeChains,
  facadeFace,
  facadeRuns,
} from './facade-runs'
import { owedRoom, polygonArea, roomZonesOn } from './room-habitable'
import { wallBaseElevationIn } from './wall-support-in'

/** Metadata a facade stamps on what it generates; releasing them detaches the node. */
export const FACADE_OWNERSHIP_KEYS = ['facadeOwner', 'facadeCell'] as const
/** Set on what a facade released when it detached, so forcing it back can take exactly those. */
export const FACADE_RELEASED_KEY = 'facadeReleasedFrom'
/** Set on an opening a dress styled: the panes and frame it had, to give back on removal. */
export const FACADE_DRESSED_KEY = 'facadeDressed'
export const MAX_FACADE_OPENINGS = 400
/** How far an opening may sit past a wall's end and still count as inside it. */
const HOST_TOLERANCE = 1e-6

export type FacadeOpeningNode = WindowNode | DoorNode
export type FacadeWallPlan = {
  wall: WallNode
  openings: RepetitionPlan<FacadeOpeningNode>
  balconies: RepetitionPlan<SlabNode | FenceNode>
  panels: RepetitionPlan<PanelNode>
  /** Openings a dress keeps, with the unit's panes and frame; never moved or resized. */
  dressed: FacadeOpeningNode[]
  /** Openings a dress no longer styles, given back their own panes and frame. */
  restored: FacadeOpeningNode[]
  /** Null when the wall already carries this exact facade. */
  wallUpdate: Pick<WallNode, 'slots' | 'metadata'> | null
}
export type FacadeFillPlan = {
  walls: FacadeWallPlan[]
  runs: FacadeRun[]
  skipped: number
  /** Openings already on the walls that the fill's openings would overlap, with `replaceExisting`. */
  displaced: FacadeOpeningNode[]
  /** With `obstacles: 'room'`: the habitable rooms on these walls the fill could not give a window. */
  unlitRooms?: string[]
}

/**
 * The stretches of a run on its face's column grid, for `grid: 'building'`, each with where one of
 * its columns starts, along the run. A run's piece of face (its walls end to end on one line) that
 * the most storeys share keeps its own centring; a piece fewer storeys share follows the more
 * typical pieces over it, each centred on its own extent: a set-back storey follows the storeys
 * below, a long storey under two wings stacks on both, and what no typical piece covers centres
 * its own. One grid over a whole plane cut by a recess lost the Victor's columns; each band
 * centring its own let them drift floor to floor (2026-10-03).
 */
function faceGridRegions(
  nodes: Record<string, AnyNode>,
  run: FacadeRun,
  unit: FacadeUnit,
): FacadeGridRegion[] | undefined {
  const bay = unit.bays.find((candidate) => candidate.widthMode === 'repeat')
  const levelId = run.walls[0]?.wall.parentId
  const line = faceLine(run.origin, [
    run.origin[0] + run.direction[0],
    run.origin[1] + run.direction[1],
  ])
  if (!(bay && levelId && line)) return undefined
  // Run-local x runs along the run's direction from its start; the line's axis may run the other way.
  const sign = run.direction[0] * line.axis[0] + run.direction[1] * line.axis[1] < 0 ? -1 : 1
  const at = alongLine(line, run.origin)
  const local = (s: number) => sign * (s - at) - run.start
  const middle = at + (sign * (run.start + run.end)) / 2
  const pieces = facePieces(nodes, line)
  const own = pieces.find(
    (piece) =>
      piece.levelId === levelId && piece.from - 0.05 <= middle && middle <= piece.to + 0.05,
  )
  if (!own) return undefined
  const width = bayWidth(bay)
  const regionOf = ({ from, to }: { from: number; to: number }): FacadeGridRegion | null => {
    const count = Math.floor((to - from - 2 * bay.endPier + bay.pier) / (width + bay.pier))
    if (count < 1) return null
    const first = from + (to - from - (count * width + (count - 1) * bay.pier)) / 2
    const [a, b] = [local(Math.max(from, own.from)), local(Math.min(to, own.to))]
    return {
      left: Math.min(a, b),
      right: Math.max(a, b),
      origin: sign > 0 ? local(first) : local(first) - width,
    }
  }
  const leading = typicalPieces(pieces, own)
  return leading.flatMap((piece) => regionOf(piece) ?? [])
}

const unlitList = (names: string[]) => (names.length ? { unlitRooms: [...new Set(names)] } : {})

/**
 * The rooms behind a run, between the faces of the walls meeting it, named from the floor's room
 * zones: sampled a little inside the facade wall, mid-way along each stretch.
 */
function roomFrontages(nodes: Record<string, AnyNode>, run: FacadeRun): FacadeRoomFrontage[] {
  const levelId = run.walls[0]?.wall.parentId
  const zones = levelId ? roomZonesOn(nodes, levelId) : []
  const owed = owedRoom(nodes, zones)
  const inset = Math.max(...run.walls.map((w) => w.wall.thickness ?? 0.1)) / 2 + 0.25
  const cuts = (run.partitions ?? []).flat()
  const bounds = [run.start, ...cuts, run.end]
  const rooms: FacadeRoomFrontage[] = []
  for (let i = 0; i + 1 < bounds.length; i += 2) {
    const [from, to] = [bounds[i]!, bounds[i + 1]!]
    if (to - from < 0.05) continue
    const at = (from + to) / 2
    const x = run.origin[0] + run.direction[0] * at - run.normal[0] * inset
    const z = run.origin[1] + run.direction[1] * at - run.normal[1] * inset
    // The smallest room holding the point: an apartment's own zone wraps all of its rooms, and
    // read first it hid the Victor's bedroom 2 behind the apartment's name (2026-10-03).
    const zone = zones
      .filter((candidate) => pointInPolygon(x, z, candidate.polygon as [number, number][]))
      .sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0]
    rooms.push({
      left: from - run.start,
      right: to - run.start,
      name: zone?.name ?? '',
      owed: !!zone && owed(zone),
      ...(zone ? { id: zone.id } : {}),
    })
  }
  return rooms
}

export type FacadeWallRefusalCode =
  | 'wall_linked_copy'
  | 'wall_curved'
  | 'wall_placeholder'
  | 'wall_detached'

/** Why a facade cannot be generated on this wall: a code for agents, a sentence for the panel. */
export function facadeWallRefusal(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  { paintOnly = false }: { paintOnly?: boolean } = {},
): { code: FacadeWallRefusalCode; message: string } | null {
  if (wall.metadata.linkedArray)
    return {
      code: 'wall_linked_copy',
      message: 'Edit the array source or make this copy real before applying a facade.',
    }
  if (wall.curveOffset && !paintOnly)
    return {
      code: 'wall_curved',
      message:
        'Facades currently support straight walls; a curved wall takes paint only (a unit with no openings, balconies, panels or piers).',
    }
  if (wall.parentId && nodes[wall.parentId]?.metadata.placeholderSource)
    return {
      code: 'wall_placeholder',
      message: 'Edit the source floor or make this placeholder real first.',
    }
  if (readWallFacade(wall.metadata)?.detached)
    return {
      code: 'wall_detached',
      message:
        'This facade is detached. Edit its openings directly, or undo the manual edit to restore it.',
    }
  return null
}

/** Why a facade cannot be generated on this wall, as a sentence for the panel. */
export function facadeWallIssue(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  options?: { paintOnly?: boolean },
): string | null {
  return facadeWallRefusal(wall, nodes, options)?.message ?? null
}

const sameUnit = (a: FacadeUnit, b: FacadeUnit) => JSON.stringify(a) === JSON.stringify(b)

/** Walls already carrying this unit, in this mode, live on the same level: a fill extends through them. */
function liveWallsWithUnit(
  nodes: Record<string, AnyNode>,
  levelIds: Set<string>,
  unit: FacadeUnit,
  mode: FacadeMode,
  exclude?: ReadonlySet<string>,
) {
  return Object.values(nodes).filter((node): node is WallNode => {
    if (node.type !== 'wall' || !levelIds.has(node.parentId as string) || exclude?.has(node.id))
      return false
    const facade = readLiveWallFacade(node.metadata)
    return !!facade && (facade.mode ?? 'place') === mode && sameUnit(facade.unit, unit)
  })
}

const isOpening = (node: AnyNode | undefined): node is FacadeOpeningNode =>
  node?.type === 'window' || node?.type === 'door'

/**
 * Where the openings a dress keeps stand: geometry only. The style a dress
 * writes on them must not reach the frame, or every dressed wall would read as
 * drifted right after its apply.
 */
function keptOpeningGeometry(wall: WallNode, nodes: Record<string, AnyNode>) {
  return wall.children
    .map((id) => nodes[id])
    .filter((node): node is FacadeOpeningNode => isOpening(node) && !node.metadata.isTransient)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => [node.id, node.position, node.width, node.height])
}

function targetOf(wall: WallNode, targets: Record<string, FacadeWallTarget>): FacadeWallTarget {
  const stored = readWallFacade(wall.metadata)
  return targets[wall.id] ?? { surface: stored?.surface ?? 'exterior', face: stored?.face }
}

/** Every input a wall's share of the facade resolved against. When this drifts, it refills. */
function frameOf(
  wall: WallNode,
  runs: readonly FacadeRun[],
  nodes: Record<string, AnyNode>,
  unit: FacadeUnit,
  mode: FacadeMode,
  treated: WallFacade['treated'],
) {
  const own = runs.filter((run) => run.walls.some((w) => w.wall.id === wall.id))
  return JSON.stringify([
    unit,
    wall.start,
    wall.end,
    wall.thickness,
    wallBaseElevationIn(wall, nodes),
    own.map((run) => [
      run.key,
      run.start,
      run.end,
      run.height,
      run.normal,
      run.walls.map((w) => [w.wall.id, w.from, w.to]),
      // A whole-side run keeps its bounds when a partition inside it moves.
      ...(run.partitions ? [run.partitions] : []),
    ]),
    // A dress follows the openings it keeps; place-mode frames stay as they always were.
    ...(mode === 'dress' ? [keptOpeningGeometry(wall, nodes)] : []),
    ...(treated ? [treated] : []),
  ])
}

/**
 * The layout frame a live facade wall would get from a refill now. Resize sync
 * compares it with the stored frame, so moving a partition that meets the
 * facade — which moves a junction — refits it like a resize does.
 */
export function facadeLayoutFrame(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  facade: WallFacade,
) {
  const mode = facade.mode ?? 'place'
  const mates = liveWallsWithUnit(nodes, new Set([wall.parentId as string]), facade.unit, mode)
  const chain = facadeChains(
    [wall, ...mates.filter((mate) => mate.id !== wall.id)].map((w) => ({
      wall: w,
      face: facadeFace(w, targetOf(w, {})),
    })),
  ).find((c) => c.some((t) => t.wall.id === wall.id))
  const continuous = facade.unit.rhythm === 'side'
  return frameOf(
    wall,
    facadeRuns(nodes, chain ?? [], { continuous }),
    nodes,
    facade.unit,
    mode,
    facade.treated,
  )
}

/**
 * The wall slots a finish paints: the filled face — geometric face `a` is the
 * front (left of start → end), `b` the back — or both faces.
 */
export function facadeSurfaceSlots(surface: FacadeSurface, face: 'front' | 'back'): string[] {
  if (surface === 'both') return ['a', 'b']
  return [face === 'front' ? 'a' : 'b']
}

type DressedStyle = {
  windowType?: WindowNode['windowType']
  columnRatios?: number[]
  rowRatios?: number[]
  sill?: boolean
  sillDepth?: number
  frameDepth?: number
  /** Slot refs the dress replaced; null where the opening had none. */
  slots: Record<string, string | null>
}

const withSlots = (
  slots: Record<string, string> | undefined,
  changes: Record<string, string | null>,
) => {
  const next: Record<string, string> = { ...slots }
  for (const [slot, ref] of Object.entries(changes))
    if (ref === null) delete next[slot]
    else next[slot] = ref
  return Object.keys(next).length ? next : undefined
}

/**
 * The slots a unit paints on an opening: frame and glass, and a door's leaf,
 * which is joinery too (a French door's stiles are its `panel` slot).
 */
const openingPaint = (kind: FacadeOpeningNode['type'], paint: FacadePaint) => ({
  ...(paint.frame
    ? { frame: paint.frame, ...(kind === 'door' ? { panel: paint.frame } : {}) }
    : {}),
  ...(paint.glass ? { glass: paint.glass } : {}),
})

/** The unit's panes and paint on an opening a dress keeps; its place and size stay exactly as they are. */
function dressOpening(
  node: FacadeOpeningNode,
  style: FacadeOpeningStyle,
  paint: FacadePaint,
): FacadeOpeningNode {
  const { facadeOwner: _, facadeCell: __, ...metadata } = node.metadata
  const painted = openingPaint(node.type, paint)
  const slotNames = Object.keys(painted)
  const kept = (node.metadata[FACADE_DRESSED_KEY] as { previous?: DressedStyle } | undefined)
    ?.previous
  const previous: DressedStyle = kept ?? {
    ...(node.type === 'window'
      ? {
          windowType: node.windowType,
          columnRatios: node.columnRatios,
          rowRatios: node.rowRatios,
          sill: node.sill,
          sillDepth: node.sillDepth,
        }
      : {}),
    frameDepth: node.frameDepth,
    slots: Object.fromEntries(slotNames.map((slot) => [slot, node.slots?.[slot] ?? null])),
  }
  const dressedMetadata = { ...metadata, [FACADE_DRESSED_KEY]: { previous } }
  const slots = withSlots(node.slots, painted)
  // Depth is style; recess and shape would move or reshape the opening, so a dress leaves them.
  const frameDepth = style.frameDepth === undefined ? {} : { frameDepth: style.frameDepth }
  if (node.type === 'door') return { ...node, ...frameDepth, slots, metadata: dressedMetadata }
  return {
    ...node,
    ...windowDepthStyle(style),
    windowType: style.windowType,
    columnRatios: style.columnRatios ?? Array.from({ length: style.columns }, () => 1),
    rowRatios: style.rowRatios ?? Array.from({ length: style.rows }, () => 1),
    slots,
    metadata: dressedMetadata,
  }
}

/** An opening a dress no longer styles: its own panes and frame back, released from any fill. */
function restoreOpening(node: FacadeOpeningNode): FacadeOpeningNode {
  const {
    facadeOwner: _,
    facadeCell: __,
    [FACADE_DRESSED_KEY]: dressed,
    ...metadata
  } = node.metadata
  const previous = (dressed as { previous?: DressedStyle } | undefined)?.previous
  if (!previous) return { ...node, metadata }
  const slots = withSlots(node.slots, previous.slots)
  const frameDepth = previous.frameDepth === undefined ? {} : { frameDepth: previous.frameDepth }
  if (node.type === 'door') return { ...node, ...frameDepth, slots, metadata }
  return {
    ...node,
    ...frameDepth,
    ...(previous.sill === undefined ? {} : { sill: previous.sill }),
    ...(previous.sillDepth === undefined ? {} : { sillDepth: previous.sillDepth }),
    ...(previous.windowType ? { windowType: previous.windowType } : {}),
    ...(previous.columnRatios ? { columnRatios: previous.columnRatios } : {}),
    ...(previous.rowRatios ? { rowRatios: previous.rowRatios } : {}),
    slots,
    metadata,
  }
}

type DesiredOpening = { cell: string; opening: FacadeOpeningPlacement; x: number }

/**
 * Where an opening's centre sits across the wall so its frame's outer face is
 * `recess` behind the filled face, never past the other one. No recess keeps
 * the frame centred, as facade openings always were.
 */
function recessedDepth(
  wall: WallNode,
  face: 'front' | 'back',
  recess: number | undefined,
  frameDepth: number,
) {
  if (recess === undefined) return 0
  const reach = Math.max(0, (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2 - frameDepth / 2)
  const centre = Math.min(Math.max(reach - recess, -reach), reach)
  return face === 'front' ? centre : -centre
}

/** The unit's sill ledge and frame depth on a window, where the unit sets them. */
const windowDepthStyle = (style: FacadeOpeningStyle) => ({
  ...(style.sillDepth === undefined
    ? {}
    : style.sillDepth > 0
      ? { sill: true, sillDepth: style.sillDepth }
      : { sill: false }),
  ...(style.frameDepth === undefined ? {} : { frameDepth: style.frameDepth }),
})

function buildOpening(
  wall: WallNode,
  face: 'front' | 'back',
  desired: DesiredOpening,
  old: FacadeOpeningNode | undefined,
  paint: FacadePaint,
): FacadeOpeningNode {
  const { opening } = desired
  const { style } = opening
  const common = {
    ...old,
    parentId: wall.id,
    wallId: wall.id,
    position: [desired.x, opening.y, 0] as [number, number, number],
    // It faces the facade, so its sill and outer frame are outside.
    rotation: [0, face === 'back' ? Math.PI : 0, 0] as [number, number, number],
    side: face,
    width: opening.right - opening.left,
    height: opening.top - opening.bottom,
    ...(style.shape ? { openingShape: style.shape } : {}),
    ...(style.archHeight === undefined ? {} : { archHeight: style.archHeight }),
    slots: { ...old?.slots, ...openingPaint(opening.kind, paint) },
    metadata: { ...old?.metadata, facadeOwner: wall.id, facadeCell: desired.cell },
  }
  const recessed = <T extends FacadeOpeningNode>(node: T): T => ({
    ...node,
    position: [
      node.position[0],
      node.position[1],
      recessedDepth(wall, face, style.recess, node.frameDepth),
    ],
  })
  if (opening.kind === 'window')
    return recessed(
      WindowNode.parse({
        name: 'Facade window',
        ...common,
        windowType: style.windowType,
        columnRatios: style.columnRatios ?? Array.from({ length: style.columns }, () => 1),
        rowRatios: style.rowRatios ?? Array.from({ length: style.rows }, () => 1),
        ...windowDepthStyle(style),
      }),
    )
  // French doors are glazed; below this width two leaves would be too slim to pass.
  const leaves =
    style.doorType === 'double' || (style.doorType === 'french' && common.width >= 1.1) ? 2 : 1
  return recessed(
    DoorNode.parse({
      name: 'Facade door',
      ...common,
      doorType: style.doorType,
      leafCount: leaves,
      ...(style.frameDepth === undefined ? {} : { frameDepth: style.frameDepth }),
      ...(style.doorType === 'french'
        ? {
            contentPadding: [0.045, 0.055],
            segments: FRENCH_DOOR_SEGMENTS.map((segment) =>
              leaves === 2 ? segment : { ...segment, columnRatios: [1] },
            ),
          }
        : {}),
    }),
  )
}

type DesiredPanel = {
  cell: string
  x: number
  width: number
  bottom: number
  top: number
  cladding: FacadeCladding
}

const PANEL_NAMES: [string, string][] = [
  ['infill', 'Facade infill'],
  ['surround', 'Facade surround'],
  ['pier', 'Facade pier'],
]

function buildPanel(
  wall: WallNode,
  side: 'front' | 'back',
  desired: DesiredPanel,
  old: PanelNode | undefined,
): PanelNode {
  return PanelNode.parse({
    name:
      PANEL_NAMES.find(([part]) => desired.cell.split(':').at(-1)!.startsWith(part))?.[1] ??
      'Facade spandrel',
    ...old,
    parentId: wall.id,
    wallId: wall.id,
    side,
    position: [desired.x, (desired.bottom + desired.top) / 2, 0],
    width: desired.width,
    height: desired.top - desired.bottom,
    thickness: desired.cladding.thickness,
    offset: desired.cladding.standoff,
    slots: { ...old?.slots, surface: desired.cladding.material },
    metadata: { ...old?.metadata, facadeOwner: wall.id, facadeCell: desired.cell },
  })
}

/** A placement moved along its run: the resolver worked on the run less a corner chain. */
function shiftPlacement(placement: FacadeBayPlacement, by: number): FacadeBayPlacement {
  if (!by) return placement
  return {
    ...placement,
    left: placement.left + by,
    right: placement.right + by,
    ...(placement.opening
      ? {
          opening: {
            ...placement.opening,
            left: placement.opening.left + by,
            right: placement.opening.right + by,
            x: placement.opening.x + by,
          },
        }
      : {}),
    ...(placement.balcony
      ? {
          balcony: {
            ...placement.balcony,
            left: placement.balcony.left + by,
            right: placement.balcony.right + by,
          },
        }
      : {}),
  }
}

/**
 * Resolve on the run less what a corner chain keeps at either end, then put the
 * placements back on the whole run. Columns keep the whole run's axis, so a chain
 * does not change which variant a column draws.
 */
function insetResolve(
  unit: FacadeUnit,
  size: { width: number; height: number },
  obstacles: readonly FacadeUnitObstacle[],
  variation: FacadeVariationContext,
  fromStart: number,
  fromEnd: number,
  rooms: readonly FacadeRoomFrontage[] = [],
  gridRegions?: readonly FacadeGridRegion[],
) {
  const grid = gridRegions
    ? {
        grid: {
          regions: gridRegions.map((region) => ({
            left: region.left - fromStart,
            right: region.right - fromStart,
            origin: region.origin - fromStart,
          })),
        },
      }
    : {}
  if (!fromStart && !fromEnd)
    return resolveFacadeUnit(unit, size, obstacles, { variation, rooms, ...grid })
  const width = size.width - fromStart - fromEnd
  if (width <= 0.3) return { placements: [], skipped: 0 }
  const resolved = resolveFacadeUnit(
    unit,
    { width, height: size.height },
    obstacles.map((o) => ({ ...o, left: o.left - fromStart, right: o.right - fromStart })),
    {
      rooms: rooms.map((room) => ({
        ...room,
        left: room.left - fromStart,
        right: room.right - fromStart,
      })),
      variation: {
        ...variation,
        column: (bay, centre) => variation.column(bay, centre + fromStart),
      },
      ...grid,
    },
  )
  return {
    ...resolved,
    placements: resolved.placements.map((p) => shiftPlacement(p, fromStart)),
  }
}

/** Where a point on the run axis falls in a wall's own coordinate along its length. */
const wallLocal = (w: FacadeRun['walls'][number], along: number) =>
  w.reversed ? w.to - along : along - w.from

/**
 * Plan a facade fill without touching the store. The picked walls extend
 * through collinear walls already carrying the same unit, split into runs at
 * every junction, and the unit resolves once per run. Every wall is planned
 * before any is committed, so an invalid wall cannot leave a selection
 * half-filled; the same plan drives the preview and the commit.
 */
export function planFacadeFill({
  walls,
  nodes,
  unit: input,
  targets = {},
  sourceItemId,
  replaceExisting = false,
  exclude,
  sets,
  treatments,
  mode = 'place',
}: {
  walls: readonly WallNode[]
  nodes: Record<string, AnyNode>
  unit: FacadeUnit
  targets?: Record<string, FacadeWallTarget>
  /** Place the unit's openings, or keep the openings there and dress them. */
  mode?: FacadeMode
  /** Walls the fill must not extend through, though they carry this unit: a set is taking them elsewhere. */
  exclude?: ReadonlySet<string>
  /** Set membership to stamp on picked walls; the others keep theirs while their unit stays. */
  sets?: Readonly<Record<string, NonNullable<WallFacade['set']>>>
  /** What the set's corners and bands ask of the walls it stamps; absent there means nothing. */
  treatments?: Readonly<Record<string, WallFacade['treated']>>
  /**
   * Existing openings no longer hold the unit back: those its openings would
   * overlap are reported in `displaced`, to be removed with the fill.
   */
  replaceExisting?: boolean
  sourceItemId?: string
}): FacadeFillPlan {
  if (!walls.length) throw Error('Select a wall before applying a facade.')
  // Canonical key order, so a unit matches the same unit stored on neighbouring walls.
  const unit = FacadeUnitSchema.parse(input)
  const paintOnly = isPaintOnlyUnit(unit)
  for (const wall of walls) {
    const issue = facadeWallIssue(wall, nodes, { paintOnly })
    if (issue) throw Error(issue)
  }
  const picked = new Set<string>(walls.map((wall) => wall.id))
  const levels = new Set(walls.map((wall) => wall.parentId as string))
  const candidates = [
    ...new Map(
      [...walls, ...liveWallsWithUnit(nodes, levels, unit, mode, exclude)].map((wall) => [
        wall.id,
        wall,
      ]),
    ).values(),
  ]
  const chains = facadeChains(
    candidates.map(
      (wall): FacadeTargetWall => ({ wall, face: facadeFace(wall, targetOf(wall, targets)) }),
    ),
  ).filter((chain) => chain.some((t) => picked.has(t.wall.id)))
  const planned = chains.flat()
  const runs = facadeRuns(nodes, planned, { continuous: unit.rhythm === 'side' })
  // Columns count from each facade's first corner, so a storey a few centimetres off
  // still draws each column as the storeys above do.
  const corners = new Map<string, number>()
  for (const run of runs) {
    const chain = run.key.slice(0, run.key.lastIndexOf(':'))
    corners.set(chain, Math.min(corners.get(chain) ?? run.start, run.start))
  }
  const variationFor = (run: FacadeRun): FacadeVariationContext => {
    const level = nodes[run.walls[0]!.wall.parentId as string]
    const corner = corners.get(run.key.slice(0, run.key.lastIndexOf(':')))!
    const facing = Math.round((Math.atan2(run.normal[1], run.normal[0]) * 4) / Math.PI)
    return {
      level: level?.type === 'level' ? level.level : 0,
      column: (bay, centre) =>
        `${facing}:${Math.round((run.start + centre - corner) / facadeColumnBin(bay))}`,
    }
  }

  const children = (wall: WallNode) =>
    wall.children.map((id) => nodes[id]).filter((node): node is AnyNode => !!node)
  const dress = mode === 'dress'
  // A set speaks for the walls it stamps; a refit keeps what the wall was given.
  const treatedOf = (wall: WallNode): WallFacade['treated'] => {
    if (sets?.[wall.id]) return treatments?.[wall.id]
    const stored = readWallFacade(wall.metadata)
    return stored?.treated && sameUnit(stored.unit, unit) ? stored.treated : undefined
  }
  const balconiesByOwner = new Map<string, (SlabNode | FenceNode)[]>()
  for (const node of Object.values(nodes)) {
    const owner = node.metadata.facadeOwner
    if ((node.type !== 'slab' && node.type !== 'fence') || typeof owner !== 'string') continue
    balconiesByOwner.set(owner, [...(balconiesByOwner.get(owner) ?? []), node])
  }
  const previousBalconies = new Map(
    planned.map(({ wall }) => [
      wall.id as string,
      indexRepetitions(balconiesByOwner.get(wall.id) ?? [], (node) =>
        String(node.metadata.facadeCell),
      ),
    ]),
  )

  const desiredOpenings = new Map<string, DesiredOpening[]>()
  const desiredBalconies = new Map<string, (SlabNode | FenceNode)[]>()
  const desiredPanels = new Map<string, DesiredPanel[]>()
  const bayByKey = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const push = <T>(map: Map<string, T[]>, key: string, values: T[]) =>
    map.set(key, [...(map.get(key) ?? []), ...values])
  let skipped = 0
  const unlitRooms = new Map<string, string>()
  const litRooms = new Set<string>()
  const displaced = new Map<string, FacadeOpeningNode>()
  /** The style each opening a dress keeps takes from its bay. */
  const dressStyles = new Map<string, FacadeOpeningStyle>()

  for (const run of runs) {
    // Openings placed by hand stay put and the unit flows around them — unless it replaces them.
    // A dress keeps every opening, the ones an earlier fill placed included.
    const existing = run.walls.flatMap((w) =>
      children(w.wall)
        .filter(
          (node): node is FacadeOpeningNode =>
            isOpening(node) &&
            (dress ? !node.metadata.isTransient : node.metadata.facadeOwner !== w.wall.id),
        )
        .map((opening) => {
          const along = w.reversed ? w.to - opening.position[0] : w.from + opening.position[0]
          return {
            node: opening,
            left: along - opening.width / 2 - run.start,
            right: along + opening.width / 2 - run.start,
            bottom: opening.position[1] - opening.height / 2,
            top: opening.position[1] + opening.height / 2,
          }
        }),
    )
    const size = { width: run.end - run.start, height: run.height }
    const variation = variationFor(run)
    const treated = run.walls.map((w) => treatedOf(w.wall)).find(Boolean)
    // A corner chain keeps its width clear: the unit resolves on the run less the chain.
    const inset = (end: FacadeRunEnd) =>
      treated?.reserve && (treated.reserveEnds ?? ['outside']).includes(end as 'outside')
        ? treated.reserve
        : 0
    const [fromStart, fromEnd] = dress ? [0, 0] : [inset(run.ends[0]), inset(run.ends[1])]
    const rooms = !dress && unit.obstacles === 'room' ? roomFrontages(nodes, run) : []
    // In whole-side rhythm, walls meeting the facade from inside are obstacles nothing lands on.
    const partitions: FacadeUnitObstacle[] = (run.partitions ?? []).map(([from, to]) => ({
      left: from - run.start,
      right: to - run.start,
      bottom: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
    }))
    const obstacles: FacadeUnitObstacle[] = [...(replaceExisting ? [] : existing), ...partitions]
    const resolved: { placements: FacadeBayPlacement[]; skipped: number } = dress
      ? dressFacadeUnit(
          unit,
          size,
          existing.map(({ node, left, right, bottom, top }) => ({
            id: node.id,
            kind: node.type,
            left,
            right,
            bottom,
            top,
          })),
          { variation },
        )
      : insetResolve(
          unit,
          size,
          obstacles,
          variation,
          fromStart,
          fromEnd,
          rooms,
          unit.grid === 'building' ? faceGridRegions(nodes, run, unit) : undefined,
        )
    skipped += resolved.skipped
    // A room is dark only when none of its stretches, on any run, has a window: corner
    // apartments on the Victor were reported from a narrow side though lit on the other.
    for (const room of rooms)
      if (
        resolved.placements.some(
          ({ opening }) => opening && opening.right > room.left && opening.left < room.right,
        )
      )
        litRooms.add(room.id ?? room.name)
    for (const room of (resolved as { unlit?: readonly FacadeRoomFrontage[] }).unlit ?? [])
      unlitRooms.set(room.id ?? room.name, room.name || 'An unnamed room')
    if (replaceExisting && !dress)
      for (const { opening } of resolved.placements)
        for (const old of existing)
          if (
            opening &&
            opening.left < old.right &&
            opening.right > old.left &&
            opening.bottom < old.top &&
            opening.top > old.bottom
          )
            displaced.set(old.node.id, old.node)
    // Cladding is surface, so a strip crossing a wall seam becomes one panel per wall.
    // Where bands run, it stops at them rather than running through.
    const floor = treated?.below ?? 0
    const ceiling = run.height - (treated?.above ?? 0)
    const clad = (
      cell: string,
      cladding: FacadeCladding,
      from: number,
      to: number,
      bottom: number,
      top: number,
    ) => {
      const low = Math.max(bottom, floor)
      const high = Math.min(top, ceiling)
      if (high - low < 0.02) return
      for (const w of run.walls) {
        const left = Math.max(run.start + from, w.from)
        const right = Math.min(run.start + to, w.to)
        if (right - left < 0.02) continue
        push(desiredPanels, w.wall.id, [
          {
            cell,
            x: wallLocal(w, (left + right) / 2),
            width: right - left,
            bottom: low,
            top: high,
            cladding,
          },
        ])
      }
    }
    for (const placement of resolved.placements) {
      if (dress && placement.opening)
        dressStyles.set((placement as FacadeDressPlacement).openingId, placement.opening.style)
      else if (placement.opening) {
        const left = run.start + placement.opening.left
        const right = run.start + placement.opening.right
        // An opening straddling two walls could not be cut into either.
        const host = run.walls.find(
          (w) => w.from - HOST_TOLERANCE <= left && right <= w.to + HOST_TOLERANCE,
        )
        if (!host) {
          skipped++
          continue
        }
        push(desiredOpenings, host.wall.id, [
          {
            cell: `${placement.opening.kind}:${run.key}:${placement.key}`,
            opening: placement.opening,
            x: wallLocal(host, (left + right) / 2),
          },
        ])
      }
      if (placement.balcony) {
        const centre = run.start + (placement.balcony.left + placement.balcony.right) / 2
        const host =
          run.walls.find((w) => w.from <= centre && centre <= w.to) ??
          run.walls.reduce((best, w) =>
            Math.abs((w.from + w.to) / 2 - centre) < Math.abs((best.from + best.to) / 2 - centre)
              ? w
              : best,
          )
        push(
          desiredBalconies,
          host.wall.id,
          facadeBalconyNodes({
            run,
            balcony: placement.balcony,
            host: host.wall,
            cell: `balcony:${run.key}:${placement.key}`,
            nodes,
            previous: previousBalconies.get(host.wall.id)!,
          }),
        )
      }
      const base = bayByKey.get(placement.bay)
      const bay = base && bayVariant(base, placement.variant)
      for (const rect of bay ? bayCladdingRects(bay, placement, run.height) : [])
        clad(
          `panel:${run.key}:${placement.key}:${rect.part}`,
          rect.cladding,
          rect.left,
          rect.right,
          rect.bottom,
          rect.top,
        )
    }
    // Piers: what the bays leave of the run, clad proud of their panels.
    if (unit.piers) {
      const spans = resolved.placements
        .map(({ left, right }) => [left, right] as const)
        .sort((a, b) => a[0] - b[0])
      const end = size.width - fromEnd
      let at = fromStart
      let index = 0
      for (const [left, right] of [...spans, [end, end] as const]) {
        if (Math.min(left, end) - at >= 0.02)
          clad(
            `panel:${run.key}:pier-${index++}`,
            unit.piers,
            at,
            Math.min(left, end),
            0,
            run.height,
          )
        at = Math.max(at, right)
      }
    }
  }

  const plans = planned.map(({ wall, face }): FacadeWallPlan => {
    const stored = readWallFacade(wall.metadata)
    const surface = targetOf(wall, targets).surface
    const owned = children(wall).filter(
      (node): node is FacadeOpeningNode => isOpening(node) && node.metadata.facadeOwner === wall.id,
    )
    // A dress owns no opening: the ones an earlier fill placed are released, never removed.
    const openings: RepetitionPlan<FacadeOpeningNode> = dress
      ? { values: [], added: [], updated: [], removed: [] }
      : reconcileRepetitions({
          desired: desiredOpenings.get(wall.id) ?? [],
          previous: indexRepetitions(owned, (node) => String(node.metadata.facadeCell)),
          keyOf: (desired) => desired.cell,
          build: (desired, old) => buildOpening(wall, face, desired, old, unit.paint),
        })
    const dressed: FacadeOpeningNode[] = []
    const restored: FacadeOpeningNode[] = []
    for (const node of children(wall)) {
      if (!isOpening(node) || node.metadata.isTransient || displaced.has(node.id)) continue
      const style = dressStyles.get(node.id)
      if (style) dressed.push(dressOpening(node, style, unit.paint))
      else if (
        node.metadata[FACADE_DRESSED_KEY] ||
        (dress && node.metadata.facadeOwner === wall.id)
      )
        restored.push(restoreOpening(node))
    }
    const ownedPanels = children(wall).filter(
      (node): node is PanelNode => node.type === 'panel' && node.metadata.facadeOwner === wall.id,
    )
    const panels = reconcileRepetitions({
      desired: desiredPanels.get(wall.id) ?? [],
      previous: indexRepetitions(ownedPanels, (node) => String(node.metadata.facadeCell)),
      keyOf: (desired) => desired.cell,
      build: (desired, old) => buildPanel(wall, face, desired, old),
    })
    const balconies = reconcileRepetitions({
      desired: desiredBalconies.get(wall.id) ?? [],
      previous: previousBalconies.get(wall.id)!,
      keyOf: (node) => String(node.metadata.facadeCell),
      build: (node) => node,
    })

    const slots = { ...wall.slots }
    const previousSlots = { ...stored?.previousSlots }
    const appliedSlots = { ...stored?.appliedSlots }
    const paint = unit.paint.wall
    if (paint)
      for (const slot of facadeSurfaceSlots(surface, face)) {
        if (!Object.hasOwn(previousSlots, slot)) previousSlots[slot] = slots[slot] ?? null
        slots[slot] = paint
        appliedSlots[slot] = paint
      }
    const config: WallFacade = {
      unit,
      sourceItemId: sourceItemId ?? stored?.sourceItemId,
      set: sets?.[wall.id] ?? (stored?.set && sameUnit(stored.unit, unit) ? stored.set : undefined),
      mode: dress ? 'dress' : undefined,
      treated: treatedOf(wall),
      surface,
      face,
      layoutFrame: frameOf(wall, runs, nodes, unit, mode, treatedOf(wall)),
      previousSlots,
      appliedSlots,
      detached: false,
    }
    const unchanged =
      JSON.stringify(wall.slots ?? {}) === JSON.stringify(slots) &&
      JSON.stringify(wall.metadata.proceduralFacade) === JSON.stringify(config)
    return {
      wall,
      openings,
      balconies,
      panels,
      dressed,
      restored,
      wallUpdate: unchanged
        ? null
        : { slots, metadata: { ...wall.metadata, proceduralFacade: config } },
    }
  })
  const total = plans.reduce((sum, plan) => sum + plan.openings.values.length, 0)
  if (total > MAX_FACADE_OPENINGS)
    throw Error(`Fill fewer walls at once; this selection exceeds ${MAX_FACADE_OPENINGS} openings.`)
  return {
    walls: plans,
    runs,
    skipped,
    displaced: [...displaced.values()],
    ...unlitList([...unlitRooms].filter(([key]) => !litRooms.has(key)).map(([, name]) => name)),
  }
}

export type FacadeScenePatch =
  | { op: 'create'; node: AnyNode; parentId?: AnyNodeId }
  | { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
  | { op: 'delete'; id: AnyNodeId; cascade?: boolean }

/**
 * A planned fill as one batch of scene patches: removals, then creations, then
 * updates. Applied together they are one write, however many walls the fill
 * covers — the editor's store and the MCP bridges both take this shape.
 */
export function facadeFillPatches(
  plan: FacadeFillPlan,
  nodes: Record<string, AnyNode>,
): FacadeScenePatch[] {
  const removals: FacadeScenePatch[] = plan.displaced.map((node) => ({
    op: 'delete' as const,
    id: node.id as AnyNodeId,
    cascade: true,
  }))
  const creations: FacadeScenePatch[] = []
  const updates: FacadeScenePatch[] = []
  for (const wallPlan of plan.walls) {
    for (const repetition of [
      wallPlan.openings,
      wallPlan.balconies,
      wallPlan.panels,
    ] as RepetitionPlan<AnyNode>[]) {
      for (const node of repetition.removed)
        removals.push({ op: 'delete', id: node.id as AnyNodeId, cascade: true })
      for (const node of repetition.added)
        creations.push({
          op: 'create',
          // The store attaches descendants; pre-populated children would duplicate them.
          node: ('children' in node ? { ...node, children: [] } : node) as AnyNode,
          parentId: (node.parentId ?? undefined) as AnyNodeId | undefined,
        })
      for (const node of repetition.updated)
        if (!areSemanticValuesEqual(nodes[node.id], node))
          updates.push({ op: 'update', id: node.id as AnyNodeId, data: node })
    }
    for (const node of [...wallPlan.dressed, ...wallPlan.restored])
      if (!areSemanticValuesEqual(nodes[node.id], node))
        updates.push({ op: 'update', id: node.id as AnyNodeId, data: node })
    if (wallPlan.wallUpdate)
      updates.push({ op: 'update', id: wallPlan.wall.id as AnyNodeId, data: wallPlan.wallUpdate })
  }
  return [...removals, ...creations, ...updates]
}

/**
 * Take live facades off these walls as patches: what they generated is
 * deleted and the finishes they replaced come back, unless repainted since.
 */
export function facadeRemovalPatches(
  walls: readonly WallNode[],
  nodes: Record<string, AnyNode>,
): FacadeScenePatch[] {
  const live = walls.filter((wall) => readLiveWallFacade(wall.metadata))
  if (!live.length) return []
  const owners = new Set<string>(live.map((wall) => wall.id))
  const deletes: FacadeScenePatch[] = Object.values(nodes)
    .filter((node) => owners.has(node.metadata.facadeOwner as string))
    .map((node) => ({ op: 'delete', id: node.id as AnyNodeId, cascade: true }))
  // A dress never owned its openings: they stay, with their own panes and frame back.
  const restores: FacadeScenePatch[] = live.flatMap((wall) =>
    wall.children
      .map((id) => nodes[id])
      .filter(
        (node): node is FacadeOpeningNode => isOpening(node) && !!node.metadata[FACADE_DRESSED_KEY],
      )
      .map((node) => ({ op: 'update', id: node.id as AnyNodeId, data: restoreOpening(node) })),
  )
  const updates = live.map((wall): FacadeScenePatch => {
    const config = readWallFacade(wall.metadata)!
    const slots = { ...wall.slots }
    for (const [slot, previous] of Object.entries(config.previousSlots ?? {}))
      if (slots[slot] === config.appliedSlots?.[slot]) {
        if (previous === null) delete slots[slot]
        else slots[slot] = previous
      }
    const { proceduralFacade: _, ...metadata } = wall.metadata
    return { op: 'update', id: wall.id as AnyNodeId, data: { slots, metadata } }
  })
  return [...deletes, ...restores, ...updates]
}

/**
 * Detached facades on these walls, taken back so they generate again: what
 * they released when detached is removed — hand edits to it included — and
 * their config is live. Elements added by hand are left as they are. Returns
 * the scene as it would be, for planning, and the nodes to delete.
 */
export function reclaimDetachedFacades(
  walls: readonly WallNode[],
  nodes: Record<string, AnyNode>,
): {
  walls: WallNode[]
  nodes: Record<string, AnyNode>
  removed: AnyNodeId[]
  reclaimed: WallNode[]
} {
  const reclaimed = walls.filter((wall) => readWallFacade(wall.metadata)?.detached)
  if (!reclaimed.length) return { walls: [...walls], nodes, removed: [], reclaimed: [] }
  const ids = new Set<string>(reclaimed.map((wall) => wall.id))
  const removed = Object.values(nodes)
    .filter((node) => ids.has(node.metadata[FACADE_RELEASED_KEY] as string))
    .map((node) => node.id as AnyNodeId)
  const gone = new Set<string>(removed)
  const next: Record<string, AnyNode> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (gone.has(id)) continue
    next[id] =
      'children' in node && node.children.some((child) => gone.has(child))
        ? ({ ...node, children: node.children.filter((child) => !gone.has(child)) } as AnyNode)
        : node
  }
  const live = reclaimed.map((wall) => {
    const { detached: _, detachedReason: __, ...config } = readWallFacade(wall.metadata)!
    const updated = { ...(next[wall.id] as WallNode) }
    updated.metadata = { ...updated.metadata, proceduralFacade: config }
    next[wall.id] = updated
    return updated
  })
  return {
    walls: walls.map((wall) => (next[wall.id] as WallNode) ?? wall),
    nodes: next,
    removed,
    reclaimed: live,
  }
}
