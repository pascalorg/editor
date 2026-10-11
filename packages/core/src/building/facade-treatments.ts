import type { SpaceBoundaryFace } from '../lib/room-graph'
import {
  type AnyNode,
  type AnyNodeId,
  type FacadeNode,
  type LevelNode,
  PanelNode,
  type WallNode,
} from '../schema'
import { getLevelElevations } from '../services/storey'
import type { WallFacade } from '../systems/facade/facade-config'
import type { FacadeBand, FacadeCorner, FacadeSet } from '../systems/facade/facade-set'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { indexRepetitions, reconcileRepetitions } from '../utils/repetition'
import { areSemanticValuesEqual } from '../utils/semantic-equal'
import type { FacadeScenePatch } from './facade'
import { buildingLevels, loopWalls, outsideLoop, wallsByLevel } from './facade-loops'
import { type FacadeRun, type FacadeTargetWall, facadeRuns } from './facade-runs'

/** A storey the facade treats: its outside loop's walls and where it stands. */
export type FacadeStorey = {
  level: LevelNode
  /** Absolute height of its floor, and its floor-to-floor height. */
  baseY: number
  height: number
  targets: FacadeTargetWall[]
  lowest: boolean
  highest: boolean
  /** The storey just under the highest. */
  belowTop: boolean
}

/** Thinner or shorter than this, a treatment piece is a sliver, not a panel. */
const MIN_PIECE = 0.02
/** Joint between courses where the chain has joints (or is rusticated). */
const JOINT = 0.015
const CAPITAL = 0.3

/**
 * The storeys a facade's corners and bands run on: every storey with walls
 * between the lowest and highest its areas span, each with its outside loop.
 * A storey whose walls do not close gets nothing and is returned as missing.
 */
export function facadeTreatedStoreys(
  facade: FacadeNode,
  nodes: Record<string, AnyNode>,
  loopOf?: (levelId: string) => SpaceBoundaryFace[] | null,
): { storeys: FacadeStorey[]; missing: LevelNode[] } {
  const byLevel = wallsByLevel(nodes)
  const levels = buildingLevels(nodes, facade.parentId as string)
  const spanned = facade.areas.flatMap((area) => {
    const from = levels.findIndex((level) => level.id === area.from)
    const to = levels.findIndex((level) => level.id === area.to)
    return from < 0 || to < 0 ? [] : [Math.min(from, to), Math.max(from, to)]
  })
  if (!spanned.length) return { storeys: [], missing: [] }
  const withWalls = levels
    .slice(Math.min(...spanned), Math.max(...spanned) + 1)
    .filter((level) => byLevel.get(level.id)?.length)
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const storeys: FacadeStorey[] = []
  const missing: LevelNode[] = []
  withWalls.forEach((level, index) => {
    const loop = loopOf ? loopOf(level.id) : outsideLoop(byLevel.get(level.id)!)
    if (!loop) {
      missing.push(level)
      return
    }
    storeys.push({
      level,
      baseY: elevations.get(level.id)?.baseY ?? 0,
      height: elevations.get(level.id)?.height ?? 3,
      targets: loopWalls(loop, nodes).fits,
      lowest: index === 0,
      highest: index === withWalls.length - 1,
      belowTop: index === withWalls.length - 2,
    })
  })
  return { storeys, missing }
}

type Placed = { band: FacadeBand; index: number; at: 'bottom' | 'top' }

/** The bands a storey carries, at its floor or its ceiling. */
function bandsOn(set: FacadeSet, storey: FacadeStorey): Placed[] {
  return (set.bands ?? []).flatMap((band, index): Placed[] => {
    if (band.kind === 'base') return storey.lowest ? [{ band, index, at: 'bottom' }] : []
    if (band.kind === 'cornice') return storey.highest ? [{ band, index, at: 'top' }] : []
    const on =
      band.at === 'above-first'
        ? storey.lowest && !storey.highest
        : band.at === 'below-top'
          ? storey.belowTop
          : !storey.highest
    return on ? [{ band, index, at: 'top' }] : []
  })
}

/**
 * What the set's corners and bands ask of each wall on the treated storeys: the
 * width a chain keeps clear at the corners it dresses, and how far cladding
 * stays from the floor and ceiling where bands run.
 */
export function facadeWallTreatments(set: FacadeSet, storeys: readonly FacadeStorey[]) {
  const corner = set.corners?.[0]
  const treated = new Map<string, NonNullable<WallFacade['treated']>>()
  for (const storey of storeys) {
    const bands = bandsOn(set, storey)
    const below = Math.max(0, ...bands.filter((b) => b.at === 'bottom').map((b) => b.band.height))
    const above = Math.max(0, ...bands.filter((b) => b.at === 'top').map((b) => b.band.height))
    const entry: NonNullable<WallFacade['treated']> = {
      ...(corner ? { reserve: corner.long, reserveEnds: corner.edges } : {}),
      ...(below ? { below } : {}),
      ...(above ? { above } : {}),
    }
    if (!Object.keys(entry).length) continue
    for (const { wall } of storey.targets) treated.set(wall.id, entry)
  }
  return treated
}

