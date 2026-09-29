import type { AnyNode, DoorNode, SlabNode, WallNode, WindowNode } from '../schema'
import { getWallPlaneTop } from '../services/storey'
import {
  computeWallSlabSupport,
  type WallSlabSupport,
  type WallSlabSupportSegment,
} from '../systems/slab/slab-support'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { resolveWallTop } from '../systems/wall/wall-top'
import {
  isFloorAnchoredOpening,
  openingAperture,
  wallOpeningBand,
} from './floor-opening-footprints'
import { area, intersection, union } from './polygon-boolean'
import { levelBaseElevationAt } from './terrain-support-query'

const supportCache = new WeakMap<
  Readonly<Record<string, AnyNode>>,
  Map<WallNode, WallSlabSupport>
>()
const childrenCache = new WeakMap<
  Readonly<Record<string, AnyNode>>,
  Map<string, { walls: WallNode[]; slabs: SlabNode[] }>
>()

export function wallSupportForNodes(
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
): WallSlabSupport {
  let cached = supportCache.get(nodes)
  if (!cached) {
    cached = new Map()
    supportCache.set(nodes, cached)
  }
  const previous = cached.get(wall)
  if (previous) return previous
  let levels = childrenCache.get(nodes)
  if (!levels) {
    levels = new Map()
    childrenCache.set(nodes, levels)
  }
  let level = levels.get(wall.parentId!)
  if (!level) {
    const children = Object.values(nodes)
      .filter((node) => node.parentId === wall.parentId)
      .sort((a, b) => a.id.localeCompare(b.id))
    level = {
      walls: children.filter((n): n is WallNode => n.type === 'wall'),
      slabs: children.filter((n): n is SlabNode => n.type === 'slab'),
    }
    levels.set(wall.parentId!, level)
  }
  const ground = levelBaseElevationAt(nodes, wall.parentId!, wall.start[0], wall.start[1])
  const result = computeWallSlabSupport(
    wall,
    level.slabs,
    level.walls,
    wall.supportSlabId,
    undefined,
    ground,
    nodes,
  )
  cached.set(wall, result)
  return result
}

export function supportSegmentAt(segment: WallSlabSupportSegment, t: number): number {
  return (
    segment.elevation +
    ((t - segment.start) / (segment.end - segment.start)) *
      ((segment.endElevation ?? segment.elevation) - segment.elevation)
  )
}

export function openingDatumFromSupport(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'width' | 'height'>,
  support: WallSlabSupport,
): number {
  if (!isFloorAnchoredOpening(opening)) return support.elevation
  const length = getWallCurveLength(wall)
  const from = Math.max(0, (opening.position[0] - opening.width / 2) / length)
  const to = Math.min(1, (opening.position[0] + opening.width / 2) / length)
  const heights = [...support.faceDatum.a, ...support.faceDatum.b].flatMap((segment) => {
    const start = Math.max(from, segment.start),
      end = Math.min(to, segment.end)
    return end > start ? [supportSegmentAt(segment, start), supportSegmentAt(segment, end)] : []
  })
  return heights.length ? Math.max(...heights) : support.elevation
}

/** Unclamped floor intent, used by authoring feasibility and legacy migration. */
export function getOpeningFloorTarget(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'width' | 'height'>,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  return openingDatumFromSupport(wall, opening, wallSupportForNodes(wall, nodes))
}

export function openingFitsAtDatum(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'height'>,
  datum: number,
  nodes: Readonly<Record<string, AnyNode>>,
  support = wallSupportForNodes(wall, nodes),
): boolean {
  const top = resolveWallTop(wall, getWallPlaneTop(wall, wall.parentId!, nodes), support.elevation)
  return datum + opening.position[1] + opening.height / 2 <= top + 1e-9
}

export function getOpeningFloorDatum(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'width' | 'height'>,
  nodes: Readonly<Record<string, AnyNode>>,
  support = wallSupportForNodes(wall, nodes),
): number {
  const target = openingDatumFromSupport(wall, opening, support)
  if (target === support.elevation) return target
  return openingFitsAtDatum(wall, opening, target, nodes, support) ? target : support.elevation
}

