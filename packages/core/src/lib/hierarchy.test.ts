import { describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '../schema'
import { findHierarchyCycles, wouldCreateHierarchyCycle } from './hierarchy'

const id = (value: string) => value as AnyNodeId

describe('wouldCreateHierarchyCycle', () => {
  test('a cycle already on the chain only counts when the node is on it', () => {
    const nodes = {
      site_a: { parentId: 'site_b' },
      site_b: { parentId: 'site_a' },
      level_x: { parentId: 'site_a' },
      wall_new: { parentId: null },
    }

    expect(wouldCreateHierarchyCycle(id('wall_new'), id('level_x'), nodes)).toBe(false)
    expect(wouldCreateHierarchyCycle(id('site_a'), id('level_x'), nodes)).toBe(true)
    expect(wouldCreateHierarchyCycle(id('level_x'), id('level_x'), nodes)).toBe(true)
    expect(findHierarchyCycles(nodes)).toEqual([['site_a', 'site_b']])
  })
})
