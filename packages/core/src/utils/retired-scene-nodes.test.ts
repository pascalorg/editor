import { describe, expect, test } from 'bun:test'
import { removeRetiredDrawingSheetNodes } from './retired-scene-nodes'

describe('removeRetiredDrawingSheetNodes', () => {
  test('removes retired nodes and parent references without mutating the input', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'drawing-sheet_a101'],
      },
      'drawing-sheet_a101': {
        id: 'drawing-sheet_a101',
        type: 'drawing-sheet',
        parentId: 'building_test',
      },
      level_test: { id: 'level_test', type: 'level' },
    }

    const result = removeRetiredDrawingSheetNodes(nodes)

    expect(result.removedNodeIds).toEqual(new Set(['drawing-sheet_a101']))
    expect(result.nodes).not.toBe(nodes)
    expect(result.nodes['drawing-sheet_a101']).toBeUndefined()
    expect(result.nodes.building_test.children).toEqual(['level_test'])
    expect(nodes.building_test.children).toEqual(['level_test', 'drawing-sheet_a101'])
    expect(nodes['drawing-sheet_a101']).toBeDefined()
  })

  test('returns the original node map when no retired nodes are present', () => {
    const nodes = {
      level_test: { id: 'level_test', type: 'level' },
    }

    const result = removeRetiredDrawingSheetNodes(nodes)

    expect(result.nodes).toBe(nodes)
    expect(result.removedNodeIds.size).toBe(0)
  })
})
