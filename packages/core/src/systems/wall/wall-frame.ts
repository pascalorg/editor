import type { SceneNodes } from '../../lib/structure-kernel'
import type { WallNode } from '../../schema/nodes/wall'
import { getWallArcData } from './wall-curve'
import type { Point2D } from './wall-mitering'

// Stored endpoints define the reference line: a is left, b is right.
// Endpoint snapping and room topology use that line; faces, hosted objects
// and body handles use its offsets. Justification moves the body, never the line.
export type WallJustification = 'a' | 'b'
export type WallFaceOffsets = { a: number; b: number }

type WallFrame = Pick<WallNode, 'thickness' | 'justification'>
type WallLine = WallFrame & Pick<WallNode, 'start' | 'end'>

export function getWallFaceOffsets(wall: WallFrame): WallFaceOffsets {
  const thickness = wall.thickness ?? 0.1
  if (wall.justification === 'a') return { a: thickness, b: 0 }
  if (wall.justification === 'b') return { a: 0, b: -thickness }
  return { a: thickness / 2, b: -thickness / 2 }
}

export function getWallBodyCenterOffset(wall: WallFrame): number {
  const { a, b } = getWallFaceOffsets(wall)
  return (a + b) / 2
}

function offsetLine(wall: WallLine, offset: number): { start: Point2D; end: Point2D } {
  const start = { x: wall.start[0], y: wall.start[1] }
  const end = { x: wall.end[0], y: wall.end[1] }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (offset === 0 || length < 1e-9) return { start, end }
  const nx = (-dy / length) * offset
  const ny = (dx / length) * offset
  return {
    start: { x: start.x + nx, y: start.y + ny },
    end: { x: end.x + nx, y: end.y + ny },
  }
}

export function getWallBodyLine(wall: WallLine): { start: Point2D; end: Point2D } {
  return offsetLine(wall, getWallBodyCenterOffset(wall))
}

export function getWallFaceLine(
  wall: WallLine,
  face: WallJustification,
): { start: Point2D; end: Point2D } {
  return offsetLine(wall, getWallFaceOffsets(wall)[face])
}

export function getWallLocalFaceZ(wall: WallFrame, face: WallJustification): number {
  // The viewer rotates XZ by -atan2(dy, dx), mapping the left normal to +z.
  return getWallFaceOffsets(wall)[face]
}

/**
 * Which physical face a point on the wall mesh lies on, from wall-local
 * coordinates (x along the chord, z toward its left) — never from the material
 * a face happens to draw with. Curved walls use the arc's own frame, so a point
 * near an arc end is judged against the curve, not the chord. Returns null for
 * caps and tops (the surface normal is not across the wall) and for points too
 * close to the body centre to call.
 */
export function getWallFaceAtLocalPoint(
  wall: WallLine & Pick<WallNode, 'curveOffset'>,
  localPosition: readonly [number, number, number],
  localNormal?: readonly [number, number, number],
): WallJustification | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  const tangent = { x: dx / length, y: dz / length }
  const left = { x: -tangent.y, y: tangent.x }
  const toWorld = (x: number, z: number) => ({
    x: tangent.x * x + left.x * z,
    y: tangent.y * x + left.y * z,
  })
  const [localX, , localZ] = localPosition
  let across = localZ
  let faceNormal = left
  const arc = getWallArcData(wall)
  if (arc) {
    const offset = toWorld(localX, localZ)
    const px = wall.start[0] + offset.x - arc.center.x
    const py = wall.start[1] + offset.y - arc.center.y
    const radius = Math.hypot(px, py)
    if (radius < 1e-9) return null
    // Left of a counter-clockwise arc points at its centre.
    const inward = arc.direction > 0
    across = inward ? arc.radius - radius : radius - arc.radius
    faceNormal = inward ? { x: -px / radius, y: -py / radius } : { x: px / radius, y: py / radius }
  }
  if (localNormal) {
    const normal = toWorld(localNormal[0], localNormal[2])
    if (Math.abs(normal.x * faceNormal.x + normal.y * faceNormal.y) < 0.65) return null
  }
  const fromCentre = across - getWallBodyCenterOffset(wall)
  const thickness = wall.thickness ?? 0.1
  if (Math.abs(fromCentre) < Math.max(thickness * 0.2, 0.01)) return null
  return fromCentre >= 0 ? 'a' : 'b'
}

