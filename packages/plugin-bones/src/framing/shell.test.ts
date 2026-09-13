import { describe, expect, test } from 'bun:test'
import { isFrameMember, shellNodeIds } from './shell'

const tree = {
  level_1: {
    type: 'level',
    children: ['wall_a', 'roof_1', 'slab_1', 'bones_framing', 'bones_svc', 'zone_1'],
  },
  wall_a: { type: 'wall', children: ['door_1', 'bones_dev'] },
  door_1: { type: 'door' },
  bones_dev: { type: 'bones:device' },
  roof_1: { type: 'roof', children: ['rseg_1', 'rseg_2'] },
  rseg_1: { type: 'roof-segment' },
  rseg_2: { type: 'roof-segment' },
  slab_1: { type: 'slab' },
  bones_framing: { type: 'bones:framing' },
  bones_svc: { type: 'bones:service' },
  zone_1: { type: 'zone' },
  level_2: { type: 'level', children: ['wall_z'] },
  wall_z: { type: 'wall' },
}

describe('isFrameMember — what the framing-only mode draws', () => {
  test('lumber, concrete, hardware and MEP runs draw; sheet layers do not', () => {
    for (const role of [
      'stud',
      'top-plate',
      'rafter',
      'ceiling-joist',
      'joist',
      'ridge',
      'header',
      'footing',
      'stemwall',
      'slab',
      'anchor-bolt',
      'uplift-connector',
      'wire-run',
      'pipe-run',
      'fascia',
    ]) {
      expect(isFrameMember({ role })).toBe(true)
    }
    for (const role of [
      'drywall',
      'sheathing',
      'wrb',
      'cladding',
      'insulation',
      'subfloor',
      'vapor-retarder',
      'drip-edge',
    ]) {
      expect(isFrameMember({ role })).toBe(false)
    }
  })
})

describe('shellNodeIds — what the framing-only mode hides', () => {
  test('every host node under the level, nested ones included, in tree order', () => {
    expect(shellNodeIds(tree, 'level_1')).toEqual([
      'wall_a',
      'door_1',
      'roof_1',
      'rseg_1',
      'rseg_2',
      'slab_1',
      'zone_1',
    ])
  })

  test('bones nodes are never shell, wherever they sit', () => {
    const ids = shellNodeIds(tree, 'level_1')
    expect(ids).not.toContain('bones_framing')
    expect(ids).not.toContain('bones_svc')
    expect(ids).not.toContain('bones_dev')
  })

  test('other levels are untouched; an unknown level or dangling child is harmless', () => {
    expect(shellNodeIds(tree, 'level_1')).not.toContain('wall_z')
    expect(shellNodeIds(tree, 'nope')).toEqual([])
    expect(shellNodeIds({ l: { type: 'level', children: ['gone'] } }, 'l')).toEqual([])
  })

  test('a cycle in a corrupt tree terminates', () => {
    const bad = {
      l: { type: 'level', children: ['a'] },
      a: { type: 'wall', children: ['b'] },
      b: { type: 'item', children: ['a'] },
    }
    expect(shellNodeIds(bad, 'l')).toEqual(['a', 'b'])
  })
})
