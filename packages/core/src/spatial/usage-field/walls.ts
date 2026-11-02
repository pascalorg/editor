import { getOpeningWallCut, wallSupportForNodes } from '../../lib/opening-floor-datum'
import { difference, intersection, type MultiPolygon, union } from '../../lib/polygon-boolean'
import { wallFaceBaseOffset } from '../../lib/wall-face-script'
import type { AnyNode, DoorNode, WallNode, WindowNode } from '../../schema'
import {
  getWallTrimFaces,
  WALL_TRIM_DEFAULTS,
  type WallFace,
  type WallTrimConfig,
  type WallTrimKind,
} from '../../schema/nodes/wall'
import { getWallTop } from '../../services/storey'
import { isCurvedWall } from '../../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../../systems/wall/wall-footprint'
import { getWallFaceLine } from '../../systems/wall/wall-frame'
import { TRIM_PROFILES } from '../../systems/wall/wall-trim-profiles'
import type { Prism, Ring } from './types'

export type Nodes = Readonly<Record<string, AnyNode>>

/** Lengths below this are rounding, not geometry: a piece thinner than it is not an obstacle. */
const MIN_PIECE_M = 0.005
/** The wall's trims are drawn in slices of at least this projection (`MIN_SLICE_PROUD` in the trim builder). */
const MIN_SLICE_PROUD = 0.0005

export const isOpening = (node: AnyNode | undefined): node is DoorNode | WindowNode =>
  node?.type === 'door' || node?.type === 'window'