const cutPlans = new WeakMap<
  Readonly<Record<string, AnyNode>>,
  Map<
    string,
    { footprints: Map<string, [number, number][]>; covers: Map<number, ReturnType<typeof union>> }
  >
>()

export function getOpeningWallCut(
  wall: WallNode,
  opening: DoorNode | WindowNode,
  nodes: Readonly<Record<string, AnyNode>>,
  support = wallSupportForNodes(wall, nodes),
) {
  let levels = cutPlans.get(nodes)
  if (!levels) {
    levels = new Map()
    cutPlans.set(nodes, levels)
  }
  let plan = levels.get(wall.parentId!)
  if (!plan) {
    const walls = Object.values(nodes).filter(
      (n): n is WallNode => n.type === 'wall' && n.parentId === wall.parentId,
    )
    if (!walls.some((w) => w.id === wall.id)) walls.push(wall)
    const miters = calculateLevelMiters(walls)
    const footprints = new Map(
      walls.map((w) => [
        w.id as string,
        getWallPlanFootprint(w, miters).map(({ x, y }): [number, number] => [x, y]),
      ]),
    )
    plan = { footprints, covers: new Map() }
    levels.set(wall.parentId!, plan)
  }
  const { footprints, covers } = plan
  const aperture = openingAperture(wall, opening, footprints)
  const datum = getOpeningFloorDatum(wall, opening, nodes, support)
  const cover =
    covers.get(datum) ??
    union(
      Object.values(nodes).flatMap((n) =>
        n.type === 'slab' &&
        n.parentId === wall.parentId &&
        n.support !== 'open' &&
        Math.abs(n.elevation - datum) < 0.001 - 1e-9
          ? [{ outer: n.polygon, holes: n.holes }]
          : [],
      ),
    )
  covers.set(datum, cover)
  const covered =
    area(aperture) > 0 && area(intersection(aperture, cover)) >= area(aperture) - 0.00001
  const length = getWallCurveLength(wall)
  const from = (opening.position[0] - opening.width / 2) / length,
    to = (opening.position[0] + opening.width / 2) / length
  const bottoms = [...support.faceBottom.a, ...support.faceBottom.b]
    .filter((s) => s.end > from && s.start < to)
    .map((s) => Math.min(s.elevation, s.endElevation ?? s.elevation))
  const bottom =
    isFloorAnchoredOpening(opening) && covered
      ? Math.min(support.elevation, ...bottoms)
      : datum + opening.position[1] - opening.height / 2
  return {
    // The floor the doorway exposes: exactly the wall's own footprint.
    aperture,
    // What the wall body loses: the same span, overshooting both faces.
    band: wallOpeningBand(wall, Math.max(0, from), Math.min(1, to)),
    datum,
    bottom,
    top: datum + opening.position[1] + opening.height / 2,
    covered,
  }
}

export function getOpeningWallPlacement(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'width' | 'height' | 'rotation'> & {
    metadata?: Record<string, unknown>
  },
  nodes: Readonly<Record<string, AnyNode>>,
) {
  if (opening.metadata?.curvedWindowMaster || getWallCurveLength(wall) < 1e-6)
    return { position: opening.position, rotation: opening.rotation }
  const frame = getWallCurveFrameAt(wall, opening.position[0] / getWallCurveLength(wall))
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]),
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  const offset = getWallBodyCenterOffset(wall) + opening.position[2]
  const dx = frame.point.x + frame.normal.x * offset - wall.start[0],
    dz = frame.point.y + frame.normal.y * offset - wall.start[1]
  return {
    position: [
      dx * cos + dz * sin,
      opening.position[1] +
        getOpeningFloorDatum(wall, opening, nodes) -
        wallSupportForNodes(wall, nodes).elevation,
      -dx * sin + dz * cos,
    ] as [number, number, number],
    rotation: [
      opening.rotation[0],
      opening.rotation[1] + angle - Math.atan2(frame.tangent.y, frame.tangent.x),
      opening.rotation[2],
    ] as [number, number, number],
  }
}
