import { describe, expect, test } from 'bun:test'
import { LevelNode } from './level'
import { StructuralGridNode } from './structural-grid'

describe('StructuralGridNode', () => {
  test('fills stable construction-document defaults', () => {
    const grid = StructuralGridNode.parse({})

    expect(grid.id).toStartWith('structural-grid_')
    expect(grid).toMatchObject({
      type: 'structural-grid',
      start: [0, 0],
      end: [0, 5],
      label: '1',
      showStartBubble: true,
      showEndBubble: true,
    })
  })

  test('is accepted as a level child', () => {
    expect(LevelNode.parse({ children: ['structural-grid_axis-1'] }).children).toEqual([
      'structural-grid_axis-1',
    ])
  })

  test('rejects empty labels and zero-length concerns stay in authoring', () => {
    expect(() => StructuralGridNode.parse({ label: '   ' })).toThrow()
    expect(StructuralGridNode.parse({ start: [1, 1], end: [1, 1], label: 'A' })).toMatchObject({
      start: [1, 1],
      end: [1, 1],
    })
  })
})
