import { refuse } from '../agent-tools/refusal'
import {
  projectWallTypes,
  WALL_ASSEMBLY_PRESETS,
  wallAssemblyPatch,
} from '../systems/wall/wall-assembly'
import { queryNodes } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

export function wallTypeChoices(nodes: SceneNodes) {
  const sites = queryNodes(nodes, { type: 'site' }).filter((site) => !site.parentId)
  return [
    ...WALL_ASSEMBLY_PRESETS,
    ...projectWallTypes(
      nodes,
      sites.map((site) => site.id),
    ),
  ]
}

export function wallTypePatch(nodes: SceneNodes, type: string) {
  const choice = wallTypeChoices(nodes).find((entry) => entry.id === type)
  if (!choice)
    refuse('unknown_wall_type', `Unknown wall type: ${type}. Read get_walls.wallTypes.`, { type })
  return wallAssemblyPatch(structuredClone(choice.assembly))
}

export const setWallType: AgentOperation<{ wallIds: string[]; type: string | null }> = (
  nodes,
  input,
) => {
  const data = input.type === null ? { assembly: undefined } : wallTypePatch(nodes, input.type)
  const ids = [...new Set(input.wallIds)]
  for (const id of ids) {
    const wall = nodes[id]
    if (wall?.type !== 'wall')
      refuse('target_not_found', `${id} is not a wall: nothing was changed.`, { target: id })
    if (wall.wallType === 'curtain' || wall.wallType === 'railing')
      refuse(
        `${wall.wallType}_wall`,
        `Wall ${id} is a ${wall.wallType} wall: it takes no assembly.`,
        { target: id },
      )
  }
  return {
    result: { ok: true, wallIds: ids, type: input.type },
    changes: { update: ids.map((id) => ({ id, data: structuredClone(data) })) },
  }
}
