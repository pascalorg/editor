import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { RockNode, SiteNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { addRock } from './rock'
import type { SceneNodes } from './types'

const outline: [number, number][] = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const context = { activeLevelId: null }
const types = ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'] as const
const call = (nodes: SceneNodes, input: Record<string, unknown>) =>
  addRock(nodes, input as never, context)
const fixture = () => {
  const site = SiteNode.parse({
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
  })
  return { site, nodes: { [site.id]: site } as SceneNodes }
}
function refusal(nodes: SceneNodes, input: Record<string, unknown>) {
  try {
    call(nodes, input)
    return null
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
}

// These assertions protect saved scene state and caller-visible facts, not implementation call
// order. Invalid input is tried with no Site as well, proving validation precedes scene work.
describe('versioned rocks through the shared agent operation', () => {
  for (const rockType of types) {
    test(`creates ${rockType} as gen 2 and reports the stored look honestly`, () => {
      const { nodes, site } = fixture()
      const input = {
        outline,
        height: 1.75,
        seed: -17,
        rockType,
        weathering: 0.81,
        moss: 0.63,
        strata: true,
        lichen: 0.2,
      }
      const output = call(nodes, input)
      const after = applySceneChanges(nodes, output.changes ?? {})
      const rocks = Object.values(after).filter((node) => node.type === 'rock')
      expect(rocks).toHaveLength(1)
      expect(rocks[0]).toMatchObject({
        polygon: outline,
        height: 1.75,
        seed: -17,
        rockType,
        weathering: 0.81,
        moss: 0.63,
        strata: true,
        lichen: 0.2,
        gen: 2,
        parentId: site.id,
      })
      expect(output.result).toMatchObject({
        rockId: rocks[0]?.id,
        siteId: site.id,
        facts: {
          gen: 2,
          rockType,
          heightM: 1.75,
          topElevationM: 1.7,
          footprintAreaM2: 24,
          look: { weathering: 0.81, moss: 0.63, strata: true, lichen: 0.2 },
        },
      })
      expect(nodes).toEqual({ [site.id]: site })
    })
  }

  test('omitting all generation/look choices creates the current generation, not schema legacy', () => {
    const { nodes } = fixture()
    const output = call(nodes, { outline })
    const after = applySceneChanges(nodes, output.changes ?? {})
    const rock = Object.values(after).find((node) => node.type === 'rock')
    expect(rock).toMatchObject({ gen: 2, rockType: 'boulder', weathering: 0.35, moss: 0 })
  })

  test('an old rock stays gen 1 when edited and upgrades only on explicit request', () => {
    const { nodes, site } = fixture()
    const old = RockNode.parse({
      parentId: site.id,
      polygon: outline,
      seed: 8,
      strata: true,
      lichen: 0.4,
    })
    const scene = { ...nodes, [old.id]: old }
    const changed = call(scene, { rockId: old.id, height: 3.5 })
    expect(applySceneChanges(scene, changed.changes ?? {})[old.id]).toMatchObject({
      gen: 1,
      height: 3.5,
      seed: 8,
      strata: true,
      lichen: 0.4,
    })
    expect(changed.result).toMatchObject({
      facts: { gen: 1, rockType: null, look: { weathering: null, moss: null } },
    })
    for (const look of [{ rockType: 'boulder' }, { weathering: 0.35 }, { moss: 0 }]) {
      expect(refusal(scene, { rockId: old.id, ...look })).toBe('rock_gen_upgrade_required')
    }
    const upgraded = call(scene, {
      rockId: old.id,
      gen: 2,
      rockType: 'river',
      weathering: 1,
      moss: 0.5,
    })
    expect(applySceneChanges(scene, upgraded.changes ?? {})[old.id]).toMatchObject({
      gen: 2,
      rockType: 'river',
      weathering: 1,
      moss: 0.5,
      seed: 8,
      strata: true,
      lichen: 0.4,
    })
    expect(scene[old.id]).toEqual(old)
  })

  test('explicit legacy creation remains available without promising inactive new looks', () => {
    const { nodes } = fixture()
    const output = call(nodes, { outline, gen: 1, form: 'weathered', strata: true, lichen: 0.5 })
    expect(output.result).toMatchObject({
      facts: {
        gen: 1,
        rockType: null,
        look: { form: 'weathered', strata: true, lichen: 0.5, weathering: null, moss: null },
      },
    })
    expect(refusal(nodes, { outline, gen: 1, moss: 0 })).toBe('rock_gen_upgrade_required')
  })

  test('rejects invalid saved look numbers before any scene lookup or mutation', () => {
    const { nodes } = fixture()
    const before = JSON.stringify(nodes)
    const invalid = [
      { gen: 0 },
      { gen: 3 },
      { gen: 1.5 },
      { rockType: 'unknown' },
      ...['weathering', 'moss'].flatMap((key) =>
        [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY].map((value) => ({ [key]: value })),
      ),
    ]
    for (const fields of invalid) {
      expect(refusal({}, { outline, ...fields })).toBe('invalid_input')
      expect(refusal(nodes, { outline, ...fields })).toBe('invalid_input')
      expect(JSON.stringify(nodes)).toBe(before)
    }
  })
})
