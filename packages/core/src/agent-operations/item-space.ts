import type { ProceduralItemNode } from '../procedural-items/node'
import { evaluateRecipe } from '../procedural-items/recipe'
import { rotateVector } from '../procedural-items/spatial'
import { type AnyNode, getScaledDimensions, type ItemNode } from '../schema'
import {
  itemNodePlanAabb,
  type PlanAabb,
  proceduralNodePlanAabb,
  proceduralNodePlanCorners,
} from './door-clearance'
import type { Vec2 } from './plan-geometry'

function turnPlanOffset(x: number, z: number, turn: number): [number, number] {
  return [x * Math.cos(turn) + z * Math.sin(turn), -x * Math.sin(turn) + z * Math.cos(turn)]
}

function stepThroughHostChain(
  childId: string,
  initial: { position: [number, number, number]; yaw: number },
  startParent: AnyNode | undefined,
  byId: Map<string, AnyNode>,
): { position: [number, number, number]; yawDeg: number } | null {
  let [x, y, z] = initial.position
  let yaw = initial.yaw
  let currentId = childId
  let parent = startParent
  const seen = new Set<string>([childId])
  while (parent && parent.type !== 'level') {
    if (seen.has(parent.id)) return null
    seen.add(parent.id)
    // A wall's child is wall-local: not this frame. A ceiling's or slab's child is already in plan metres.
    if (parent.type === 'wall') return null
    if (parent.type === 'procedural-item') {
      if (parent.wallId) return null
      const surfaceId = parent.attachments?.[currentId]
      if (surfaceId !== undefined) {
        if (!Array.isArray(parent.recipe?.parts)) return null
        let surface: ReturnType<typeof evaluateRecipe>['surfaces'][number] | undefined
        try {
          surface = evaluateRecipe(parent.recipe, parent.parameters).surfaces.find(
            (entry) => entry.id === surfaceId,
          )
        } catch {
          return null
        }
        if (!surface) return null
        if (Math.abs(surface.rotation[0]) > 1e-6 || Math.abs(surface.rotation[2]) > 1e-6) {
          return null
        }
        const [sx, sz] = turnPlanOffset(x, z, surface.rotation[1])
        x = surface.position[0] + sx
        y = surface.position[1] + y
        z = surface.position[2] + sz
        yaw += surface.rotation[1]
      }
      if (Math.abs(parent.rotation[0]) > 1e-6 || Math.abs(parent.rotation[2]) > 1e-6) {
        return null
      }
      const [rx, rz] = turnPlanOffset(x, z, parent.rotation[1])
      x = parent.position[0] + rx
      y = parent.position[1] + y
      z = parent.position[2] + rz
      yaw += parent.rotation[1]
      currentId = parent.id
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
      continue
    }
    if (parent.type !== 'item') break
    const turn = parent.rotation[1]
    const [px, py, pz] = parent.position
    const [rx, rz] = turnPlanOffset(x, z, turn)
    x = px + rx
    y = py + y
    z = pz + rz
    yaw += turn
    currentId = parent.id
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return { position: [x, y, z], yawDeg: yaw }
}

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
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  return stepThroughHostChain(
    node.id,
    { position: [...node.position], yaw: node.rotation[1] },
    parent,
    byId,
  )
}

export function proceduralItemLevelPose(
  node: ProceduralItemNode,
  byId: Map<string, AnyNode>,
): { position: [number, number, number]; yawDeg: number } | null {
  if (node.wallId) return null
  if (!Array.isArray(node.position) || !Array.isArray(node.rotation)) return null
  const position: [number, number, number] = [node.position[0], node.position[1], node.position[2]]
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  if (node.recipe?.mounting?.attachTo === 'ceiling') {
    if (parent?.type !== 'ceiling' || !Array.isArray(node.recipe?.parts)) return null
    try {
      const reference = evaluateRecipe(node.recipe, node.parameters).surfaces.find(
        (entry) => entry.id === node.recipe.mounting?.reference,
      )
      if (!reference) return null
      const offset = rotateVector(reference.position, node.rotation)
      position[0] -= offset[0]
      position[1] -= offset[1]
      position[2] -= offset[2]
    } catch {
      return null
    }
  } else if (node.recipe?.mounting?.attachTo === 'wall-side') {
    return null
  }
  return stepThroughHostChain(node.id, { position, yaw: node.rotation[1] }, parent, byId)
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

export function proceduralPlanCornersInLevel(
  node: ProceduralItemNode,
  byId: Map<string, AnyNode>,
): Vec2[] | null {
  const pose = proceduralItemLevelPose(node, byId)
  if (!pose) return null
  return proceduralNodePlanCorners({
    ...node,
    position: pose.position,
    rotation: [node.rotation[0], pose.yawDeg, node.rotation[2]],
  })
}

export function proceduralPlanAabbInLevel(
  node: ProceduralItemNode,
  byId: Map<string, AnyNode>,
): PlanAabb | null {
  const pose = proceduralItemLevelPose(node, byId)
  if (!pose) return null
  return proceduralNodePlanAabb({
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
  while (parent?.type === 'item' || parent?.type === 'procedural-item') {
    hosts.add(parent.id)
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return hosts
}
