import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { BuildingNode, RockNode, SiteNode } from '../schema'
import { addRock } from './rock'
import type { SceneNodes } from './types'

const outline: [number, number][] = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]

// Ownership is a document invariant, not a generator choice. A wrong-Site building
// frame must never silently relocate or edit a rock on a different Site.
describe('rock Site ownership refusals', () => {
  test('creation and edits refuse contradictory owners atomically', () => {
    const first = SiteNode.parse({})
    const second = SiteNode.parse({})
    const building = BuildingNode.parse({ parentId: second.id })
    const rock = RockNode.parse({ parentId: first.id, polygon: outline })
    const nodes: SceneNodes = {
      [first.id]: { ...first, children: [rock.id] },
      [second.id]: { ...second, children: [building.id] },
      [building.id]: building,
      [rock.id]: rock,
    }
    const before = JSON.stringify(nodes)
    for (const input of [
      { siteId: first.id, buildingId: building.id, outline },
      { siteId: first.id, buildingId: building.id, at: [0, 0], size: 2 },
      { rockId: rock.id, siteId: second.id, height: 4 },
      { rockId: rock.id, buildingId: building.id, height: 4 },
      { rockId: rock.id, buildingId: building.id, outline },
      { rockId: rock.id, siteId: second.id, at: [0, 0], size: 2 },
    ]) {
      let failure: unknown
      try {
        addRock(nodes, input as never, { activeLevelId: null })
      } catch (error) {
        failure = error
      }
      expect(isAgentRefusal(failure)).toBe(true)
      expect(JSON.stringify(nodes)).toBe(before)
    }
    // Positive controls: refusal cannot be implemented by disabling edits or explicit Sites.
    expect(
      addRock(
        nodes,
        { siteId: second.id, buildingId: building.id, outline },
        { activeLevelId: null },
      ).changes?.create,
    ).toHaveLength(1)
    expect(
      addRock(nodes, { rockId: rock.id, siteId: first.id, height: 4 }, { activeLevelId: null })
        .changes?.update,
    ).toEqual([{ id: rock.id, data: { height: 4 } }])
    expect(JSON.stringify(nodes)).toBe(before)
  })
})
