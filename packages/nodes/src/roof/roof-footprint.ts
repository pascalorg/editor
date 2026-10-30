import {
  type AlignmentAnchor,
  type AnyNode,
  emitter,
  getLevelBelow,
  getLevelElevations,
  getWallCurveFrameAt,
  getWallCurveStationAtPoint,
  isCurvedWall,
  isOutdoorRoomType,
  isRailingWall,
  type LevelNode,
  outdoorRoomRoofOutline,
  polygonAnchors,
  type RoofFootprintTarget,
  type RoofType,
  resolveLevelId,
  resolveRoofWallTopElevation,
  resolveRoomRoofFootprint,
  type SeparatorNode,
  type WallEvent,
  type WallNode,
  wallSegmentAnchors,
  type ZoneNode,
} from '@pascal-app/core'
import type { RoofRoomPick } from './roof-footprint-source'

export type RoofFootprintSource = 'room' | 'walls' | 'draw'

const ROOF_AXIS_ALIGNMENT_EPSILON = 1e-4

export function isStandardRoofWallEligible(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
): boolean {
  if (isCurvedWall(wall)) return false
  const deltaX = Math.abs(wall.end[0] - wall.start[0])
  const deltaZ = Math.abs(wall.end[1] - wall.start[1])
  return deltaX <= ROOF_AXIS_ALIGNMENT_EPSILON || deltaZ <= ROOF_AXIS_ALIGNMENT_EPSILON
}

