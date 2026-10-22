import type {
  AnyNode,
  CompiledGeometryScript,
  DoorNode,
  WallFaceScript,
  WallNode,
  WindowNode,
} from '../schema'
import type { WallFace } from '../schema/nodes/wall'
import { getWallTop } from '../services/storey'
import type { WallSlabSupport } from '../systems/slab/slab-support'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { parseWallPaintRole } from '../systems/wall/wall-finish'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import {
  calculateLevelMiters,
  getWallMiterBoundaryPoints,
  type WallMiterData,
} from '../systems/wall/wall-mitering'
import { isFloorAnchoredOpening } from './floor-opening-footprints'
import { scriptSource } from './geometry-script-node'
import { getOpeningFloorDatum, wallSupportForNodes } from './opening-floor-datum'
import { scriptInputsKey } from './script-inputs-key'

type SceneNodes = Readonly<Record<string, AnyNode>>

/** A rectangle on a wall face, in the face's frame and metres. */
export type WallFaceRect = { x0: number; y0: number; x1: number; y1: number }

/**
 * What a wall face's script is built for, in the face's frame and metres: x along the wall from
 * its start, y up from the face's base (its lowest floor), z out of the face. `outline` is the
 * face's rectangle (its mitred ends, up to the wall's top or the script's `toHeight`); `holes` the
 * doors and windows cutting it, clipped to it (a door from the floor under it, a window from its
 * sill); `base` the face's floor from end to end as `[x, y]` points (one level run on a flat floor,
 * a jump where a raised room meets it); `thickness` the wall's. The build stays in this frame.
 */
export type WallFaceScriptInputs = {
  outline: WallFaceRect
  holes: WallFaceRect[]
  base: [number, number][]
  thickness: number
}

const EPS = 1e-6
const round = (value: number) => Math.round(value * 1e4) / 1e4

/** How far the face's frame stands above the wall's own origin: its lowest floor, wall-local. */
export function wallFaceBaseOffset(support: WallSlabSupport, face: WallFace): number {
  const runs = support.faceDatum[face]
  if (!runs.length) return 0
  const lowest = Math.min(
    ...runs.map((run) => Math.min(run.elevation, run.endElevation ?? run.elevation)),
  )
  return lowest - support.elevation
}

const mitersByNodes = new WeakMap<SceneNodes, Map<string, WallMiterData>>()

function levelMiters(nodes: SceneNodes, levelId: string): WallMiterData {
  let levels = mitersByNodes.get(nodes)
  if (!levels) {
    levels = new Map()
    mitersByNodes.set(nodes, levels)
  }
  let miters = levels.get(levelId)
  if (!miters) {
    const walls = Object.values(nodes)
      .filter((node): node is WallNode => node.type === 'wall' && node.parentId === levelId)
      .sort((a, b) => a.id.localeCompare(b.id))
    miters = calculateLevelMiters(walls)
    levels.set(levelId, miters)
  }
  return miters
}

type FaceFrame = {
  wall: WallNode
  length: number
  support: WallSlabSupport
  /** The frame's origin above the wall's own, wall-local metres. */
  offset: number
  /** The face's mitred ends along the wall. */
  x0: number
  x1: number
  /** The wall's top in the face's frame. */
  top: number
}

/** A wall whose faces a script can build on: straight, not a curtain wall, standing on a level. */
function scriptableWall(nodes: SceneNodes, wallId: string): WallNode | null {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall' || !wall.parentId) return null
  if (wall.wallType === 'curtain' || isCurvedWall(wall)) return null
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) < EPS ? null : wall
}

function faceFrame(nodes: SceneNodes, wallId: string, face: WallFace): FaceFrame | null {
  const wall = scriptableWall(nodes, wallId)
  if (!wall?.parentId) return null
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const support = wallSupportForNodes(wall, nodes)
  const offset = wallFaceBaseOffset(support, face)
  const top =
    getWallTop(wall, wall.parentId, nodes as Record<string, AnyNode>, support.elevation) -
    support.elevation -
    offset
  const station = (point: { x: number; y: number }) =>
    ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / length
  const ends = getWallMiterBoundaryPoints(wall, levelMiters(nodes, wall.parentId))
  const x0 = ends ? station(face === 'a' ? ends.startLeft : ends.startRight) : 0
  const x1 = ends ? station(face === 'a' ? ends.endLeft : ends.endRight) : length
  if (top <= EPS || x1 - x0 <= EPS) return null
  return { wall, length, support, offset, x0, x1, top }
}

