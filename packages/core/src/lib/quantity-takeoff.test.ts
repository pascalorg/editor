import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  buildQuantityTakeoff,
  collectNodesByKind,
  mergeQuantityRows,
  type QuantitiesContribution,
  type QuantityRow,
  quantityTakeoffToCsv,
} from './quantity-takeoff'

const node = (id: string, type: string, extra: Record<string, unknown> = {}): AnyNode =>
  ({
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    ...extra,
  }) as unknown as AnyNode

const scene = (...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>

const LEVEL = 'level_1' as AnyNodeId

function level(children: string[]): AnyNode {
  return node('level_1', 'level', { children })
}

describe('collectNodesByKind', () => {
  test('walks the subtree and buckets by kind', () => {
    const nodes = scene(
      level(['wall_1', 'wall_2', 'door_1']),
      node('wall_1', 'wall'),
      node('wall_2', 'wall'),
      node('door_1', 'door'),
    )

    const byKind = collectNodesByKind(nodes, LEVEL)
    expect(byKind.get('wall')).toHaveLength(2)
    expect(byKind.get('door')).toHaveLength(1)
  })

  test('descends through nested children', () => {
    const nodes = scene(
      level(['wall_1']),
      node('wall_1', 'wall', { children: ['door_1'] }),
      node('door_1', 'door'),
    )

    expect(collectNodesByKind(nodes, LEVEL).get('door')).toHaveLength(1)
  })

  test('leaves hidden nodes out — they are not part of the model being read', () => {
    const nodes = scene(
      level(['wall_1', 'wall_2']),
      node('wall_1', 'wall'),
      node('wall_2', 'wall', { visible: false }),
    )

    expect(collectNodesByKind(nodes, LEVEL).get('wall')).toHaveLength(1)
  })

  test('survives a cycle in children rather than hanging', () => {
    const nodes = scene(level(['wall_1']), node('wall_1', 'wall', { children: ['level_1'] }))

    expect(collectNodesByKind(nodes, LEVEL).get('wall')).toHaveLength(1)
  })

  test('a missing root yields nothing', () => {
    expect(collectNodesByKind({}, LEVEL).size).toBe(0)
  })
})

describe('mergeQuantityRows', () => {
  const row = (patch: Partial<QuantityRow>): QuantityRow => ({
    key: 'length',
    label: 'Length',
    unit: 'length',
    value: 1,
    ...patch,
  })

  test('sums rows sharing a key and counts the nodes behind them', () => {
    const merged = mergeQuantityRows([row({ value: 3 }), row({ value: 4 })])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ value: 7, nodeCount: 2 })
  })

  test('keeps different groups apart so a total can be split by material', () => {
    const merged = mergeQuantityRows([
      row({ value: 3, group: 'Brick' }),
      row({ value: 4, group: 'Timber' }),
      row({ value: 1, group: 'Brick' }),
    ])

    expect(merged).toHaveLength(2)
    expect(merged.find((line) => line.group === 'Brick')?.value).toBe(4)
    expect(merged.find((line) => line.group === 'Timber')?.value).toBe(4)
  })

  test('drops non-finite values rather than poisoning a total with NaN', () => {
    const merged = mergeQuantityRows([row({ value: 5 }), row({ value: Number.NaN })])
    expect(merged[0]?.value).toBe(5)
    expect(merged[0]?.nodeCount).toBe(1)
  })

  test('an empty input merges to nothing', () => {
    expect(mergeQuantityRows([])).toEqual([])
  })
})