export function faceOnLine(wall: Pick<WallNode, 'justification'>): 'a' | 'b' | 'center' {
  return wall.justification === 'a' ? 'b' : wall.justification === 'b' ? 'a' : 'center'
}

export function justificationForFaceOnLine(
  face: 'a' | 'b' | 'center',
): WallJustification | undefined {
  return face === 'a' ? 'b' : face === 'b' ? 'a' : undefined
}

export function buildWallJustificationPatch(
  justification: WallJustification | undefined,
): Pick<WallNode, 'justification'> {
  return { justification }
}

const swapFace = (face: 'a' | 'b'): 'a' | 'b' => (face === 'a' ? 'b' : 'a')

function swapFaceSlotKey(key: string): string {
  if (key === 'a' || key === 'b') return swapFace(key)
  const match = /^([ab])([A-Z].*)$/.exec(key)
  return match ? `${swapFace(match[1] as 'a' | 'b')}${match[2]}` : key
}

// Legacy semantic sides draw on their canonical face (interior → a), so they turn too.
const TRIM_FACE: Record<string, 'a' | 'b'> = { a: 'a', interior: 'a', b: 'b', exterior: 'b' }

function reverseTrim<T extends { sides?: string } | undefined>(trim: T): T {
  const face = trim?.sides ? TRIM_FACE[trim.sides] : undefined
  if (!(trim && face)) return trim
  return { ...trim, sides: swapFace(face) }
}

/**
 * Turns a wall around. Face `a` becomes `b`, so everything keyed by face swaps
 * with it, and region stations are re-measured from the new start. Zone
 * `wallOverrides` live on zones; callers reversing a wall swap those too.
 */
export function reverseWallDirection(wall: WallNode): Partial<WallNode> {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const legacy = wall.legacyFaceMaterials
  return {
    start: wall.end,
    end: wall.start,
    frontSide: wall.backSide,
    backSide: wall.frontSide,
    ...(wall.justification === undefined
      ? {}
      : { justification: wall.justification === 'a' ? 'b' : 'a' }),
    ...(wall.curveOffset === undefined ? {} : { curveOffset: -wall.curveOffset }),
    ...(wall.slots === undefined
      ? {}
      : {
          slots: Object.fromEntries(
            Object.entries(wall.slots).map(([key, value]) => [swapFaceSlotKey(key), value]),
          ),
        }),
    ...(legacy === undefined
      ? {}
      : {
          legacyFaceMaterials: {
            ...(legacy.b === undefined ? {} : { a: legacy.b }),
            ...(legacy.a === undefined ? {} : { b: legacy.a }),
          },
        }),
    ...(wall.faceRegions === undefined
      ? {}
      : {
          faceRegions: wall.faceRegions.map(({ u0, u1, ...region }) => ({
            ...region,
            face: swapFace(region.face),
            ...(u1 === undefined ? {} : { u0: length - u1 }),
            ...(u0 === undefined ? {} : { u1: length - u0 }),
          })),
        }),
    ...(wall.skirting === undefined ? {} : { skirting: reverseTrim(wall.skirting) }),
    ...(wall.crown === undefined ? {} : { crown: reverseTrim(wall.crown) }),
    ...(wall.chairRail === undefined ? {} : { chairRail: reverseTrim(wall.chairRail) }),
  }
}

export function planWallJustification(
  nodes: SceneNodes,
  wallId: string,
  justification: WallJustification | undefined,
): Array<{ id: WallNode['id']; data: Pick<WallNode, 'justification'> }> {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall') throw Error('Select a wall.')
  if (wall.justification === justification) return []
  return [{ id: wall.id, data: buildWallJustificationPatch(justification) }]
}
