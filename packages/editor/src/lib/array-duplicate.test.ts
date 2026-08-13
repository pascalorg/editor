import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  buildArrayOffsets,
  detectUniformTranslation,
  isArrayCommandPrefix,
  MAX_ARRAY_COUNT,
  offsetPosition,
  parseArrayCommand,
  translateNodeGeometry,
  type Vector3,
} from './array-duplicate'

const node = (id: string, position: Vector3, extra: Record<string, unknown> = {}): AnyNode =>
  ({
    object: 'node',
    id,
    type: 'item',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    position,
    ...extra,
  }) as unknown as AnyNode

const map = (...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>

describe('parseArrayCommand', () => {
  test('reads the repeat form in either order', () => {
    expect(parseArrayCommand('*12')).toEqual({ kind: 'repeat', count: 12 })
    expect(parseArrayCommand('12*')).toEqual({ kind: 'repeat', count: 12 })
  })

  test('reads the divide form in either order', () => {
    expect(parseArrayCommand('/4')).toEqual({ kind: 'divide', count: 4 })
    expect(parseArrayCommand('4/')).toEqual({ kind: 'divide', count: 4 })
  })

  test('tolerates surrounding and inner whitespace', () => {
    expect(parseArrayCommand('  * 6 ')).toEqual({ kind: 'repeat', count: 6 })
  })

  test('rejects anything that is not a bare count', () => {
    for (const input of ['', '*', '/', '12', '*0', '*-3', '*1.5', '**2', '2*3', 'x*2', '*2m']) {
      expect(parseArrayCommand(input)).toBeNull()
    }
  })

  test('caps the count so one typo cannot clone a scene flat', () => {
    expect(parseArrayCommand(`*${MAX_ARRAY_COUNT}`)).toEqual({
      kind: 'repeat',
      count: MAX_ARRAY_COUNT,
    })
    expect(parseArrayCommand(`*${MAX_ARRAY_COUNT + 1}`)).toBeNull()
  })
})

describe('isArrayCommandPrefix', () => {
  test('recognises a half-typed command', () => {
    expect(isArrayCommandPrefix('*')).toBe(true)
    expect(isArrayCommandPrefix('*1')).toBe(true)
    expect(isArrayCommandPrefix('4/')).toBe(true)
  })

  test('a plain number is a length, not an array command', () => {
    expect(isArrayCommandPrefix('12')).toBe(false)
    expect(isArrayCommandPrefix('')).toBe(false)
  })
})

describe('detectUniformTranslation', () => {
  test('recognises a single node moving', () => {
    const before = map(node('item_1', [0, 0, 0]))
    const current = map(node('item_1', [2, 0, 1]))

    expect(detectUniformTranslation(before, current)).toEqual({
      nodeIds: ['item_1' as AnyNodeId],
      translation: [2, 0, 1],
    })
  })

  test('recognises a group moving together, ignoring untouched nodes', () => {
    const before = map(
      node('item_1', [0, 0, 0]),
      node('item_2', [5, 0, 0]),
      node('item_3', [9, 0, 0]),
    )
    const current = map(
      node('item_1', [0, 0, 3]),
      node('item_2', [5, 0, 3]),
      node('item_3', [9, 0, 0]),
    )

    const result = detectUniformTranslation(before, current)
    expect(result?.translation).toEqual([0, 0, 3])
    expect(result?.nodeIds.sort()).toEqual(['item_1', 'item_2'] as AnyNodeId[])
  })

  test('two different deltas is a reshape, not a move', () => {
    const before = map(node('item_1', [0, 0, 0]), node('item_2', [5, 0, 0]))
    const current = map(node('item_1', [1, 0, 0]), node('item_2', [7, 0, 0]))

    expect(detectUniformTranslation(before, current)).toBeNull()
  })

  test('a node that also changed another field is not a move', () => {
    const before = map(node('item_1', [0, 0, 0], { rotation: 0 }))
    const current = map(node('item_1', [1, 0, 0], { rotation: 1.57 }))

    expect(detectUniformTranslation(before, current)).toBeNull()
  })

  test('a creation or deletion is not a move', () => {
    const before = map(node('item_1', [0, 0, 0]))
    const current = map(node('item_1', [1, 0, 0]), node('item_2', [4, 0, 0]))

    expect(detectUniformTranslation(before, current)).toBeNull()
    expect(detectUniformTranslation(current, before)).toBeNull()
  })

  test('a node without a position field cannot explain its own change', () => {
    const wall = { object: 'node', id: 'wall_1', type: 'wall', metadata: {} } as unknown as AnyNode
    const moved = { ...wall, thickness: 0.2 } as AnyNode

    expect(detectUniformTranslation(map(wall), map(moved))).toBeNull()
  })

  test('an unchanged scene arms nothing', () => {
    const before = map(node('item_1', [0, 0, 0]))
    expect(detectUniformTranslation(before, before)).toBeNull()
  })

  test('sub-micrometre jitter is a click, not a translation', () => {
    const before = map(node('item_1', [0, 0, 0]))
    const current = map(node('item_1', [1e-9, 0, 0]))

    expect(detectUniformTranslation(before, current)).toBeNull()
  })
})

describe('buildArrayOffsets', () => {
  const t: Vector3 = [2, 0, 0]

  test('repeat walks the same vector n more times', () => {
    expect(buildArrayOffsets(t, { kind: 'repeat', count: 3 })).toEqual([
      [2, 0, 0],
      [4, 0, 0],
      [6, 0, 0],
    ])
  })

  test('divide fills the gap the move opened, stepping back', () => {
    expect(buildArrayOffsets(t, { kind: 'divide', count: 4 })).toEqual([
      [-0.5, 0, 0],
      [-1, 0, 0],
      [-1.5, 0, 0],
    ])
  })

  test('dividing into one part adds nothing', () => {
    expect(buildArrayOffsets(t, { kind: 'divide', count: 1 })).toEqual([])
  })

  test('a divided run lands evenly between the two originals', () => {
    const offsets = buildArrayOffsets(t, { kind: 'divide', count: 4 })
    // Moved node sits at x=2; originals at 0 and 2, copies at 1.5, 1, 0.5.
    const xs = offsets.map((offset) => offsetPosition([2, 0, 0], offset)[0]).sort((a, b) => a - b)
    expect(xs).toEqual([0.5, 1, 1.5])
  })

  test('carries all three axes', () => {
    expect(buildArrayOffsets([1, 2, 3], { kind: 'repeat', count: 2 })).toEqual([
      [1, 2, 3],
      [2, 4, 6],
    ])
  })
})

describe('offsetPosition', () => {
  test('adds componentwise', () => {
    expect(offsetPosition([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33])
  })
})

describe('kinds without a position field', () => {
  const wall = (id: string, start: [number, number], end: [number, number]): AnyNode =>
    ({
      object: 'node',
      id,
      type: 'wall',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      start,
      end,
      thickness: 0.2,
    }) as unknown as AnyNode

  const slab = (id: string, polygon: Array<[number, number]>): AnyNode =>
    ({
      object: 'node',
      id,
      type: 'slab',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      polygon,
    }) as unknown as AnyNode

  test('a wall moves through its start/end pair', () => {
    const before = map(wall('wall_1', [0, 0], [4, 0]))
    const current = map(wall('wall_1', [0, 3], [4, 3]))

    // Plan points are [x, z], so the delta lands on the Z component.
    expect(detectUniformTranslation(before, current)).toEqual({
      nodeIds: ['wall_1' as AnyNodeId],
      translation: [0, 0, 3],
    })
  })

  test('a wall whose ends moved differently is a reshape, not a move', () => {
    const before = map(wall('wall_1', [0, 0], [4, 0]))
    const current = map(wall('wall_1', [0, 3], [4, 5]))

    expect(detectUniformTranslation(before, current)).toBeNull()
  })

  test('dragging one wall endpoint is not a move', () => {
    const before = map(wall('wall_1', [0, 0], [4, 0]))
    const current = map(wall('wall_1', [0, 0], [7, 0]))

    expect(detectUniformTranslation(before, current)).toBeNull()
  })

  test('a slab moves through every polygon vertex together', () => {
    const before = map(
      slab('slab_1', [
        [0, 0],
        [4, 0],
        [4, 4],
      ]),
    )
    const current = map(
      slab('slab_1', [
        [2, 0],
        [6, 0],
        [6, 4],
      ]),
    )

    expect(detectUniformTranslation(before, current)).toEqual({
      nodeIds: ['slab_1' as AnyNodeId],
      translation: [2, 0, 0],
    })
  })

  test('a slab with one vertex dragged is a reshape', () => {
    const before = map(
      slab('slab_1', [
        [0, 0],
        [4, 0],
        [4, 4],
      ]),
    )
    const current = map(
      slab('slab_1', [
        [0, 0],
        [5, 0],
        [4, 4],
      ]),
    )

    expect(detectUniformTranslation(before, current)).toBeNull()
  })

  test('a wall and an item moving together share one translation', () => {
    const before = map(wall('wall_1', [0, 0], [4, 0]), node('item_1', [0, 0, 0]))
    const current = map(wall('wall_1', [1, 0], [5, 0]), node('item_1', [1, 0, 0]))

    const result = detectUniformTranslation(before, current)
    expect(result?.translation).toEqual([1, 0, 0])
    expect(result?.nodeIds.sort()).toEqual(['item_1', 'wall_1'] as AnyNodeId[])
  })

  test('a wall that also got thicker is not a move', () => {
    const before = map(wall('wall_1', [0, 0], [4, 0]))
    const thicker = { ...wall('wall_1', [1, 0], [5, 0]), thickness: 0.3 } as AnyNode
    expect(detectUniformTranslation(before, map(thicker))).toBeNull()
  })
})

describe('translateNodeGeometry', () => {
  test('shifts a position in all three axes', () => {
    const moved = translateNodeGeometry(
      { position: [1, 2, 3] } as unknown as AnyNode,
      [10, 20, 30],
    ) as unknown as { position: number[] }
    expect(moved.position).toEqual([11, 22, 33])
  })

  test('shifts plan points using x and z, dropping y', () => {
    const moved = translateNodeGeometry(
      { start: [0, 0], end: [4, 0] } as unknown as AnyNode,
      [2, 99, 3],
    ) as unknown as { start: number[]; end: number[] }
    expect(moved.start).toEqual([2, 3])
    expect(moved.end).toEqual([6, 3])
  })

  test('shifts every vertex of a polygon and its holes', () => {
    const moved = translateNodeGeometry(
      {
        polygon: [
          [0, 0],
          [4, 0],
        ],
        holes: [
          [
            [1, 1],
            [2, 1],
          ],
        ],
      } as unknown as AnyNode,
      [1, 0, 1],
    ) as unknown as { polygon: number[][]; holes: number[][][] }
    expect(moved.polygon).toEqual([
      [1, 1],
      [5, 1],
    ])
    expect(moved.holes).toEqual([
      [
        [2, 2],
        [3, 2],
      ],
    ])
  })

  test('leaves non-geometry fields untouched', () => {
    const moved = translateNodeGeometry(
      { id: 'wall_1', thickness: 0.2, start: [0, 0] } as unknown as AnyNode,
      [1, 0, 0],
    ) as unknown as { id: string; thickness: number }
    expect(moved.id).toBe('wall_1')
    expect(moved.thickness).toBe(0.2)
  })

  test('does not mutate the source node', () => {
    const source = { position: [0, 0, 0] } as unknown as AnyNode
    translateNodeGeometry(source, [5, 0, 0])
    expect((source as unknown as { position: number[] }).position).toEqual([0, 0, 0])
  })
})
