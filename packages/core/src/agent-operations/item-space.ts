import { type AnyNode, getScaledDimensions, type ItemNode } from '../schema'
import { itemNodePlanAabb, type PlanAabb } from './door-clearance'

/**
 * Where an item stands in its level's frame when it is hosted by another item (a lamp on a
 * nightstand): its position is local to the host, so the plan checks read it through the host
 * chain, each host's yaw turning the offset. An item hosted by a wall keeps wall-local
 * coordinates and is read by the wall observations instead, so this answers nothing for it.
 */
export function itemLevelPose(
  node: ItemNode,
  byId: Map<string, AnyNode>,
): { position: [number, number, number]; yawDeg: number } | null {
  let [x, y, z] = node.position
  let yaw = node.rotation[1]
  let parent = node.parentId ? byId.get(node.parentId) : undefined
  while (parent && parent.type !== 'level') {
    // A wall's child is wall-local: not this frame. A ceiling's or slab's child is already in plan metres.
    if (parent.type === 'wall') return null
    if (parent.type !== 'item') break
    const turn = parent.rotation[1]
    const [px, py, pz] = parent.position
    const [rx, rz] = [
      x * Math.cos(turn) + z * Math.sin(turn),
      -x * Math.sin(turn) + z * Math.cos(turn),
    ]
    x = px + rx
    y = py + y
    z = pz + rz
    yaw += turn
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return { position: [x, y, z], yawDeg: yaw }
}

/** The item's plan footprint in its level's frame, or null when it is wall-hosted or malformed. */
export function itemPlanAabbInLevel(node: ItemNode, byId: Map<string, AnyNode>): PlanAabb | null {
  const pose = itemLevelPose(node, byId)
  if (!pose) return null
  return itemNodePlanAabb({
    ...node,
    position: pose.position,
    rotation: [node.rotation[0], pose.yawDeg, node.rotation[2]],
  })
}

/** The item's bottom and top above its level's floor, from its pose and scaled height. */
export function itemLevelHeightRange(
  node: ItemNode,
  byId: Map<string, AnyNode>,
): { min: number; max: number } | null {
  // Only a plainly placed item answers: yaw-only, positive scales, a real height. Anything else
  // keeps the conservative rule that unknown geometry cannot waive a collision.
  if (node.rotation[0] !== 0 || node.rotation[2] !== 0) return null
  if (node.scale.some((v) => !(v > 0)) || (node.asset.scale ?? [1, 1, 1]).some((v) => !(v > 0)))
    return null
  const pose = itemLevelPose(node, byId)
  if (!pose) return null
  const height = getScaledDimensions(node)[1]
  if (!(height > 0) || !Number.isFinite(height) || !Number.isFinite(pose.position[1])) return null
  return { min: pose.position[1], max: pose.position[1] + height }
}

/** Every item above this one in its host chain: a thing and what it rests on are stacked by design, not colliding. */
export function itemHosts(node: AnyNode, byId: Map<string, AnyNode>): Set<string> {
  const hosts = new Set<string>()
  let parent = node.parentId ? byId.get(node.parentId) : undefined
  while (parent?.type === 'item') {
    hosts.add(parent.id)
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return hosts
}
