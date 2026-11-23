import { getOpeningFloorDatum } from '../../lib/opening-floor-datum'
import { resolveOpeningFrameDepth } from '../../lib/opening-frame-depth'
import type { AnyNode, DoorNode, WallNode, WindowNode } from '../../schema'
import {
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
} from '../../systems/wall/wall-curve'
import { getWallThickness } from '../../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../../systems/wall/wall-frame'
import type { Prism, Ring } from './types'
import { isOpening, levelWalls, type Nodes } from './walls'

/** Where an opening stands in plan: its centre, the wall's direction along it and across it. */
type Pose = { cx: number; cz: number; tx: number; tz: number; nx: number; nz: number }

function poseOf(wall: WallNode, opening: DoorNode | WindowNode): Pose {
  const length = getWallCurveLength(wall)
  const frame = getWallCurveFrameAt(
    wall,
    length > 1e-9 ? Math.min(1, Math.max(0, opening.position[0] / length)) : 0,
  )
  const across = getWallBodyCenterOffset(wall) + opening.position[2]
  return {
    cx: frame.point.x + frame.normal.x * across,
    cz: frame.point.y + frame.normal.y * across,
    tx: frame.tangent.x,
    tz: frame.tangent.y,
    nx: frame.normal.x,
    nz: frame.normal.y,
  }
}

/** The plan rectangle `u0..u1` along the wall and `a0..a1` across it, from the opening's centre. */
function rect(pose: Pose, u0: number, u1: number, a0: number, a1: number): Ring {
  const at = (u: number, a: number): [number, number] => [
    pose.cx + pose.tx * u + pose.nx * a,
    pose.cz + pose.tz * u + pose.nz * a,
  ]
  return [at(u0, a0), at(u1, a0), at(u1, a1), at(u0, a1)]
}

type Common = Pick<Prism, 'nodeId' | 'shape' | 'why' | 'host'>

/** How far the window builder lifts the sill's top over the opening's bottom (`SILL_LIFT` there). */
const SILL_LIFT = 0.001

function push(
  out: Prism[],
  id: string,
  kind: Prism['kind'],
  z0: number,
  z1: number,
  outer: Ring,
  common: Common,
) {
  if (z1 - z0 > 1e-4) out.push({ id, kind, z0, z1, outer, holes: [], ...common })
}

/**
 * A door's frame as the door builder cuts it (`viewer/src/systems/door/door-system.tsx`, "Frame
 * members"): two posts of `frameThickness` and a head across the width, `frameDepth` deep, centred
 * on the wall's body; a threshold of `thresholdHeight` between the posts. The leaf is not an
 * obstacle (a door is passed open). A frameless opening has no frame. The arch and the rounded head
 * are left out and the door is marked approximate; a scripted door is its bounds.
 */
function doorFrame(wall: WallNode, door: DoorNode, yc: number, out: Prism[]) {
  const pose = poseOf(wall, door)
  const half = resolveOpeningFrameDepth(door, getWallThickness(wall)) / 2
  const curved = isCurvedWall(wall)
  const common: Common = {
    nodeId: door.id,
    shape: curved ? 'approx' : 'exact',
    ...(curved ? { why: 'a door on a curved wall' } : {}),
  }
  if (door.source) {
    const size = scriptedBounds(door.source.manifest.bounds)
    push(
      out,
      `${door.id}#script`,
      'jamb',
      yc - door.height / 2,
      yc - door.height / 2 + size.height,
      rect(pose, -size.width / 2, size.width / 2, -size.depth / 2, size.depth / 2),
      {
        nodeId: door.id,
        shape: 'approx',
        why: 'a scripted door: its bounds box',
      },
    )
    return
  }
  if (door.openingKind === 'opening') return
  const w = door.width
  const h = door.height
  const ft = door.frameThickness
  const bottom = yc - h / 2
  const top = yc + h / 2
  const shaped = door.openingShape !== 'rectangle'
  const approx: Common = shaped
    ? { ...common, shape: 'approx', why: `a ${door.openingShape} head: the posts only` }
    : common
  const postTop =
    door.openingShape === 'arch'
      ? Math.max(
          top - Math.min(Math.max(door.archHeight, 0), h) - (door.archHeight <= ft * 2 ? ft : 0),
          bottom + 0.01,
        )
      : top
  push(
    out,
    `${door.id}#jamb.l`,
    'jamb',
    bottom,
    postTop,
    rect(pose, -w / 2, -w / 2 + ft, -half, half),
    approx,
  )
  push(
    out,
    `${door.id}#jamb.r`,
    'jamb',
    bottom,
    postTop,
    rect(pose, w / 2 - ft, w / 2, -half, half),
    approx,
  )
  if (!shaped)
    push(
      out,
      `${door.id}#head`,
      'door-head',
      top - ft,
      top,
      rect(pose, -w / 2, w / 2, -half, half),
      common,
    )
  if (door.threshold)
    push(
      out,
      `${door.id}#threshold`,
      'threshold',
      bottom,
      bottom + door.thresholdHeight,
      rect(pose, -(w - 2 * ft) / 2, (w - 2 * ft) / 2, -half, half),
      common,
    )
}

