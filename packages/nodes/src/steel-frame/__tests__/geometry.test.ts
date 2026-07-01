import { describe, expect, test } from 'bun:test'
import { buildSteelFrameFloorplan } from '../floorplan'
import { buildSteelFrameGeometry } from '../geometry'
import { SteelFrameNode } from '../schema'

function frame(overrides: Partial<SteelFrameNode> = {}): SteelFrameNode {
  return SteelFrameNode.parse({
    name: 'Test Steel Frame',
    ...overrides,
  })
}

describe('steel frame node', () => {
  test('builds columns from row and column counts', () => {
    const node = frame({ levels: 3, columns: 4, rows: 2 })
    const group = buildSteelFrameGeometry(node)
    const columns = group.children.filter((child) => child.name === 'steel-frame-column')
    expect(columns).toHaveLength(8)
  })

  test('migrates removed x brace style to single diagonal', () => {
    const parsed = SteelFrameNode.parse({ braceStyle: 'x' })
    expect(parsed.braceStyle).toBe('single-diagonal')
  })

  test('renders floorplan grid posts for configurable frame levels and columns', () => {
    const node = frame({ columns: 5, rows: 3, position: [2, 0, 4] })
    const floorplan = buildSteelFrameFloorplan(node)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') throw new Error('expected floorplan group')
    expect(floorplan.transform?.translate).toEqual([2, 4])
    expect(floorplan.children.filter((child) => child.kind === 'circle')).toHaveLength(15)
  })
})
