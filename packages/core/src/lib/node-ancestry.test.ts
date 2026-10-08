import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { resolveLevelId, wouldCreateHierarchyCycle } from './node-ancestry'

const node = (id: string, type: string, parentId: string | null): AnyNode =>
  ({ children: [], id, object: 'node', parentId, type }) as unknown as AnyNode

const graph = (...entries: AnyNode[]): Record<string, AnyNode> =>
  Object.fromEntries(entries.map((n) => [n.id, n]))

describe('wouldCreateHierarchyCycle', () => {
  test('a node cannot become its own parent', () => {
    const nodes = graph(node('site_a', 'site', null))
    expect(wouldCreateHierarchyCycle('site_a' as AnyNodeId, 'site_a' as AnyNodeId, nodes)).toBe(
      true,
    )
  })

  test('a node cannot move under its direct child', () => {
    const nodes = graph(node('site_a', 'site', null), node('site_b', 'site', 'site_a'))
    expect(wouldCreateHierarchyCycle('site_a' as AnyNodeId, 'site_b' as AnyNodeId, nodes)).toBe(
      true,
    )
  })

  test('a node cannot move under a deeper descendant', () => {
    const nodes = graph(
      node('a', 'site', null),
      node('b', 'building', 'a'),
      node('c', 'level', 'b'),
    )
    expect(wouldCreateHierarchyCycle('a' as AnyNodeId, 'c' as AnyNodeId, nodes)).toBe(true)
  })

  test('an unrelated parent, a sibling and detaching to the root are allowed', () => {
    const nodes = graph(
      node('a', 'site', null),
      node('b', 'building', 'a'),
      node('other', 'site', null),
    )
    expect(wouldCreateHierarchyCycle('b' as AnyNodeId, 'other' as AnyNodeId, nodes)).toBe(false)
    expect(wouldCreateHierarchyCycle('b' as AnyNodeId, null, nodes)).toBe(false)
    expect(wouldCreateHierarchyCycle('b' as AnyNodeId, undefined, nodes)).toBe(false)
  })

  test('a parent chain that is already corrupt is refused, not walked forever', () => {
    const nodes = graph(
      node('x', 'site', null),
      node('loop_a', 'site', 'loop_b'),
      node('loop_b', 'site', 'loop_a'),
    )
    expect(wouldCreateHierarchyCycle('x' as AnyNodeId, 'loop_a' as AnyNodeId, nodes)).toBe(true)
  })

  test('a missing ancestor ends the walk instead of hanging', () => {
    const nodes = graph(node('orphan', 'building', 'gone'))
    expect(wouldCreateHierarchyCycle('n' as AnyNodeId, 'orphan' as AnyNodeId, nodes)).toBe(false)
  })
})

describe('resolveLevelId tolerates a corrupt parent chain', () => {
  // initSpatialGridSync calls this for every node on scene load, so a cycle
  // persisted by an older build (or arriving via import/migration/plugin) used
  // to spin forever and hang the tab instead of loading the scene.
  test('a cyclic chain with no level falls back instead of looping', () => {
    const nodes = graph(node('site_a', 'site', 'site_b'), node('site_b', 'site', 'site_a'))
    expect(resolveLevelId(nodes.site_a as AnyNode, nodes)).toBe('default')
  })

  test('a self-parented node falls back instead of looping', () => {
    const nodes = graph(node('site_s', 'site', 'site_s'))
    expect(resolveLevelId(nodes.site_s as AnyNode, nodes)).toBe('default')
  })

  test('a level still wins when it is reachable above a cycle', () => {
    const nodes = graph(
      node('wall', 'wall', 'level_1'),
      node('level_1', 'level', 'building_1'),
      node('building_1', 'building', 'level_1'),
    )
    expect(resolveLevelId(nodes.wall as AnyNode, nodes)).toBe('level_1')
  })

  test('a well-formed chain is unchanged', () => {
    const nodes = graph(
      node('wall', 'wall', 'level_1'),
      node('level_1', 'level', 'building_1'),
      node('building_1', 'building', null),
    )
    expect(resolveLevelId(nodes.wall as AnyNode, nodes)).toBe('level_1')
    expect(resolveLevelId(nodes.building_1 as AnyNode, nodes)).toBe('default')
  })
})