function scriptedBounds(bounds: { min: readonly number[]; max: readonly number[] }) {
  return {
    width: bounds.max[0]! - bounds.min[0]!,
    height: bounds.max[1]! - bounds.min[1]!,
    depth: bounds.max[2]! - bounds.min[2]!,
  }
}

/**
 * A window as the window builder cuts it (`viewer/src/systems/window/window-system.tsx`): the frame
 * and its glazing fill the opening, `width × height × frameDepth`, centred on the wall's body; a sill
 * box `width + 0.4·sillDepth` wide, `sillThickness` thick, `sillDepth` deep stands under it on the
 * side the window faces, starting on the wall face (2 mm off it when the frame is shallower than the wall). A bay or a bow
 * projects: only its frame is drawn here and it is marked approximate. */
function window(wall: WallNode, win: WindowNode, yc: number, out: Prism[]) {
  const pose = poseOf(wall, win)
  const half = resolveOpeningFrameDepth(win, getWallThickness(wall)) / 2
  const w = win.width
  const h = win.height
  const curved = isCurvedWall(wall)
  const projecting = win.windowType === 'bay' || win.windowType === 'bow'
  const why = projecting
    ? `a ${win.windowType} window: its projection is not drawn`
    : curved
      ? 'a window on a curved wall'
      : undefined
  const common: Common = {
    nodeId: win.id,
    shape: why ? 'approx' : 'exact',
    ...(why ? { why } : {}),
  }
  if (win.source) {
    const size = scriptedBounds(win.source.manifest.bounds)
    push(
      out,
      `${win.id}#script`,
      'window-frame',
      yc - h / 2,
      yc - h / 2 + size.height,
      rect(pose, -size.width / 2, size.width / 2, -size.depth / 2, size.depth / 2),
      {
        nodeId: win.id,
        shape: 'approx',
        why: 'a scripted window: its bounds box',
      },
    )
    return
  }
  push(
    out,
    `${win.id}#frame`,
    'window-frame',
    yc - h / 2,
    yc + h / 2,
    rect(pose, -w / 2, w / 2, -half, half),
    common,
  )
  if (!win.sill) return
  // window-local +z is the wall's normal for a window turned 0, its opposite for one turned half a turn
  const side = Math.cos(win.rotation[1]) >= 0 ? 1 : -1
  const faceZ = Math.max(
    getWallThickness(wall) / 2 - win.position[2] * Math.cos(win.rotation[1]),
    half,
  )
  // The builder stands the sill's back on the wall face when the frame runs through the wall,
  // and 2 mm off it when the frame is shallower.
  const from = faceZ + (faceZ > half ? 0.002 : 0)
  const sillW = w + win.sillDepth * 0.4
  const [a0, a1] = side > 0 ? [from, from + win.sillDepth] : [-(from + win.sillDepth), -from]
  push(
    out,
    `${win.id}#sill`,
    'sill',
    yc - h / 2 - win.sillThickness + SILL_LIFT,
    yc - h / 2 + SILL_LIFT,
    rect(pose, -sillW / 2, sillW / 2, a0, a1),
    {
      ...common,
      host: { wallId: wall.id, face: side > 0 ? 'a' : 'b' },
    },
  )
}

/**
 * The plan rectangle of the hole a door is walked through, across the wall's thickness: the width
 * between its frame members, or the whole width for a frameless opening. Null for a scripted door,
 * whose frame is not known.
 */
export function doorwayRing(wall: WallNode, door: DoorNode): Ring | null {
  if (door.source) return null
  const clear = door.openingKind === 'opening' ? door.width : door.width - 2 * door.frameThickness
  const half = getWallThickness(wall) / 2 + 0.01
  return rect(poseOf(wall, door), -clear / 2, clear / 2, -half, half)
}

/** Doors' frames and windows' frames and sills of one level, in level-local heights. */
export function openingBodies(
  nodes: Nodes,
  levelId: string,
  walls: WallNode[] = levelWalls(nodes, levelId),
): Prism[] {
  const out: Prism[] = []
  for (const wall of walls)
    for (const id of wall.children ?? []) {
      const opening = nodes[id] as AnyNode | undefined
      if (!isOpening(opening) || opening.visible === false) continue
      const yc = getOpeningFloorDatum(wall, opening, nodes) + opening.position[1]
      if (opening.type === 'door') doorFrame(wall, opening, yc, out)
      else window(wall, opening, yc, out)
    }
  return out
}