describe('buildQuantityTakeoff', () => {
  const wallQuantities: QuantitiesContribution<AnyNode> = (walls) => ({
    label: 'Walls',
    rows: walls.map((wall) => ({
      key: 'length',
      label: 'Length',
      unit: 'length' as const,
      value: (wall as unknown as { length: number }).length,
    })),
  })

  const doorQuantities: QuantitiesContribution<AnyNode> = (doors) => ({
    label: 'Doors',
    rows: [{ key: 'count', label: 'Count', unit: 'count' as const, value: doors.length }],
  })

  const registry: Record<string, QuantitiesContribution<AnyNode>> = {
    wall: wallQuantities,
    door: doorQuantities,
  }
  const resolve = (kind: string) => registry[kind]

  const sampleScene = () =>
    scene(
      level(['wall_1', 'wall_2', 'door_1', 'spawn_1']),
      node('wall_1', 'wall', { length: 4 }),
      node('wall_2', 'wall', { length: 6 }),
      node('door_1', 'door'),
      node('spawn_1', 'spawn'),
    )

  test('rolls each kind up into a section', () => {
    const takeoff = buildQuantityTakeoff(sampleScene(), LEVEL, resolve)

    expect(takeoff.sections.map((section) => section.label)).toEqual(['Doors', 'Walls'])
    const walls = takeoff.sections.find((section) => section.kind === 'wall')
    expect(walls?.lines[0]).toMatchObject({ value: 10, nodeCount: 2 })
  })

  test('a kind with no contribution is counted but not reported', () => {
    const takeoff = buildQuantityTakeoff(sampleScene(), LEVEL, resolve)

    expect(takeoff.sections.some((section) => section.kind === 'spawn')).toBe(false)
    // level + 2 walls + door + spawn
    expect(takeoff.nodeCount).toBe(5)
  })

  test('sections are ordered by label, not by registry insertion order', () => {
    const reversed = (kind: string) =>
      ({ door: doorQuantities, wall: wallQuantities })[kind] as
        | QuantitiesContribution<AnyNode>
        | undefined
    expect(buildQuantityTakeoff(sampleScene(), LEVEL, reversed).sections[0]?.label).toBe('Doors')
  })

  test('a contribution returning null is skipped', () => {
    const takeoff = buildQuantityTakeoff(sampleScene(), LEVEL, () => () => null)
    expect(takeoff.sections).toEqual([])
  })

  test('a contribution with no rows produces no empty section', () => {
    const takeoff = buildQuantityTakeoff(sampleScene(), LEVEL, () => () => ({
      label: 'Empty',
      rows: [],
    }))
    expect(takeoff.sections).toEqual([])
  })

  test('hidden nodes stay out of the totals', () => {
    const nodes = scene(
      level(['wall_1', 'wall_2']),
      node('wall_1', 'wall', { length: 4 }),
      node('wall_2', 'wall', { length: 6, visible: false }),
    )

    expect(buildQuantityTakeoff(nodes, LEVEL, resolve).sections[0]?.lines[0]?.value).toBe(4)
  })
})

describe('quantityTakeoffToCsv', () => {
  const takeoff = {
    nodeCount: 3,
    sections: [
      {
        kind: 'wall',
        label: 'Walls',
        lines: [
          { key: 'length', label: 'Length', unit: 'length' as const, value: 10.5, nodeCount: 2 },
          {
            key: 'area',
            label: 'Face area',
            unit: 'area' as const,
            value: 26.25,
            nodeCount: 2,
            group: 'Brick',
          },
        ],
      },
    ],
  }

  test('writes a header and one row per line', () => {
    const rows = quantityTakeoffToCsv(takeoff).split('\n')
    expect(rows[0]).toBe('Category,Item,Group,Quantity,Unit,Count')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toBe('Walls,Length,,10.5,m,2')
    expect(rows[2]).toBe('Walls,Face area,Brick,26.25,m²,2')
  })

  test('keeps quantities numeric so a spreadsheet can sum the column', () => {
    const quantityColumn = quantityTakeoffToCsv(takeoff).split('\n')[1]?.split(',')[3]
    expect(Number.isNaN(Number(quantityColumn))).toBe(false)
  })

  test('quotes a label containing a comma', () => {
    const csv = quantityTakeoffToCsv({
      nodeCount: 1,
      sections: [
        {
          kind: 'wall',
          label: 'Walls, external',
          lines: [
            { key: 'length', label: 'Length', unit: 'length' as const, value: 1, nodeCount: 1 },
          ],
        },
      ],
    })
    expect(csv.split('\n')[1]).toBe('"Walls, external",Length,,1,m,1')
  })

  test('escapes an embedded quote by doubling it', () => {
    const csv = quantityTakeoffToCsv({
      nodeCount: 1,
      sections: [
        {
          kind: 'wall',
          label: 'Walls',
          lines: [
            {
              key: 'length',
              label: 'Length',
              unit: 'length' as const,
              value: 1,
              nodeCount: 1,
              group: '2" studs',
            },
          ],
        },
      ],
    })
    expect(csv.split('\n')[1]).toBe('Walls,Length,"2"" studs",1,m,1')
  })

  test('an empty takeoff is still a valid one-line CSV', () => {
    expect(quantityTakeoffToCsv({ nodeCount: 0, sections: [] })).toBe(
      'Category,Item,Group,Quantity,Unit,Count',
    )
  })
})
