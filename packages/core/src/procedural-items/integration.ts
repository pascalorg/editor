import { ProceduralItemNode, snapParameters } from './node'
import { type QueryNodes, validateProceduralRelations } from './query'
import { parseRecipe, type Recipe, type Vec3 } from './recipe'

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

export function prepareProceduralReplacement(
  current: ProceduralItemNode,
  expectedRecipe: Recipe,
  candidate: Recipe,
  nodes: QueryNodes,
) {
  if (JSON.stringify(current.recipe) !== JSON.stringify(expectedRecipe))
    throw new Error('This design changed while generating. Start again from the current item.')
  const recipe = parseRecipe(candidate)
  const parameters: Record<string, number> = {}
  const resetParameters: string[] = []
  for (const [id, value] of Object.entries(current.parameters)) {
    const p = recipe.parameters.find((p) => p.id === id)
    if (!p || value < p.min || value > p.max || (p.unit === 'count' && !Number.isInteger(value)))
      resetParameters.push(current.recipe.parameters.find((p) => p.id === id)?.label ?? id)
    else parameters[id] = value
  }
  const slots: Record<string, string> = {}
  const resetSlots: string[] = []
  for (const [id, value] of Object.entries(current.slots)) {
    if (recipe.slots.some((s) => s.id === id)) slots[id] = value
    else resetSlots.push(current.recipe.slots.find((s) => s.id === id)?.label ?? id)
  }
  const patch = {
    recipe,
    parameters: snapParameters(recipe, parameters),
    slots,
    name: current.name === current.recipe.name ? recipe.name : current.name,
  }
  const node = ProceduralItemNode.parse({ ...current, ...patch })
  validateProceduralRelations(node, { ...nodes, [node.id]: node })
  if (node.parentId) {
    const parent = nodes[node.parentId]
    if (parent) validateProceduralRelations(parent, { ...nodes, [node.id]: node })
  }
  return { node, patch, resetParameters, resetSlots }
}
