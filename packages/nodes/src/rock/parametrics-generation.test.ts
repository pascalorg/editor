import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { RockNode, SiteNode, useScene } from '@pascal-app/core'
import { rockParametrics } from './parametrics'

const initial = useScene.getState()
const history = useScene.temporal.getState()
afterEach(() => {
  useScene.setState(initial, true)
  useScene.temporal.setState(history)
})
const polygon: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]
function install(gen: 1 | 2, seed = 3210) {
  const site = SiteNode.parse({})
  const rock = RockNode.parse({
    parentId: site.id,
    gen,
    polygon,
    seed,
    height: 0.12,
    rockType: 'stepping',
    weathering: 0.7,
    moss: 0.4,
    strata: true,
    lichen: 0.2,
  })
  useScene.setState({
    nodes: { [site.id]: { ...site, children: [rock.id] }, [rock.id]: rock },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return rock
}

// Exercise descriptor actions against the real scene store. No mock update callback can echo
// the desired answer; preserving saved fields and undo are the externally meaningful effects.
describe('rock type/look controls and randomisation', () => {
  test('shows active type and looks only for gen 2, including a 12 cm stepping stone', () => {
    const legacy = RockNode.parse({ polygon })
    const current = RockNode.parse({ polygon, gen: 2, height: 0.12, rockType: 'stepping' })
    const fields = rockParametrics.groups.flatMap((group) => group.fields)
    for (const key of ['rockType', 'weathering', 'moss']) {
      const field = fields.find((entry) => entry.key === key)
      expect(field).toBeDefined()
      expect(field?.visibleIf?.(legacy)).toBe(false)
      expect(field?.visibleIf?.(current)).toBe(true)
    }
    const height = fields.find((entry) => entry.key === 'height')
    expect(height?.kind).toBe('number')
    if (height?.kind !== 'number') throw new Error('Missing height control')
    expect(height.min ?? 0).toBeLessThanOrEqual(0.12)
    const type = fields.find((entry) => entry.key === 'rockType')
    if (type?.kind !== 'enum') throw new Error('Missing type selector')
    expect(type.options).toEqual([
      'boulder',
      'fjord',
      'granite',
      'volcanic',
      'river',
      'stacked',
      'stepping',
    ])
  })

  for (const gen of [1, 2] as const) {
    test(`Randomise changes only the seed in one undoable edit for gen ${gen}, even on a repeated draw`, () => {
      const rock = install(gen)
      const action = rockParametrics.actions?.find((entry) => entry.label === 'Randomise')
      if (!action) throw new Error('Missing Randomise action')
      const random = spyOn(Math, 'random').mockReturnValue(rock.seed / 10_000)
      try {
        action.onClick(rock)
      } finally {
        random.mockRestore()
      }
      const after = useScene.getState().nodes[rock.id] as RockNode
      expect(after.seed).not.toBe(rock.seed)
      expect(Number.isInteger(after.seed)).toBe(true)
      expect(after.seed).toBeGreaterThanOrEqual(0)
      expect(after.seed).toBeLessThanOrEqual(9999)
      expect({ ...after, seed: rock.seed }).toEqual(rock)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[rock.id]).toEqual(rock)
    })
  }

  test('explicit upgrade changes generation once, retaining saved dimensions/type/looks', () => {
    const rock = install(1)
    const action = rockParametrics.actions?.find((entry) => entry.label === 'Upgrade to gen 2')
    if (!action) throw new Error('Missing generation upgrade action')
    expect(action.enabledIf?.(rock)).toBe(true)
    action.onClick(rock)
    expect(useScene.getState().nodes[rock.id]).toEqual({ ...rock, gen: 2 })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const upgraded = useScene.getState().nodes[rock.id] as RockNode
    expect(action.enabledIf?.(upgraded)).toBe(false)
    action.onClick(upgraded)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[rock.id]).toEqual(rock)
  })
})
