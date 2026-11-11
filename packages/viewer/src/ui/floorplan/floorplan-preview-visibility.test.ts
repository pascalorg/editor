import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { isVisibleInFloorplan } from './floorplan-preview-visibility'

const node = (id: string, type: string, parentId: string | null, visible = true) =>
  ({ object: 'node', id, type, parentId, visible, metadata: {} }) as unknown as AnyNode

describe('isVisibleInFloorplan', () => {
  test('a hidden Site keeps the buildings on it in the plan', () => {
    const nodes: Record<string, AnyNode> = {
      site_a: node('site_a', 'site', null, false),
      building_a: node('building_a', 'building', 'site_a'),
      level_a: node('level_a', 'level', 'building_a'),
      wall_a: node('wall_a', 'wall', 'level_a'),
      wall_b: node('wall_b', 'wall', 'level_a', false),
    }
    expect(isVisibleInFloorplan(nodes.wall_a!, nodes)).toBe(true)
    expect(isVisibleInFloorplan(nodes.wall_b!, nodes)).toBe(false)
    expect(isVisibleInFloorplan(nodes.site_a!, nodes)).toBe(false)
  })

  test('a hidden building or level still hides its subtree', () => {
    const nodes: Record<string, AnyNode> = {
      site_a: node('site_a', 'site', null),
      building_a: node('building_a', 'building', 'site_a', false),
      level_a: node('level_a', 'level', 'building_a'),
      wall_a: node('wall_a', 'wall', 'level_a'),
      building_b: node('building_b', 'building', 'site_a'),
      level_b: node('level_b', 'level', 'building_b', false),
      wall_b: node('wall_b', 'wall', 'level_b'),
    }
    expect(isVisibleInFloorplan(nodes.wall_a!, nodes)).toBe(false)
    expect(isVisibleInFloorplan(nodes.wall_b!, nodes)).toBe(false)
  })
})
