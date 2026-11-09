import { refuse } from '../agent-tools/refusal'
import {
  clampDoorToWall,
  clampWindowToWall,
  findWallChildOverlap,
  resolveWallOpeningCeiling,
} from '../building/wall-openings'
import { getDoorOpeningSize } from '../lib/door-opening'
import { openingHostFacing } from '../lib/opening-casing'
import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getCurtainWallConfig,
  getScaledDimensions,
  type ItemNode,
  type WallNode,
  type WindowNode,
} from '../schema'
import { isDerivedNode } from '../store/derived-node-guard'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import { projectWorldPointToWallLocalX, wallLength } from './plan-geometry'
import type { SceneNodes } from './types'

export type MoveTarget = {
  to?: number[]
  by?: number[]
  y?: number
  rotation?: number
  force?: boolean
}

export type MoveHostClass = 'wall' | 'ceiling' | 'free' | 'roof' | 'level'

export type MovePlan = {
  host: MoveHostClass
  hostId: string | null
  /** The node's stored position after the move; for a wall, its start as [x, 0, z]. */
  position: [number, number, number]
  clamped: boolean
  data: Partial<AnyNode>
}

/**
 * Kinds a person can pick up and set down on a level, whose seat is their stored plan position:
 * the same kinds the node definitions declare `movable` on x/z (core cannot read those
 * definitions, so the seat is decided by kind and parent here, as other operations decide).
 */
const FREE_ON_LEVEL = new Set([
  'item',
  'column',
  'elevator',
  'shelf',
  'block',
  'cabinet',
  'procedural-item',
  'imported-mesh',
  'scan',
  'spawn',
  'hvac-equipment',
  'duct-terminal',
  'duct-fitting',
  'pipe-fitting',
  'pipe-trap',
])

const DEDICATED_TOOL: Record<string, string> = {
  zone: 'move_zone or rotate_zone',
  level: 'add_level or duplicate_level',
  roof: 'create_roof',
  'roof-segment': 'create_roof',
  stair: 'create_stair',
  building: 'update_node on the building',
}

function parentOf(nodes: SceneNodes, node: AnyNode): AnyNode | undefined {
  return node.parentId ? nodes[node.parentId] : undefined
}

function positionOf(node: AnyNode): [number, number, number] | null {
  const position = (node as { position?: unknown }).position
  return Array.isArray(position) && position.length === 3
    ? (position as [number, number, number])
    : null
}

/** The host class a node's seat belongs to, or a coded refusal saying why it has no movable seat. */
export function moveHostClass(nodes: SceneNodes, node: AnyNode): MoveHostClass {
  if (isDerivedNode(node))
    refuse(
      'node_not_movable',
      `${node.type} ${node.id} is derived from its room; the editor rebuilds it rather than moving it.`,
      { id: node.id, type: node.type },
    )
  const parent = parentOf(nodes, node)
  if (
    parent?.type === 'wall' &&
    (node.type === 'door' || node.type === 'window' || node.type === 'item')
  )
    return 'wall'
  if (parent?.type === 'ceiling' && node.type === 'item') return 'ceiling'
  if (
    (node.type === 'door' || node.type === 'window') &&
    ((node as DoorNode).roofSegmentId || parent?.type === 'roof-segment')
  )
    refuse(
      'move_not_supported',
      `${node.type} ${node.id} sits on a roof-segment wall face, whose seat the editor keeps in face-local coordinates this tool does not move.`,
      { id: node.id, type: node.type },
    )
  if (parent?.type === 'roof-segment') return 'roof'
  if (node.type === 'wall' && parent?.type === 'level') return 'level'
  if (parent?.type === 'level' && FREE_ON_LEVEL.has(node.type) && positionOf(node)) return 'free'
  if (parent?.type === 'item')
    refuse(
      'move_not_supported',
      `${node.type} ${node.id} rests on item ${parent.id}; moving a node on another item's surface is not supported here. Move its host, or delete and place it again.`,
      { id: node.id, hostId: parent.id },
    )
  const dedicated = DEDICATED_TOOL[node.type]
  refuse(
    'node_not_movable',
    `A ${node.type} has no seat the editor's move tool drags${dedicated ? `; use ${dedicated}` : ''}.`,
    { id: node.id, type: node.type },
  )
}

function requireTarget(target: MoveTarget) {
  if (target.to && target.by)
    refuse('move_target_ambiguous', 'Pass one of to (absolute) or by (delta), not both.')
  if (!target.to && !target.by && target.rotation === undefined)
    refuse(
      'move_target_required',
      'Say where the node goes: to [x, z], by [dx, dz], or a rotation alone.',
    )
}

function planTargetXZ(current: [number, number, number], target: MoveTarget): [number, number] {
  if (target.to) return [target.to[0] ?? current[0], target.to[1] ?? current[2]]
  return [current[0] + (target.by?.[0] ?? 0), current[2] + (target.by?.[1] ?? 0)]
}

