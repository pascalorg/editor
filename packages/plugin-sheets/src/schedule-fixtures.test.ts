import { describe, expect, test } from 'bun:test'
import fixture from './__fixtures__/plancrafters-cottage.json'
import type { AnyNodeLike, NodeMap } from './model'
import {
  buildFixtureSchedule,
  DECOR,
  fixtureMark,
  fixtureMarks,
  isScheduledFixture,
  levelSubtree,
  serviceFor,
} from './schedule-fixtures'

const SCENE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes
const LEVEL_ID = (Object.values(SCENE).find((n) => n.type === 'level') as AnyNodeLike).id

/* ------------------------------------------------------ synthetic level */

/**
 * A hand-built level: two lavatories, a water closet, a dishwasher on a wall,
 * a decorative kettle that must NOT be scheduled, and a hidden toilet that
 * must not either. Small enough that every row can be checked by eye.
 */
function synthetic(): { nodes: NodeMap; levelId: string } {
  const item = (
    id: string,
    assetId: string,
    category: string,
    name: string,
    parentId: string,
    extra: Record<string, unknown> = {},
  ): AnyNodeLike => ({
    id,
    type: 'item',
    parentId,
    visible: true,
    asset: { id: assetId, category, name },
    ...extra,
  })
  const list: AnyNodeLike[] = [
    { id: 'level_1', type: 'level', parentId: 'building_1', level: 0, height: 2.7432 },
    { id: 'wall_1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [4, 0] },
    item('item_sink_b', 'bathroom-sink', 'bathroom', 'Bathroom Sink', 'level_1'),
    item('item_sink_a', 'bathroom-sink', 'bathroom', 'Bathroom Sink', 'level_1'),
    item('item_wc', 'toilet', 'bathroom', 'Toilet', 'level_1'),
    item('item_dw', 'dishwasher-movn72ls', 'appliance', 'Dishwasher', 'wall_1'),
    item('item_kettle', 'kettle', 'kitchen', 'Kettle', 'level_1'),
    item('item_hidden', 'toilet', 'bathroom', 'Toilet', 'level_1', { visible: false }),
  ]
  const nodes: NodeMap = {}
  for (const node of list) nodes[node.id] = node
  return { nodes, levelId: 'level_1' }
}

describe('the fixture schedule on a synthetic level', () => {
  const { nodes, levelId } = synthetic()

  test('walks the level through walls as well as the level itself', () => {
    const ids = levelSubtree(nodes, levelId).map((n) => n.id)
    expect(ids).toContain('wall_1')
    // The dishwasher is parented to the WALL, not the level.
    expect(ids).toContain('item_dw')
  })

  test('schedules fixtures, skips decor and skips hidden items', () => {
    const table = buildFixtureSchedule(nodes, levelId)
    expect(table.rows.map((r) => r.description)).toEqual(['BATHROOM SINK', 'DISHWASHER', 'TOILET'])
    expect(table.rows.map((r) => r.mark)).toEqual(['A01', 'A02', 'A03'])
    // Two identical lavatories collapse into one row with QTY 2; the hidden
    // toilet leaves the water closet at 1.
    expect(table.rows.map((r) => r.qty)).toEqual(['2', '1', '1'])
    expect(table.rows.map((r) => r.status)).toEqual(['NEW', 'NEW', 'NEW'])
  })

  test('the INFO column carries the rough-in key per fixture type', () => {
    const table = buildFixtureSchedule(nodes, levelId)
    expect(table.rows.map((r) => r.info)).toEqual([
      'PLUMBING: H,C,W',
      'PLUMBING: H,W · ELECTRIC',
      'PLUMBING: C,W',
    ])
  })

  test('fixtureMarks tags every scheduled item with its row label', () => {
    const marks = fixtureMarks(nodes, levelId)
    expect(marks.get('item_sink_a')).toBe('A01')
    expect(marks.get('item_sink_b')).toBe('A01')
    expect(marks.get('item_dw')).toBe('A02')
    expect(marks.get('item_wc')).toBe('A03')
    expect(marks.has('item_kettle')).toBe(false)
    expect(marks.has('item_hidden')).toBe(false)
  })

  test('labels are deterministic — the same scene always yields the same A01', () => {
    const reordered: NodeMap = {}
    for (const id of Object.keys(nodes).reverse()) reordered[id] = nodes[id] as AnyNodeLike
    expect([...fixtureMarks(reordered, levelId).entries()].sort()).toEqual(
      [...fixtureMarks(nodes, levelId).entries()].sort(),
    )
  })
})

describe('the rough-in mapping', () => {
  test('each fixture family gets the services it actually needs', () => {
    expect(serviceFor('kitchen-counter')).toBe('PLUMBING: H,C,W')
    expect(serviceFor('wall-sink')).toBe('PLUMBING: H,C,W')
    expect(serviceFor('toilet')).toBe('PLUMBING: C,W')
    expect(serviceFor('bathtub')).toBe('PLUMBING: H,C,W,T')
    expect(serviceFor('shower-angle')).toBe('PLUMBING: H,C,W,T')
    expect(serviceFor('washing-machine')).toBe('PLUMBING: H,C,W')
    expect(serviceFor('dishwasher-movn72ls')).toBe('PLUMBING: H,W · ELECTRIC')
    expect(serviceFor('fridge')).toBe('PLUMBING: C (ICE MAKER)')
    expect(serviceFor('water-heater')).toBe('PLUMBING: H,C · ELECTRIC')
    expect(serviceFor('stove')).toBe('ELECTRIC')
    expect(serviceFor('hood')).toBe('ELECTRIC')
    expect(serviceFor('ac-block')).toBe('ELECTRIC')
    expect(serviceFor('electric-panel')).toBe('ELECTRIC')
    // A dishwasher must never be read as a clothes washer.
    expect(serviceFor('dishwasher-movn72ls')).not.toBe(serviceFor('washing-machine'))
    // Nothing is invented for an unknown asset.
    expect(serviceFor('kitchen-shelf')).toBe('—')
  })

  test('decor in a scheduled category is excluded', () => {
    for (const id of ['kettle', 'toaster', 'fruits', 'toilet-paper', 'shower-rug']) {
      expect(DECOR.has(id)).toBe(true)
      expect(
        isScheduledFixture({
          id: `item_${id}`,
          type: 'item',
          asset: { id, category: 'kitchen', name: id },
        } as unknown as AnyNodeLike),
      ).toBe(false)
    }
  })

  test('labels run A01 … A99 then A100', () => {
    expect(fixtureMark(0)).toBe('A01')
    expect(fixtureMark(8)).toBe('A09')
    expect(fixtureMark(98)).toBe('A99')
    expect(fixtureMark(99)).toBe('A100')
  })
})

describe('the fixture schedule on the cottage', () => {
  test('reads the placed items and never the furniture', () => {
    const table = buildFixtureSchedule(SCENE, LEVEL_ID)
    const items = Object.values(SCENE).filter((n) => n.type === 'item')
    if (items.length === 0) {
      // The lead is still adding items to the fixture; an empty schedule is
      // the correct answer for a scene with none.
      expect(table.rows).toHaveLength(0)
      return
    }
    const descriptions = table.rows.map((r) => r.description)
    expect(descriptions).not.toContain('SOFA')
    expect(descriptions).not.toContain('DOUBLE BED')
    expect(descriptions).not.toContain('TELEVISION')
    // The QTY column accounts for every scheduled item exactly once.
    const scheduled = items.filter((n) => isScheduledFixture(n))
    expect(table.rows.reduce((n, r) => n + Number(r.qty), 0)).toBe(scheduled.length)
    // Marks are unique and in label order.
    expect(new Set(table.rows.map((r) => r.mark)).size).toBe(table.rows.length)
    expect(table.rows.map((r) => r.mark)).toEqual(table.rows.map((_, i) => fixtureMark(i)))
  })
})
