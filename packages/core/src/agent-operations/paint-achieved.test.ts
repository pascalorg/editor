import { describe, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, LevelNode, WallNode } from '../schema'
import { achievedChanges } from './achieved'
import { applySceneChanges } from './apply-changes'
import { paint } from './paint'

const finish = 'library:concrete-raw'
const context = { activeLevelId: 'level_paint_delta' }

function fixture() {
  const makeCeiling = (id: string, surface?: string) =>
    CeilingNode.parse({
      id,
      parentId: context.activeLevelId,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
      height: 2.65,
      regions: [
        {
          id: 'accent',
          polygon: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          finish: 'library:preset-nearblack',
        },
      ],
      slots: { retained: 'library:preset-nearblack', ...(surface ? { surface } : {}) },
      materialPreset: 'white',
      material: { preset: 'custom', properties: { color: '#123456' } },
      metadata: { authoredBy: 'person' },
    })
  const same = makeCeiling('ceiling_same', finish)
  const fresh = makeCeiling('ceiling_fresh')
  const wall = WallNode.parse({
    id: 'wall_paint_delta',
    parentId: context.activeLevelId,
    start: [0, 0],
    end: [4, 0],
  })
  const level = LevelNode.parse({
    id: context.activeLevelId,
    children: [same.id, fresh.id, wall.id],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, same, fresh, wall].map((node) => [node.id, node]),
  )
  return { nodes, same, fresh }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

describe('paint reports only real authored finish changes', () => {
  test('identical finish is an unchanged operation', () => {
    const { nodes, same } = fixture()
    const before = structuredClone(nodes)
    freeze(nodes)
    const outcome = paint(nodes, { targets: [same.id], material: finish }, context)
    expect(outcome.result).toMatchObject({ ok: true })
    expect(achievedChanges(nodes, outcome.changes!)).toEqual({
      created: {},
      updated: 0,
      deleted: {},
      unchanged: true,
    })
    expect(outcome.changes?.update ?? []).toEqual([])
    const after = applySceneChanges(nodes, outcome.changes)
    expect(after).toEqual(before)
    for (const [id, node] of Object.entries(nodes)) expect(after[id]).toBe(node)
    expect(nodes).toEqual(before)
  })

  test('mixed identical and first paints count only the changed target', () => {
    const { nodes, same, fresh } = fixture()
    const before = structuredClone(nodes)
    freeze(nodes)
    const outcome = paint(nodes, { targets: [same.id, fresh.id], material: finish }, context)
    expect(achievedChanges(nodes, outcome.changes!)).toEqual({
      created: {},
      updated: 1,
      deleted: {},
    })
    expect(outcome.changes?.update?.map(({ id }) => id)).toEqual([fresh.id])
    const after = applySceneChanges(nodes, outcome.changes)
    expect(after[fresh.id]).toEqual({
      ...before[fresh.id],
      slots: { ...fresh.slots, surface: finish },
    })
    expect(Object.keys(after)).toEqual(Object.keys(nodes))
    for (const [id, node] of Object.entries(nodes)) {
      if (id !== fresh.id) expect(after[id]).toBe(node)
    }
    expect(nodes).toEqual(before)
  })

  test('first paint remains positive and preserves other authored fields', () => {
    const { nodes, fresh } = fixture()
    const before = structuredClone(nodes)
    freeze(nodes)
    const outcome = paint(nodes, { targets: [fresh.id], material: finish }, context)
    expect(achievedChanges(nodes, outcome.changes!)).toEqual({
      created: {},
      updated: 1,
      deleted: {},
    })
    const after = applySceneChanges(nodes, outcome.changes)
    expect(after[fresh.id]).toEqual({
      ...before[fresh.id],
      slots: { ...fresh.slots, surface: finish },
    })
    expect(Object.keys(after)).toEqual(Object.keys(nodes))
    for (const [id, node] of Object.entries(nodes)) {
      if (id !== fresh.id) expect(after[id]).toBe(node)
    }
    expect(nodes).toEqual(before)
  })
})