function yawData(node: AnyNode, target: MoveTarget, scalar: boolean): Partial<AnyNode> {
  if (target.rotation === undefined) return {}
  const radians = (target.rotation * Math.PI) / 180
  if (scalar) return { rotation: radians } as Partial<AnyNode>
  const rotation = (node as { rotation?: number[] }).rotation
  const tuple: [number, number, number] = [rotation?.[0] ?? 0, radians, rotation?.[2] ?? 0]
  return { rotation: tuple } as Partial<AnyNode>
}

function refuseStrayY(target: MoveTarget, node: AnyNode) {
  if (target.y !== undefined)
    refuse(
      'height_not_applicable',
      `y sets a window's sill or a wall item's bottom height; ${node.type} ${node.id} takes neither.`,
      { id: node.id, type: node.type },
    )
}

function planFreeMove(node: AnyNode, target: MoveTarget, host: MoveHostClass): MovePlan {
  refuseStrayY(target, node)
  const current = positionOf(node)
  if (!current)
    refuse('node_not_movable', `${node.type} ${node.id} has no stored position to move.`, {
      id: node.id,
    })
  const [x, z] = planTargetXZ(current, target)
  const position: [number, number, number] = [x, current[1], z]
  return {
    host,
    hostId: node.parentId ?? null,
    position,
    clamped: false,
    data: { position, ...yawData(node, target, host === 'roof') } as Partial<AnyNode>,
  }
}

function desiredLocalX(wall: WallNode, node: AnyNode, target: MoveTarget): number {
  const current = positionOf(node)
  if (target.to)
    return projectWorldPointToWallLocalX(wall, [target.to[0] ?? 0, 0, target.to[1] ?? 0])
  if (!current) return 0
  const length = wallLength(wall)
  if (!length) return current[0]
  const ux = (wall.end[0] - wall.start[0]) / length
  const uz = (wall.end[1] - wall.start[1]) / length
  return current[0] + (target.by?.[0] ?? 0) * ux + (target.by?.[1] ?? 0) * uz
}

function overlapRefusal(
  nodes: SceneNodes,
  wall: WallNode,
  node: AnyNode,
  centreX: number,
  centreY: number,
  width: number,
  height: number,
  target: MoveTarget,
  checkOverlap: boolean,
) {
  if (!checkOverlap || target.force) return
  const blocking = findWallChildOverlap(wall.id, nodes, centreX, centreY, width, height, node.id)
  if (blocking)
    refuse(
      'opening_overlap',
      `Moving ${node.type} ${node.id} there on wall ${wall.id} would overlap ${blocking.type} ${blocking.id}. Move it along the wall, or, if the person asked for the overlap, pass force, like holding Alt in the editor.`,
      { id: node.id, wallId: wall.id, blockingId: blocking.id },
    )
}

function planOpeningMove(
  nodes: SceneNodes,
  wall: WallNode,
  node: DoorNode | WindowNode,
  target: MoveTarget,
  checkOverlap: boolean,
): MovePlan {
  if (node.type === 'door' && target.y !== undefined) refuseStrayY(target, node)
  // A door's cutout is wider and taller than its leaf once it has sidelights or a transom.
  const cutout =
    node.type === 'door'
      ? getDoorOpeningSize(node)
      : { width: node.width, height: node.height, leafOffsetX: 0 }
  const cutoutOffsetX = cutout.leafOffsetX * openingHostFacing(node)
  const length = wallLength(wall)
  if (length < cutout.width)
    refuse(
      'wall_too_short',
      `Wall ${wall.id} is ${length.toFixed(2)} m long, too short for this ${cutout.width.toFixed(2)} m ${node.type}.`,
      { id: node.id, wallId: wall.id, wallLength: length, width: cutout.width },
    )
  if (node.type === 'door') {
    const wallHeight =
      resolveWallOpeningCeiling(wall, nodes as Record<AnyNodeId, AnyNode>) -
      (wall.wallType === 'curtain' ? getCurtainWallConfig(wall).perimeterWidth : 0)
    if (cutout.height > wallHeight + 1e-6)
      refuse(
        'wall_too_low',
        `Wall ${wall.id} is ${wallHeight.toFixed(2)} m high, too low for this ${cutout.height.toFixed(2)} m door.`,
        { id: node.id, wallId: wall.id, wallHeight, height: cutout.height },
      )
  }
  const rawX = desiredLocalX(wall, node, target)
  const rawY =
    node.type === 'door'
      ? node.height / 2
      : target.y === undefined
        ? node.position[1]
        : target.y + node.height / 2
  const { clampedX, clampedY } =
    node.type === 'door'
      ? clampDoorToWall(wall, rawX, node.width, node.height, node)
      : clampWindowToWall(
          wall,
          rawX,
          rawY,
          node.width,
          node.height,
          nodes as Record<AnyNodeId, AnyNode>,
        )
  overlapRefusal(
    nodes,
    wall,
    node,
    clampedX - cutoutOffsetX,
    clampedY + (cutout.height - node.height) / 2,
    cutout.width,
    cutout.height,
    target,
    checkOverlap,
  )
  const position: [number, number, number] = [clampedX, clampedY, node.position[2]]
  return {
    host: 'wall',
    hostId: wall.id,
    position,
    clamped: Math.abs(clampedX - rawX) > 1e-9 || Math.abs(clampedY - rawY) > 1e-9,
    data: { position } as Partial<AnyNode>,
  }
}