/** The face's floor as `[x, y]` points from `x0` to `x1`, in the face's frame. */
function faceBase(frame: FaceFrame, face: WallFace): [number, number][] {
  const { support, length, offset, x0, x1 } = frame
  const runs = [...support.faceDatum[face]].sort((a, b) => a.start - b.start)
  const points: [number, number][] = runs.length
    ? runs.flatMap((run): [number, number][] => [
        [run.start * length, run.elevation - support.elevation - offset],
        [run.end * length, (run.endElevation ?? run.elevation) - support.elevation - offset],
      ])
    : [
        [0, 0],
        [length, 0],
      ]
  const yAt = (x: number) => {
    if (x <= points[0]![0]) return points[0]![1]
    for (let index = 1; index < points.length; index += 1) {
      const [ax, ay] = points[index - 1]!
      const [bx, by] = points[index]!
      if (x <= bx) return bx - ax < EPS ? by : ay + ((x - ax) / (bx - ax)) * (by - ay)
    }
    return points[points.length - 1]![1]
  }
  const kept: [number, number][] = [
    [x0, yAt(x0)],
    ...points.filter(([x]) => x > x0 + EPS && x < x1 - EPS),
    [x1, yAt(x1)],
  ]
  const base = kept.map(([x, y]): [number, number] => [round(x), round(y)])
  // A point on the straight line between its neighbours (a run's end where the next runs on
  // level) says nothing; a jump (two points at one x) or a bend stays.
  const simplified: [number, number][] = []
  for (const point of base) {
    const previous = simplified[simplified.length - 1]
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue
    const before = simplified[simplified.length - 2]
    if (
      before &&
      previous &&
      before[0] < previous[0] &&
      previous[0] < point[0] &&
      Math.abs(
        (previous[0] - before[0]) * (point[1] - before[1]) -
          (previous[1] - before[1]) * (point[0] - before[0]),
      ) < EPS
    )
      simplified.pop()
    simplified.push(point)
  }
  return simplified
}

/** The lowest point of `base` over `[x0, x1]`. */
function baseLowUnder(base: [number, number][], x0: number, x1: number): number {
  let low = Number.POSITIVE_INFINITY
  for (let index = 1; index < base.length; index += 1) {
    const [ax, ay] = base[index - 1]!
    const [bx, by] = base[index]!
    if (bx < x0 || ax > x1) continue
    const at = (x: number) =>
      bx - ax < EPS ? Math.min(ay, by) : ay + ((x - ax) / (bx - ax)) * (by - ay)
    low = Math.min(low, at(Math.max(ax, x0)), at(Math.min(bx, x1)))
  }
  return Number.isFinite(low) ? low : 0
}

/**
 * The face a script builds on, or null when it has none: a curved or curtain wall, a wall with no
 * level, or a face with no height above its floor.
 */
export function wallFaceScriptInputs(
  nodes: SceneNodes,
  wallId: string,
  face: WallFace,
  toHeight?: number,
): WallFaceScriptInputs | null {
  const frame = faceFrame(nodes, wallId, face)
  if (!frame) return null
  const { wall, support, offset, x0, x1, top } = frame
  const outline = {
    x0: round(x0),
    y0: 0,
    x1: round(x1),
    y1: round(toHeight === undefined ? top : Math.min(toHeight, top)),
  }
  const base = faceBase(frame, face)
  const holes = (wall.children ?? []).flatMap((childId) => {
    const opening = nodes[childId]
    if (opening?.type !== 'door' && opening?.type !== 'window') return []
    const { position, width, height } = opening as DoorNode | WindowNode
    const centre =
      getOpeningFloorDatum(wall, opening, nodes, support) - support.elevation - offset + position[1]
    const left = position[0] - width / 2
    const right = position[0] + width / 2
    const bottom = isFloorAnchoredOpening(opening)
      ? Math.min(centre - height / 2, baseLowUnder(base, left, right))
      : centre - height / 2
    const hole = {
      x0: round(Math.max(left, outline.x0)),
      y0: round(Math.max(bottom, outline.y0)),
      x1: round(Math.min(right, outline.x1)),
      y1: round(Math.min(centre + height / 2, outline.y1)),
    }
    return hole.x1 - hole.x0 > EPS && hole.y1 - hole.y0 > EPS ? [hole] : []
  })
  holes.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)
  return { outline, holes, base, thickness: round(getWallThickness(wall)) }
}