export function levelWalls(nodes: Nodes, levelId: string): WallNode[] {
  return Object.values(nodes)
    .filter(
      (node): node is WallNode =>
        node.type === 'wall' && node.parentId === levelId && node.visible !== false,
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

const toRing = (points: readonly { x: number; y: number }[]): Ring =>
  points.map(({ x, y }) => [x, y] as [number, number])

function pushPieces(
  out: Prism[],
  pieces: MultiPolygon,
  base: Omit<Prism, 'outer' | 'holes' | 'id'> & { id: string },
) {
  for (const [index, piece] of pieces.entries())
    out.push({
      ...base,
      id: `${base.id}${pieces.length > 1 ? `.${index}` : ''}`,
      outer: piece.outer,
      holes: piece.holes,
    })
}

/**
 * The wall bodies of one level: each wall's mitred footprint over its height, less the bands its
 * doors and windows cut, with the pieces left below a sill and above a head. Heights are level-local:
 * from the wall's elected base (`wallSupportForNodes`) to its top (`getWallTop`), the same two
 * numbers the wall renderer reads.
 */
export function wallBodies(
  nodes: Nodes,
  levelId: string,
  walls = levelWalls(nodes, levelId),
): Prism[] {
  const out: Prism[] = []
  const miters = calculateLevelMiters(walls)
  for (const wall of walls) {
    const footprint = toRing(getWallPlanFootprint(wall, miters))
    if (footprint.length < 3) continue
    const support = wallSupportForNodes(wall, nodes)
    const base = support.elevation
    const top = getWallTop(wall, levelId, nodes as never, base)
    if (!(top - base > MIN_PIECE_M)) continue
    const cuts = (wall.children ?? [])
      .map((id) => nodes[id])
      .filter(isOpening)
      .map((opening) => ({ opening, cut: getOpeningWallCut(wall, opening, nodes, support) }))
      .filter(({ cut }) => cut.band.length >= 3)
    const bands = cuts.length ? union(cuts.map(({ cut }) => cut.band)) : []
    const common = { nodeId: wall.id, kind: 'wall' as const, shape: 'exact' as const }
    pushPieces(out, difference(footprint, bands), {
      ...common,
      id: `${wall.id}#body`,
      z0: base,
      z1: top,
    })
    for (const { opening, cut } of cuts) {
      const inBand = intersection(footprint, cut.band)
      if (cut.bottom - base > MIN_PIECE_M)
        pushPieces(out, inBand, {
          ...common,
          id: `${wall.id}#below:${opening.id}`,
          z0: base,
          z1: Math.min(cut.bottom, top),
        })
      if (top - cut.top > MIN_PIECE_M)
        pushPieces(out, inBand, {
          ...common,
          id: `${wall.id}#above:${opening.id}`,
          z0: Math.max(cut.top, base),
          z1: top,
        })
    }
  }
  return out
}

/** How far a trim stands out, at most, over its height: the profile's own samples, as the trim builder cuts them. */
export function trimProjection(kind: WallTrimKind, trim: WallTrimConfig): number {
  const profile =
    TRIM_PROFILES[kind][trim.profile] ??
    TRIM_PROFILES[kind][WALL_TRIM_DEFAULTS[kind].profile] ??
    TRIM_PROFILES[kind].flat
  if (!profile) return trim.proud
  let widest = MIN_SLICE_PROUD
  for (let index = 0; index < profile.samples; index += 1)
    widest = Math.max(widest, trim.proud * profile.proudAt((index + 0.5) / profile.samples))
  return widest
}

const TRIM_KINDS: WallTrimKind[] = ['skirting', 'crown', 'chairRail']

/**
 * A wall's skirting, chair rail and crown as thin prisms standing on the faces they are drawn on,
 * cut where a door opens through their height. Straight walls only: a curved wall's trim is left
 * out and the wall named in `skipped`.
 */
export function wallTrims(
  nodes: Nodes,
  levelId: string,
  walls = levelWalls(nodes, levelId),
): { prisms: Prism[]; skipped: string[] } {
  const prisms: Prism[] = []
  const skipped: string[] = []
  for (const wall of walls) {
    const configs = TRIM_KINDS.flatMap((kind) => {
      const trim = { ...WALL_TRIM_DEFAULTS[kind], ...(wall[kind] ?? {}) } as WallTrimConfig
      return trim.enabled ? [{ kind, trim }] : []
    })
    if (!configs.length) continue
    if (isCurvedWall(wall)) {
      skipped.push(wall.id)
      continue
    }
    const support = wallSupportForNodes(wall, nodes)
    const top = getWallTop(wall, levelId, nodes as never, support.elevation)
    const openings = (wall.children ?? [])
      .map((id) => nodes[id])
      .filter(isOpening)
      .map((opening) => ({ opening, cut: getOpeningWallCut(wall, opening, nodes, support) }))
      .filter(({ cut }) => cut.band.length >= 3)
    for (const { kind, trim } of configs) {
      const proud = trimProjection(kind, trim)
      for (const face of getWallTrimFaces(trim.sides) as WallFace[]) {
        const line = getWallFaceLine(wall, face)
        const dx = line.end.x - line.start.x
        const dz = line.end.y - line.start.y
        const length = Math.hypot(dx, dz)
        if (length < 1e-9) continue
        // face a is the wall's left (+normal), b its right
        const sign = face === 'a' ? 1 : -1
        const nx = (-dz / length) * sign * proud
        const nz = (dx / length) * sign * proud
        const strip: Ring = [
          [line.start.x, line.start.y],
          [line.end.x, line.end.y],
          [line.end.x + nx, line.end.y + nz],
          [line.start.x + nx, line.start.y + nz],
        ]
        const floor = support.elevation + wallFaceBaseOffset(support, face)
        const z0 =
          kind === 'crown'
            ? top - trim.height
            : kind === 'chairRail'
              ? floor + (trim.offsetY ?? 0)
              : floor
        const z1 = z0 + trim.height
        // a door opens through the trim's height where its own span meets it: the trim stops at the jambs
        const crossing = openings
          .filter(({ cut }) => cut.bottom < z1 && cut.top > z0)
          .map(({ cut }) => cut.band)
        const pieces = crossing.length
          ? difference(strip, union(crossing))
          : [{ outer: strip, holes: [] }]
        pushPieces(prisms, pieces, {
          id: `${wall.id}#${kind}.${face}`,
          nodeId: wall.id,
          kind: 'wall-trim',
          z0,
          z1,
          shape: 'exact',
          host: { wallId: wall.id, face },
        })
      }
    }
  }
  return { prisms, skipped }
}
