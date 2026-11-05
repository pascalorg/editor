import type { AnyNode, DoorNode, WallFace, WindowNode } from '../schema'
import { DEFAULT_OPENING_CASING_WIDTH, OPENING_CASING_PROUD } from '../schema/nodes/opening-types'
import { DEFAULT_WALL_THICKNESS, getWallThickness } from '../systems/wall/wall-footprint'
import { roomSideFaces } from '../systems/wall/wall-room-sides'
import { cornerPair } from './corner-pair'
import { getDoorOpeningSize } from './door-opening'
import { openingExteriorFace } from './opening-exterior-face'

/**
 * Door and window casing: flat boards on the finished faces of the host wall
 * around the opening, over the drywall or siding. The wall cutout is the unit's
 * own width × height and the casing never reaches into it: each board starts at
 * the cutout's edge and runs outward, `OPENING_CASING_PROUD` off the face. A
 * window gets a picture frame (head, two legs, bottom), a door a head and two
 * legs, butted at the corners: the head and bottom run the full width over the
 * legs' ends.
 *
 * Everything here is in the host frame, centred on the opening: x along the
 * host toward its end, y up, z across it toward face `a`. The 3D builders turn
 * that into the unit's own frame (a unit facing the back is turned half round,
 * see `openingHostFacing`); the plan draws it as it is.
 */

export { DEFAULT_OPENING_CASING_WIDTH, OPENING_CASING_PROUD }

type CasedOpening = DoorNode | WindowNode
/** From and to along one axis of the host frame (m). */
type Span = readonly [number, number]

export type OpeningCasingHost = {
  /** The host's total thickness with its finishes: each face is half of it off the mid-plane (m). */
  thickness: number
  /** Room side, when known, for a window's interior stool. */
  interiorFace?: WallFace
  exteriorFace?: WallFace
  /** The host end a corner window runs to: no leg there; the head and bottom stop at the opening. */
  cornerEnd?: 'start' | 'end'
}

export type OpeningCasingFace = {
  face: WallFace
  /** Across the host, from the opening's centre plane to the finished face (m). */
  plane: number
  /** The way the face looks across the host: +1 for `a`, -1 for `b`. */
  out: 1 | -1
}

export type OpeningCasingBoard = {
  face: WallFace
  /**
   * `leg` boards stand beside the opening, the part a plan cut shows. A `foot` carries a leg on
   * down past a window's sill to the bottom board, which sits under the sill on that face.
   */
  part: 'head' | 'leg' | 'foot' | 'bottom'
  /** Centre, from the opening's centre in the host frame (m). */
  center: [number, number, number]
  /** Along the host, up, across it (m). */
  size: [number, number, number]
}

/** The face width of an opening's casing boards; a save from before casing has the default. */
export function openingCasingWidth(opening: Pick<CasedOpening, 'casingWidth'>): number {
  const width = opening.casingWidth
  return typeof width === 'number' && width > 0 ? width : DEFAULT_OPENING_CASING_WIDTH
}

/**
 * +1 when the unit faces the host's front (its own +z is face `a`), -1 when it is turned half
 * round to face the back, which mirrors its x and z against the host's.
 */
export function openingHostFacing(opening: Partial<Pick<CasedOpening, 'rotation'>>): 1 | -1 {
  return Math.cos(opening.rotation?.[1] ?? 0) >= 0 ? 1 : -1
}

/** Roof face a is outside; an unbounded wall follows the same a/outside, b/inside convention. */
export function openingInteriorFace(
  opening: Pick<CasedOpening, 'parentId' | 'roofSegmentId'>,
  nodes: Readonly<Record<string, AnyNode>>,
): WallFace {
  if (!opening.roofSegmentId && opening.parentId && nodes[opening.parentId]?.type === 'wall') {
    return roomSideFaces(nodes, opening.parentId).inside ?? 'b'
  }
  return 'b'
}

/**
 * The host an opening is cased on: its wall, or the roof-segment face it is cut into (a gable
 * end, whose face `a` is the outside). Null where casing has nowhere to go: a curtain wall, a
 * railing (its openings are gaps in the guard), a dormer face, a unit built from a script (its
 * script draws its own trim).
 */
