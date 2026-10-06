import type { AgentToolCase } from './cases'
import { storeysScene } from './structure-cases'

/**
 * find_by_type (L56): an unknown level answered "nothing found" on both surfaces, where get_zones
 * refuses it; the agent could not tell a typo from an empty floor.
 */
export const FIND_BY_TYPE_CASES: AgentToolCase[] = [
  {
    name: 'the walls of a level',
    tool: 'find_by_type',
    scene: storeysScene,
    input: { type: 'wall', levelId: 'level_ground' },
    expect: { result: {}, contains: { results: [{ id: 'wall_ground' }] } },
  },
  {
    name: 'a level that is not there is refused with its id',
    tool: 'find_by_type',
    scene: storeysScene,
    input: { type: 'wall', levelId: 'level_missing' },
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
]
