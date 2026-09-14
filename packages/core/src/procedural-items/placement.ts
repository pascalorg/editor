import type { WallNode } from '../schema/nodes/wall'
import type { ProceduralItemNode } from './node'
import { proceduralLocalPose, type QueryNodes, validateProceduralRelations } from './query'
import { evaluateRecipe } from './recipe'
import { boundsOf, boxCorners, frame, transformPoint } from './spatial'

export function resolveProceduralWallPlacement(
  node: ProceduralItemNode,
  wall: WallNode,
  x: number,
  y: number,
  side: 'front' | 'back',
  nodes: QueryNodes,
): ProceduralItemNode | null {
  if (!node.recipe.mounting || wall.curveOffset) return null
  const candidate: ProceduralItemNode = {
    ...node,
    parentId: wall.id,
    wallId: wall.id,
    side,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
  const e = evaluateRecipe(node.recipe, node.parameters)
  const pose = proceduralLocalPose(candidate, nodes)
  const b = boundsOf(
    boxCorners(e.min, e.max).map((p) => transformPoint(frame(pose.position, pose.rotation), p)),
  )
  const level = wall.parentId ? nodes[wall.parentId] : undefined
  const height = wall.height ?? (level?.type === 'level' ? level.height : 2.5) ?? 2.5
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (b.dimensions[0] > length || b.dimensions[1] > height) return null
  candidate.position = [
    Math.min(length - b.max[0], Math.max(-b.min[0], x)),
    Math.min(height - b.max[1], Math.max(-b.min[1], y)),
    0,
  ]
  try {
    validateProceduralRelations(candidate, nodes)
    return candidate
  } catch {
    return null
  }
}
