import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, FenceGateNode, FenceNode, LevelNode } from '../../schema'
import { fenceBodies } from './fences'
import type { Nodes } from './walls'

function scene(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

describe('fences', () => {
  test('a fence is a strip along its centreline from its support to its height', () => {
    const fence = FenceNode.parse({
      id: 'fence_1',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      height: 1.8,
      thickness: 0.08,
      postSize: 0.1,
    })
    const [shape] = fenceBodies(scene([fence])).fences
    expect(shape!.prisms).toHaveLength(1)
    const [prism] = shape!.prisms
    expect([prism!.z0, prism!.z1]).toEqual([0, 1.8])
    const zs = prism!.outer.map(([, z]) => z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.1, 6)
    expect(prism!.shape).toBe('approx')
  })

  test('a deck guard is read part by part: posts, cap, top rail, bottom rail and the infill as one strip', () => {
    const fence = FenceNode.parse({
      id: 'fence_1',
      parentId: 'level_1',
      start: [0, 0],
      end: [4, 0],
      style: 'guard',
      height: 1.05,
      postSpacing: 1.6,
    })
    const { prisms } = fenceBodies(scene([fence])).fences[0]!
    const group = (name: string) => prisms.filter((p) => p.id.startsWith(`fence_1#${name}.`))
    expect(group('post')).toHaveLength(4)
    expect(group('rail')).toHaveLength(2)
    expect(group('base')).toHaveLength(1)
    expect(group('infill')).toHaveLength(1)
    expect(prisms.every((p) => p.shape === 'exact' && p.kind === 'guard')).toBe(true)
    // the cap is 5.5 in wide, wider than the 0.1 post and the 0.08 strip a plain fence is
    const cap = group('rail')[0]!
    const zs = cap.outer.map(([, z]) => z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(5.5 * 0.0254, 6)
    expect(cap.z1).toBeCloseTo(1.05, 9)
    // the infill strip stands between the bottom rail and the top rail
    const [infill] = group('infill')
    expect(infill!.z0).toBeGreaterThan(group('base')[0]!.z0)
    expect(infill!.z1).toBeLessThanOrEqual(cap.z0)
  })

  test('a gate takes its width out of the strip', () => {
    const gate = FenceGateNode.parse({
      id: 'fence-gate_1',
      parentId: 'fence_1',
      center: 2,
      width: 1,
    })
    const fence = FenceNode.parse({
      id: 'fence_1',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      children: [gate.id],
    })
    const { prisms } = fenceBodies(scene([fence, gate])).fences[0]!
    expect(prisms).toHaveLength(2)
    const xs = (i: number) => prisms[i]!.outer.map(([x]) => x)
    expect(Math.max(...xs(0))).toBeCloseTo(1.5, 6)
    expect(Math.min(...xs(1))).toBeCloseTo(2.5, 6)
    expect(Math.max(...xs(1))).toBeCloseTo(6, 6)
  })

  test('a curved fence is a run of strips', () => {
    const fence = FenceNode.parse({
      id: 'fence_1',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      curveOffset: 1,
    })
    expect(fenceBodies(scene([fence])).fences[0]!.prisms.length).toBeGreaterThan(4)
  })
})