type DesiredPiece = {
  cell: string
  wall: WallNode
  face: FacadeTargetWall['face']
  x: number
  width: number
  bottom: number
  top: number
  thickness: number
  material: string
  name: string
}

const wallLocal = (w: FacadeRun['walls'][number], along: number) =>
  w.reversed ? w.to - along : along - w.from

/** A strip along a run, as one piece per wall it crosses. */
function piecesAlong(
  run: FacadeRun,
  faces: ReadonlyMap<string, FacadeTargetWall['face']>,
  from: number,
  to: number,
  piece: Omit<DesiredPiece, 'cell' | 'wall' | 'face' | 'x' | 'width'> & { cell: string },
): DesiredPiece[] {
  // The face runs past the centrelines at an outside corner: the end walls carry that bit.
  const first = Math.min(...run.walls.map((w) => w.from))
  const last = Math.max(...run.walls.map((w) => w.to))
  return run.walls.flatMap((w) => {
    const left = Math.max(from, w.from === first ? Math.min(w.from, run.start) : w.from)
    const right = Math.min(to, w.to === last ? Math.max(w.to, run.end) : w.to)
    if (right - left < MIN_PIECE || piece.top - piece.bottom < MIN_PIECE) return []
    return [
      {
        ...piece,
        cell: `${piece.cell}:${w.wall.id}`,
        wall: w.wall,
        face: faces.get(w.wall.id)!,
        x: wallLocal(w, (left + right) / 2),
        width: right - left,
      },
    ]
  })
}

/** The chain's pieces at one corner end of a run, for one storey. */
function chainPieces(
  corner: FacadeCorner,
  run: FacadeRun,
  end: 0 | 1,
  side: 'a' | 'b',
  faces: ReadonlyMap<string, FacadeTargetWall['face']>,
  storey: FacadeStorey,
  extent: [number, number],
  cell: string,
): DesiredPiece[] {
  const floor = Math.max(storey.baseY, extent[0])
  const ceiling = Math.min(storey.baseY + run.height, extent[1])
  if (ceiling - floor < MIN_PIECE) return []
  const along = (leg: number): [number, number] =>
    end === 0 ? [run.start, run.start + leg] : [run.end - leg, run.end]
  const thickness = Math.max(0.005, corner.relief)
  const piece = (
    leg: number,
    bottom: number,
    top: number,
    name: string,
    suffix: string,
    depth = thickness,
  ) =>
    piecesAlong(run, faces, ...along(leg), {
      cell: `${cell}:${suffix}`,
      bottom: bottom - storey.baseY,
      top: top - storey.baseY,
      thickness: depth,
      material: corner.material,
      name,
    }).map((p) => ({ ...p, cell: `${p.cell}:${side}` }))

  if (corner.kind === 'droite' || corner.kind === 'pilaster') {
    const shaft = piece(corner.long, floor, ceiling, 'Corner chain', 'shaft')
    if (corner.kind !== 'pilaster' || !storey.highest) return shaft
    const capital = piece(
      corner.long + 0.12,
      Math.max(floor, ceiling - CAPITAL),
      ceiling,
      'Pilaster capital',
      'capital',
      thickness * 2,
    )
    return [...shaft, ...capital]
  }
  // Courses on absolute height, so the chain runs through storey lines; a harpée's
  // long and short blocks alternate course by course, and the two faces take opposite legs.
  const gap = corner.joint === 'none' ? (corner.kind === 'bossage' ? JOINT : 0) : JOINT
  const pieces: DesiredPiece[] = []
  for (let k = Math.floor(floor / corner.course); k * corner.course < ceiling; k++) {
    const bottom = Math.max(floor, k * corner.course)
    const top = Math.min(ceiling, (k + 1) * corner.course - gap)
    if (top - bottom < MIN_PIECE) continue
    const long = (k % 2 === 0) === (side === 'a')
    pieces.push(
      ...piece(long ? corner.long : corner.short, bottom, top, 'Corner chain', `course-${k}`),
    )
  }
  return pieces
}

/**
 * Panels for a set's corner chains and bands, reconciled with those the facade
 * node already owns: re-applying keeps their ids and changes nothing. Pieces are
 * owned by the facade node, so a wall's own refit never touches them.
 */