/** A room's edge as the wall snap reads a wall: its ends, its middle and its run catch a point. */
function edgeReference(
  id: string,
  parentId: string | null,
  start: [number, number],
  end: [number, number],
): WallNode {
  return {
    object: 'node',
    id: id as WallNode['id'],
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

/** The levels' invisible walls, and their porches', decks' and patios' outside edges. */
function levelEdges(nodes: Readonly<Record<string, AnyNode>>, levelIds: readonly string[]) {
  return levelIds.flatMap((levelId) => {
    const level = nodes[levelId]
    if (level?.type !== 'level') return []
    const children = level.children.map((id) => nodes[id])
    const walls = children.filter((node): node is WallNode => node?.type === 'wall')
    const separators = children.filter((node): node is SeparatorNode => node?.type === 'separator')
    const rooms = children
      .filter(
        (node): node is ZoneNode =>
          node?.type === 'zone' && isOutdoorRoomType(node.roomType) && node.polygon.length >= 3,
      )
      .map((zone) => ({ zone, ...outdoorRoomRoofOutline(zone, walls, separators) }))
    return [{ levelId, separators, rooms }]
  })
}

const snapEdgesMemo = new WeakMap<object, Map<string, ReturnType<typeof computeRoofSnapEdges>>>()

function computeRoofSnapEdges(
  nodes: Readonly<Record<string, AnyNode>>,
  levelIds: readonly string[],
) {
  const references: WallNode[] = []
  const faced = new Set<string>()
  for (const { levelId, separators, rooms } of levelEdges(nodes, levelIds)) {
    for (const separator of separators)
      references.push(edgeReference(separator.id, levelId, separator.start, separator.end))
    for (const { polygon, edges } of rooms)
      edges.forEach((edge, index) => {
        if (edge?.kind !== 'railing') return
        faced.add(edge.id)
        const next = polygon[(index + 1) % polygon.length]!
        references.push(edgeReference(edge.id, levelId, polygon[index]!, next))
      })
  }
  return { references, faced }
}

/**
 * The rooms' edges on `levelIds` a drawn roof snaps to, as it snaps to walls (their corners,
 * middles, crossings and runs): each invisible wall's line, and each railing round a porch, deck
 * or patio at its outside face, from post corner to post corner (`outdoorRoomRoofOutline`), so a
 * roof drawn over the room reaches its outside edge as one drawn over the house reaches its walls'.
 * `faced` holds those railings: their faces stand in for their centre lines. Kept per scene, so a
 * pointer move asks once.
 */
export function roofSnapEdges(
  nodes: Readonly<Record<string, AnyNode>>,
  levelIds: readonly string[],
): { references: WallNode[]; faced: Set<string> } {
  const key = levelIds.join('|')
  let byKey = snapEdgesMemo.get(nodes)
  if (!byKey) {
    byKey = new Map()
    snapEdgesMemo.set(nodes, byKey)
  }
  const cached = byKey.get(key)
  if (cached) return cached
  const edges = computeRoofSnapEdges(nodes, levelIds)
  byKey.set(key, edges)
  return edges
}

/**
 * The rooms' edges on `levelIds` as alignment anchors for a roof drawn over them: each straight
 * invisible wall's ends and middle (as a wall's), and each porch's, deck's or patio's outside
 * corners, railings' post corners included.
 */
export function roofEdgeAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  levelIds: readonly string[],
): AlignmentAnchor[] {
  return levelEdges(nodes, levelIds).flatMap(({ separators, rooms }) => [
    ...separators
      .filter((separator) => isStandardRoofWallEligible(separator))
      .flatMap((separator) => wallSegmentAnchors(separator.id, separator.start, separator.end)),
    ...rooms.flatMap(({ zone, polygon }) => polygonAnchors(zone.id, polygon)),
  ])
}

/** What a Room pick lights up while it hovers a room: its walls, a porch's edges with them. */
export function roofFootprintPreviewIds(target: RoofFootprintTarget | null): string[] {
  return target ? [...target.wallIds, ...(target.edgeIds ?? [])] : []
}

export function isConicalRoofWallEligible(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const completeNodes = nodes as Record<string, AnyNode>
  const sourceLevelId = resolveLevelId(wall, completeNodes)
  if (!sourceLevelId) return false
  if (sourceLevelId === targetLevelId) return true
  return getLevelBelow(targetLevelId, completeNodes)?.id === sourceLevelId
}

// As far off the wall's centreline as the plan reaches for a wall a door or window goes in.
const CONICAL_WALL_PICK_DISTANCE = 0.5

/**
 * The curved wall a cone would be built over from a plan point: the nearest one in reach on the
 * level or the level below. The plan raises no wall events, so its tool picks the wall itself.
 */
export function pickConicalRoofWall(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): WallNode | null {
  let picked: WallNode | null = null
  let pickedDistance = CONICAL_WALL_PICK_DISTANCE
  for (const node of Object.values(nodes)) {
    if (!(node.type === 'wall' && isCurvedWall(node))) continue
    if (!isConicalRoofWallEligible(levelId, node, nodes)) continue
    const nearest = getWallCurveFrameAt(node, getWallCurveStationAtPoint(node, point)).point
    const distance = Math.hypot(point[0] - nearest.x, point[1] - nearest.y)
    if (distance > pickedDistance) continue
    picked = node
    pickedDistance = distance
  }
  return picked
}

export function parseRoofFootprintSource(value: unknown, roofType: RoofType): RoofFootprintSource {
  if (roofType === 'conical') return 'walls'
  return value === 'room' ? 'room' : 'draw'
}

/**
 * The room a Room pick at `point` roofs (the smallest one on the level, else on the level below),
 * and what the pick found: a rectangle it roofs, a room it can't (not a rectangle), or none.
 */
export function pickRoofRoom(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): { target: RoofFootprintTarget | null; pick: RoofRoomPick } {
  const found = resolveRoomRoofFootprint(levelId, nodes, point)
  if (!found) return { target: null, pick: 'none' }
  return found.rectangular ? { target: found, pick: 'room' } : { target: null, pick: 'irregular' }
}

export function subscribeToConicalRoofWallClicks(options: {
  footprintSource: RoofFootprintSource
  currentLevelId: LevelNode['id'] | null
  getNodes: () => Readonly<Record<string, AnyNode>>
  onPreview?: (wall: WallNode | null) => void
  onSelect: (wall: WallNode) => void
  roofType: RoofType
}): () => void {
  if (!(options.roofType === 'conical' && options.footprintSource === 'walls')) return () => {}

  let previewedWallId: WallNode['id'] | null = null
  const onWallHover = (event: WallEvent) => {
    const wall =
      isCurvedWall(event.node) &&
      options.currentLevelId &&
      isConicalRoofWallEligible(options.currentLevelId, event.node, options.getNodes())
        ? event.node
        : null
    const nextId = wall?.id ?? null
    if (nextId === previewedWallId) return
    previewedWallId = nextId
    options.onPreview?.(wall)
  }
  const onWallLeave = (event: WallEvent) => {
    if (event.node.id !== previewedWallId) return
    previewedWallId = null
    options.onPreview?.(null)
  }
  const onWallClick = (event: WallEvent) => {
    if (
      !isCurvedWall(event.node) ||
      !options.currentLevelId ||
      !isConicalRoofWallEligible(options.currentLevelId, event.node, options.getNodes())
    ) {
      return
    }
    event.stopPropagation()
    options.onSelect(event.node)
  }
  emitter.on('wall:enter', onWallHover)
  emitter.on('wall:move', onWallHover)
  emitter.on('wall:leave', onWallLeave)
  emitter.on('wall:click', onWallClick)
  return () => {
    emitter.off('wall:enter', onWallHover)
    emitter.off('wall:move', onWallHover)
    emitter.off('wall:leave', onWallLeave)
    emitter.off('wall:click', onWallClick)
  }
}

export function resolveRoofFootprintElevation(
  targetLevelId: LevelNode['id'],
  target: RoofFootprintTarget,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(completeNodes)
  // A railing is a guard round a deck or a porch, not a wall: the roof never sits on its top.
  const tops = target.wallIds.flatMap((id) => {
    const wall = nodes[id]
    return wall?.type === 'wall' && !isRailingWall(wall)
      ? [resolveRoofWallTopElevation(targetLevelId, wall, completeNodes, elevations)]
      : []
  })
  return tops.length ? Math.max(...tops) : 0
}

export function resolveRoofFootprintWorldElevation(
  targetLevelId: LevelNode['id'],
  target: RoofFootprintTarget,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(completeNodes)
  return (
    (elevations.get(targetLevelId)?.baseY ?? 0) +
    resolveRoofFootprintElevation(targetLevelId, target, nodes)
  )
}

/**
 * World/building-local Y for a wall-top preview rendered outside a level node.
 *
 * Roof nodes are parented to a level, so their stored position is relative to
 * that level's floor. The conical wall hover ghost is rendered directly in the
 * building group instead, and therefore needs the active level's world base
 * added back after resolving the level-relative placement.
 */
export function resolveRoofWallTopWorldElevation(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations = getLevelElevations(nodes as Record<string, AnyNode>),
): number {
  return (
    (elevations.get(targetLevelId)?.baseY ?? 0) +
    resolveRoofWallTopElevation(targetLevelId, wall, nodes, elevations)
  )
}