export function resolveOpeningCasingHost(
  opening: CasedOpening,
  nodes: Readonly<Record<string, AnyNode>>,
  host: AnyNode | undefined = nodes[opening.roofSegmentId ?? opening.parentId ?? ''],
): OpeningCasingHost | null {
  if (opening.source) return null
  const exteriorFace = opening.type === 'window' ? openingExteriorFace(opening, nodes) : undefined
  const interior =
    opening.type === 'window'
      ? {
          exteriorFace,
          ...(opening.sillInterior
            ? {
                interiorFace: exteriorFace === 'a' ? ('b' as const) : ('a' as const),
              }
            : {}),
        }
      : {}
  if (opening.roofSegmentId) {
    return host?.type === 'roof-segment'
      ? { thickness: host.wallThickness ?? DEFAULT_WALL_THICKNESS, ...interior }
      : null
  }
  if (host?.type !== 'wall' || host.wallType === 'curtain' || host.wallType === 'railing')
    return null
  const pair = opening.type === 'window' ? cornerPair(nodes, opening) : null
  return {
    thickness: getWallThickness(host),
    ...interior,
    ...(pair ? { cornerEnd: pair.end } : {}),
  }
}

/** The host faces an opening is cased on: both unless turned off (a save from before has both). */
export function openingCasingFaces(
  opening: Pick<CasedOpening, 'position' | 'casingFaceA' | 'casingFaceB'>,
  host: OpeningCasingHost,
): OpeningCasingFace[] {
  const offset = opening.position[2] ?? 0
  const half = host.thickness / 2
  const faces: OpeningCasingFace[] = []
  if (opening.casingFaceA === true) faces.push({ face: 'a', plane: half - offset, out: 1 })
  if (opening.casingFaceB === true) faces.push({ face: 'b', plane: -half - offset, out: -1 })
  return faces
}

/** The casing bottom clears whichever sill is on this host face. */
function sillDrop(opening: CasedOpening, face: WallFace, host: OpeningCasingHost): number {
  if (opening.type !== 'window' || opening.openingKind === 'opening') return 0
  const front: WallFace = host.exteriorFace ?? (openingHostFacing(opening) === 1 ? 'a' : 'b')
  return Math.max(
    opening.sill && face === front ? Math.max(opening.sillThickness ?? 0, 0) : 0,
    opening.sillInterior && face === (host.interiorFace ?? 'b')
      ? (opening.sillInteriorThickness ?? 0.03)
      : 0,
  )
}

/** The casing boards of a rectangular opening on each face it is cased on, in the host frame. */
export function openingCasingBoards(
  opening: CasedOpening,
  host: OpeningCasingHost,
): OpeningCasingBoard[] {
  const width = openingCasingWidth(opening)
  const proud = OPENING_CASING_PROUD
  const size = getDoorOpeningSize(opening)
  const halfWidth = size.width / 2
  const halfHeight = size.height / 2
  const offsetX = -size.leafOffsetX * openingHostFacing(opening)
  const offsetY = (size.height - opening.height) / 2
  const corner = host.cornerEnd === 'start' ? -1 : host.cornerEnd === 'end' ? 1 : 0
  const left = -halfWidth - (corner === -1 ? 0 : width)
  const right = halfWidth + (corner === 1 ? 0 : width)
  const legs = ([-1, 1] as const)
    .filter((side) => side !== corner)
    .map(
      (side): Span =>
        side < 0 ? [-halfWidth - width, -halfWidth] : [halfWidth, halfWidth + width],
    )
  const boards: OpeningCasingBoard[] = []
  for (const { face, plane, out } of openingCasingFaces(opening, host)) {
    const z = plane + (out * proud) / 2
    const board = (part: OpeningCasingBoard['part'], [x0, x1]: Span, [y0, y1]: Span) =>
      boards.push({
        face,
        part,
        center: [(x0 + x1) / 2 + offsetX, (y0 + y1) / 2 + offsetY, z],
        size: [x1 - x0, y1 - y0, proud],
      })
    board('head', [left, right], [halfHeight, halfHeight + width])
    for (const along of legs) board('leg', along, [-halfHeight, halfHeight])
    if (opening.type !== 'window') continue
    const drop = sillDrop(opening, face, host)
    if (drop > 1e-6)
      for (const along of legs) board('foot', along, [-halfHeight - drop, -halfHeight])
    board('bottom', [left, right], [-halfHeight - drop - width, -halfHeight - drop])
  }
  return boards
}
