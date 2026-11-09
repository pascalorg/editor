import { ProceduralItemNode } from './node'
import { type QueryNodes, validateProceduralRelations } from './query'
import type { Recipe, Vec3 } from './recipe'

export function prepareProceduralPlacement(
  recipe: Recipe,
  nodes: QueryNodes,
  placement: { parentId: string; position: Vec3; side?: 'front' | 'back' },
) {
  const parent = nodes[placement.parentId]
  const hostType =
    recipe.mounting?.attachTo === 'ceiling' ? 'ceiling' : recipe.mounting ? 'wall' : 'level'
  if (!parent || parent.type !== hostType) throw new Error(`Choose a ${hostType} for this design`)
  const node = ProceduralItemNode.parse({
    recipe,
    name: recipe.name,
    parentId: parent.id,
    position: placement.position,
    ...(recipe.mounting?.attachTo === 'wall-side'
      ? { wallId: parent.id, side: placement.side ?? 'front' }
      : {}),
  })
  validateProceduralRelations(node, { ...nodes, [node.id]: node })
  return node
}