export function facadeTreatmentPatches(
  facade: FacadeNode,
  nodes: Record<string, AnyNode>,
  storeys: readonly FacadeStorey[] = facadeTreatedStoreys(facade, nodes).storeys,
): FacadeScenePatch[] {
  const { set } = facade
  const corner = set.corners?.[0]
  const desired: DesiredPiece[] = []
  const lowest = storeys.find((s) => s.lowest)
  const highest = storeys.find((s) => s.highest)
  const baseBand = (set.bands ?? []).find((b) => b.kind === 'base')
  const cornice = (set.bands ?? []).find((b) => b.kind === 'cornice')

  for (const storey of storeys) {
    const targets = storey.targets.flatMap(({ wall, face }) => {
      const current = nodes[wall.id]
      return current?.type === 'wall' ? [{ wall: current, face }] : []
    })
    const faces = new Map(targets.map((t) => [t.wall.id as string, t.face]))
    // One rhythm per side: walls meeting the facade from inside do not cut a band or a chain.
    const runs = facadeRuns(nodes, targets, { continuous: true })

    for (const { band, index, at } of bandsOn(set, storey))
      for (const run of runs)
        desired.push(
          ...piecesAlong(run, faces, run.start, run.end, {
            cell: `band:${band.kind}:${storey.level.id}:${index}:${run.key}`,
            bottom: at === 'bottom' ? 0 : run.height - band.height,
            top: at === 'bottom' ? band.height : run.height,
            thickness: band.depth,
            material: band.material,
            name:
              band.kind === 'base'
                ? 'Base band'
                : band.kind === 'cornice'
                  ? 'Cornice'
                  : 'String course',
          }),
        )

    if (!corner || !lowest || !highest) continue
    const extent: [number, number] = [
      lowest.baseY + (corner.from === 'base' && baseBand ? baseBand.height : 0),
      highest.baseY + highest.height - (corner.to === 'cornice' && cornice ? cornice.height : 0),
    ]
    // Corners are where two faces' runs meet: group run ends by the point they reach.
    type End = { run: FacadeRun; end: 0 | 1; point: [number, number] }
    const ends: End[][] = []
    for (const run of runs)
      for (const end of [0, 1] as const) {
        const kind = run.ends[end]
        if (kind !== 'outside' && kind !== 'inside') continue
        if (!corner.edges.includes(kind)) continue
        // The two faces meet at the corner of their faces, not of their centrelines.
        const at = end === 0 ? run.start : run.end
        const half = (run.walls[0]!.wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2
        const point: [number, number] = [
          run.origin[0] + run.direction[0] * at + run.normal[0] * half,
          run.origin[1] + run.direction[1] * at + run.normal[1] * half,
        ]
        // Within a few centimetres is the same corner: rounding would split one on a boundary.
        const meeting = ends.find(
          (group) =>
            Math.hypot(group[0]!.point[0] - point[0], group[0]!.point[1] - point[1]) < 0.05,
        )
        if (meeting) meeting.push({ run, end, point })
        else ends.push([{ run, end, point }])
      }
    const corners = [...ends].sort(
      (a, b) => a[0]!.point[0] - b[0]!.point[0] || a[0]!.point[1] - b[0]!.point[1],
    )
    corners.forEach((meeting, index) => {
      const sides = [...meeting].sort((a, b) => a.run.key.localeCompare(b.run.key))
      for (const [i, { run, end }] of sides.entries())
        desired.push(
          ...chainPieces(
            corner,
            run,
            end,
            i === 0 ? 'a' : 'b',
            faces,
            storey,
            extent,
            `corner:${storey.level.id}:${index}`,
          ),
        )
    })
  }

  const previous = Object.values(nodes).filter(
    (node): node is PanelNode => node.type === 'panel' && node.metadata.facadeOwner === facade.id,
  )
  const plan = reconcileRepetitions({
    desired,
    previous: indexRepetitions(previous, (node) => String(node.metadata.facadeCell)),
    keyOf: (piece) => piece.cell,
    build: (piece, old) =>
      PanelNode.parse({
        ...old,
        name: piece.name,
        parentId: piece.wall.id,
        wallId: piece.wall.id,
        side: piece.face,
        position: [piece.x, (piece.bottom + piece.top) / 2, 0],
        width: piece.width,
        height: piece.top - piece.bottom,
        thickness: piece.thickness,
        offset: 0,
        slots: { ...old?.slots, surface: piece.material },
        metadata: { ...old?.metadata, facadeOwner: facade.id, facadeCell: piece.cell },
      }),
  })
  return [
    ...plan.removed.map((node): FacadeScenePatch => ({ op: 'delete', id: node.id as AnyNodeId })),
    ...plan.added.map(
      (node): FacadeScenePatch => ({
        op: 'create',
        node,
        parentId: node.parentId as AnyNodeId,
      }),
    ),
    ...plan.updated
      .filter((node) => !areSemanticValuesEqual(nodes[node.id], node))
      .map((node): FacadeScenePatch => ({ op: 'update', id: node.id as AnyNodeId, data: node })),
  ]
}