/** A wall item's seat, as place_items seats one: along the wall, bottom at y, on the point's side. */
function planWallItemMove(
  nodes: SceneNodes,
  wall: WallNode,
  item: ItemNode,
  target: MoveTarget,
  checkOverlap: boolean,
): MovePlan {
  const [width, height] = getScaledDimensions(item)
  const wallHeight = wall.height ?? 2.5
  const length = wallLength(wall)
  const rawX = desiredLocalX(wall, item, target)
  const x = Math.max(width / 2, Math.min(length - width / 2, rawX))
  const rawY = target.y ?? item.position[1]
  const y = Math.max(0, Math.min(wallHeight - height, rawY))
  // The side follows the target point when one is named, as the editor's drag crosses the wall.
  let side = item.side
  let faceZ = item.position[2]
  let turn = item.rotation[1] ?? 0
  if (target.to) {
    const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
    const left =
      -dz * ((target.to[0] ?? 0) - wall.start[0]) + dx * ((target.to[1] ?? 0) - wall.start[1]) >= 0
    side = left ? 'front' : 'back'
    faceZ = item.asset.attachTo === 'wall-side' ? getWallLocalFaceZ(wall, left ? 'a' : 'b') : 0
    turn = left ? 0 : Math.PI
  }
  overlapRefusal(nodes, wall, item, x, y + height / 2, width, height, target, checkOverlap)
  const position: [number, number, number] = [x, y, faceZ]
  return {
    host: 'wall',
    hostId: wall.id,
    position,
    clamped: Math.abs(x - rawX) > 1e-9 || Math.abs(y - rawY) > 1e-9,
    data: {
      position,
      rotation: [item.rotation[0] ?? 0, turn, item.rotation[2] ?? 0],
      wallId: wall.id,
      wallT: length ? x / length : 0,
      side,
    } as Partial<AnyNode>,
  }
}

function planWallHostedMove(
  nodes: SceneNodes,
  node: AnyNode,
  target: MoveTarget,
  checkOverlap: boolean,
): MovePlan {
  if (target.rotation !== undefined)
    refuse(
      'rotation_not_supported',
      `${node.type} ${node.id} faces its wall side; rotation does not apply on a wall host.`,
      { id: node.id },
    )
  const wall = parentOf(nodes, node)
  if (wall?.type !== 'wall')
    refuse('move_host_missing', `${node.type} ${node.id} has no host wall.`, { id: node.id })
  if (isCurvedWall(wall))
    refuse(
      'curved_wall',
      `Wall ${wall.id} is curved; its hosted nodes do not slide along it, as in the editor.`,
      { id: node.id, wallId: wall.id },
    )
  return node.type === 'item'
    ? planWallItemMove(nodes, wall, node as ItemNode, target, checkOverlap)
    : planOpeningMove(nodes, wall, node as DoorNode | WindowNode, target, checkOverlap)
}

function planWallMove(node: WallNode, target: MoveTarget): MovePlan {
  refuseStrayY(target, node)
  if (target.rotation !== undefined)
    refuse(
      'rotation_not_supported',
      `Wall ${node.id} turns by redrawing its ends; move_node only translates it.`,
      { id: node.id },
    )
  if (target.to)
    refuse(
      'move_to_ambiguous',
      `A wall has two ends; say by how much wall ${node.id} translates, with by [dx, dz].`,
      { id: node.id },
    )
  const dx = target.by?.[0] ?? 0
  const dz = target.by?.[1] ?? 0
  const start: [number, number] = [node.start[0] + dx, node.start[1] + dz]
  const end: [number, number] = [node.end[0] + dx, node.end[1] + dz]
  return {
    host: 'level',
    hostId: node.parentId ?? null,
    position: [start[0], 0, start[1]],
    clamped: false,
    data: { start, end } as Partial<AnyNode>,
  }
}

/**
 * Where a node lands when moved, seated the way the editor's move tools seat it — the same plan
 * move_node applies to a live node and duplicate_node applies to a copy's offset.
 */
export function planNodeMove(
  nodes: SceneNodes,
  node: AnyNode,
  target: MoveTarget,
  options: { checkOverlap?: boolean } = {},
): MovePlan {
  requireTarget(target)
  const host = moveHostClass(nodes, node)
  const checkOverlap = options.checkOverlap ?? true
  if (host === 'wall') return planWallHostedMove(nodes, node, target, checkOverlap)
  if (host === 'level') return planWallMove(node as WallNode, target)
  if (host === 'roof') {
    const parent = parentOf(nodes, node)
    if (parent?.type !== 'roof-segment')
      refuse('move_host_missing', `${node.type} ${node.id} has no host roof segment.`, {
        id: node.id,
      })
  }
  return planFreeMove(node, target, host)
}
