import { describe, expect, test } from 'bun:test'
import { countContentNodes, wouldClearSceneContent } from './scene-content-guard'

const scaffold = {
  nodes: {
    site_a: { type: 'site' },
    building_a: { type: 'building' },
    level_a: { type: 'level' },
  },
}

const house = {
  nodes: {
    site_a: { type: 'site' },
    building_a: { type: 'building' },
    level_a: { type: 'level' },
    slab_a: { type: 'slab' },
    wall_a: { type: 'wall' },
    wall_b: { type: 'wall' },
    zone_a: { type: 'zone' },
  },
}

describe('countContentNodes', () => {
  test('ignores the site/building/level scaffold', () => {
    expect(countContentNodes(scaffold)).toBe(0)
  })

  test('counts authored nodes only', () => {
    expect(countContentNodes(house)).toBe(4)
  })

  test('treats an empty or malformed graph as no content', () => {
    expect(countContentNodes({ nodes: {} })).toBe(0)
    expect(countContentNodes({})).toBe(0)
    expect(countContentNodes(null)).toBe(0)
    expect(countContentNodes(undefined)).toBe(0)
    expect(countContentNodes({ nodes: { a: null } })).toBe(0)
  })
})

describe('wouldClearSceneContent', () => {
  test('rejects the empty-graph autosave that wiped the stored scene', () => {
    expect(wouldClearSceneContent(house, { nodes: {} })).toBe(true)
  })

  test('rejects a scaffold-only autosave, not just a zero-node one', () => {
    // The regression this guards: versions 51/53/55 wrote 3-4 scaffold nodes,
    // which a naive "is the graph empty" check would have let through.
    expect(wouldClearSceneContent(house, scaffold)).toBe(true)
  })

  test('allows ordinary edits that shrink the scene', () => {
    const trimmed = {
      nodes: { site_a: { type: 'site' }, level_a: { type: 'level' }, wall_a: { type: 'wall' } },
    }
    expect(wouldClearSceneContent(house, trimmed)).toBe(false)
  })

  test('allows growing a scene', () => {
    expect(wouldClearSceneContent(scaffold, house)).toBe(false)
  })

  test('allows writing a scaffold over a scene that had no content anyway', () => {
    expect(wouldClearSceneContent(scaffold, { nodes: {} })).toBe(false)
  })
})