/** The key a face script keeps of the face it was built for (`WallFaceScript.inputs`). */
export function wallFaceScriptInputsKey(inputs: WallFaceScriptInputs): string {
  return scriptInputsKey(
    JSON.stringify([inputs.outline, inputs.holes, inputs.base, inputs.thickness]),
  )
}

/** A compile as the wall keeps it on a face: its script source, its face's key, its `toHeight`. */
export function wallFaceScriptRecord(
  compiled: CompiledGeometryScript,
  inputs: WallFaceScriptInputs,
  toHeight: number | undefined,
  previous?: WallFaceScript,
): WallFaceScript {
  return {
    ...scriptSource(compiled, {}, previous),
    inputs: wallFaceScriptInputsKey(inputs),
    ...(toHeight === undefined ? {} : { toHeight }),
  }
}

/** Over the face, so the face's own finish never shows through the tiles. */
const WALL_FACE_SCRIPT_PROUD = 0.001

/**
 * Where a face's build goes in the wall's local frame (x along the wall from its start, z toward
 * face a): its frame's origin at the face's base, 1 mm proud of the face. Face b's frame has z out
 * of face b, so the build is mirrored through the wall (`scale` z −1; three.js flips the winding of
 * a mirrored mesh) and its x still runs from the wall's start. Null when the face has no frame.
 */
export function wallFaceScriptPlacement(
  nodes: SceneNodes,
  wallId: string,
  face: WallFace,
): { position: [number, number, number]; scale: [number, number, number] } | null {
  const wall = scriptableWall(nodes, wallId)
  if (!wall) return null
  const out = face === 'a' ? 1 : -1
  return {
    position: [
      0,
      wallFaceBaseOffset(wallSupportForNodes(wall, nodes), face),
      getWallLocalFaceZ(wall, face) + out * WALL_FACE_SCRIPT_PROUD,
    ],
    scale: [1, 1, out],
  }
}

/**
 * Where a face's skirting gives way to its script, as it does at a door: the build's span along
 * the wall when the build comes down into the skirting's band (its bottom below `bandTop`, in the
 * face's frame), else null. The script wins visually where it covers the band; a splashback above
 * the skirting leaves it whole.
 */
export function wallFaceScriptSkirtingGap(
  script: WallFaceScript,
  bandTop: number,
): [number, number] | null {
  const { min, max } = script.manifest.bounds
  return min[1] < bandTop - EPS ? [min[0], max[0]] : null
}

export type WallFacePaintRefusal = {
  status: 'refused'
  code: 'wall-face-built-by-script'
  message: string
}

/**
 * Why a paint on a wall's `role` is refused: it lands on a face (the face itself, a region of it,
 * the room's finish on it) that a script builds to the top, and the script owns its colours. A
 * script stopping at `toHeight` leaves its face paintable, since the paint shows above it.
 */
export function wallFaceScriptPaintRefusal(
  wall: AnyNode | undefined,
  role: string,
): WallFacePaintRefusal | undefined {
  if (wall?.type !== 'wall') return
  const parsed = parseWallPaintRole(role, (slotId) => slotId === 'a' || slotId === 'b')
  const face =
    parsed?.kind === 'slot'
      ? (parsed.slotId as WallFace)
      : parsed?.kind === 'room-face'
        ? parsed.face
        : parsed?.kind === 'region'
          ? wall.faceRegions?.find((region) => region.id === parsed.regionId)?.face
          : undefined
  const script = face && wall.finishScripts?.[face]
  if (!face || !script || script.toHeight !== undefined) return
  return {
    status: 'refused',
    code: 'wall-face-built-by-script',
    message: `${wall.name?.trim() || 'This wall'}'s side ${face.toUpperCase()} is built by a script, which owns its colours. Remove the script to paint that side.`,
  }
}
