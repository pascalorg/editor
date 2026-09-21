import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  getWallCurveLength,
  getWallEffectiveHeightForNodes,
  WallNode,
} from '@pascal-app/core'
import { wallSettings } from './panel-model'

function fixture() {
  let node = WallNode.parse({ start: [1, 2], end: [4, 2], children: [] })
  const nodes: Record<AnyNodeId, AnyNode> = { [node.id]: node }
  const rows = () =>
    wallSettings(node, nodes, (patch) => {
      node = { ...node, ...patch }
      nodes[node.id] = node
    })
  const row = (id: string) => {
    const result = rows().find((row) => row.id === id)
    if (!result) throw new Error(`Missing ${id}`)
    return result
  }
  const click = (id: string) => {
    const r = row(id)
    if (r.kind === 'choice') r.onSelect?.()
    else throw new Error('Expected choice')
  }
  const change = (id: string, value: number) => {
    const r = row(id)
    if (r.kind === 'stepper') r.onChange(value)
    else throw new Error('Expected stepper')
  }
  return {
    rows,
    row,
    click,
    change,
    nodes,
    get node() {
      return node
    },
  }
}

describe('Wall shared inspector', () => {
  test('height follows the level until explicitly detached; terrain infill preserves the top mode', () => {
    const f = fixture()
    const height = getWallEffectiveHeightForNodes(f.node, f.nodes)
    f.click('wall-bottom')
    expect(f.node.fillToTerrain).toBe(true)
    expect(f.node.height).toBeUndefined()
    f.click('wall-top')
    expect(f.node.height).toBe(Math.max(0.1, height))
    f.change('height', 3.2)
    expect(f.node.height).toBe(3.2)
    f.click('wall-top')
    expect(f.node.height).toBeUndefined()
    f.click('wall-bottom')
    expect(f.node.fillToTerrain).toBeUndefined()
  })
  test('length preserves start and direction; dimensions enforce their bounds', () => {
    const f = fixture()
    f.change('wall-length', 5)
    expect(f.node.start).toEqual([1, 2])
    expect(f.node.end).toEqual([6, 2])
    f.change('thickness', -2)
    expect(f.node.thickness).toBe(0.05)
    f.change('curveOffset', 999)
    expect(Math.abs(f.node.curveOffset ?? 0)).toBeLessThanOrEqual(2.5)
  })
  test('curved length edits scale the arc instead of confusing arc and chord length', () => {
    const f = fixture()
    f.change('curveOffset', 0.5)
    const previous = getWallCurveLength(f.node)
    f.change('wall-length', previous + 0.1)
    expect(getWallCurveLength(f.node)).toBeCloseTo(previous + 0.1, 6)
    expect(f.node.start).toEqual([1, 2])
  })

  test('bands reveal lower, middle and upper controls and preserve previous values', () => {
    const f = fixture()
    for (const count of [2, 3, 4]) {
      f.change('wall-band-count', count)
      expect(f.rows().filter((r) => r.id.startsWith('wall-band-'))).toHaveLength(count)
    }
    f.change('wall-band-lowerHeight', 0.3)
    f.change('wall-band-middleHeight', 0.4)
    f.change('wall-band-upperHeight', 0.5)
    expect(f.node.faceBands).toMatchObject({
      count: 4,
      enabled: true,
      lowerHeight: 0.3,
      middleHeight: 0.4,
      upperHeight: 0.5,
    })
    f.change('wall-band-count', 1)
    expect(f.rows().filter((r) => r.id.startsWith('wall-band-'))).toHaveLength(1)
  })
  for (const key of ['skirting', 'crown', 'chairRail'] as const)
    test(`${key}: every side/profile and dimension works without losing nested values`, () => {
      const f = fixture()
      f.click(`${key}-enabled`)
      const seen = new Set<string>()
      for (let index = 0; index < 5; index++) {
        const r = f.row(`${key}-profile`)
        if (r.kind !== 'cycle') throw new Error('Expected cycle')
        seen.add(r.value)
        r.next()
      }
      expect(seen.size).toBe(5)
      const sides = new Set<string>()
      for (let index = 0; index < 3; index++) {
        const r = f.row(`${key}-sides`)
        if (r.kind !== 'cycle') throw new Error('Expected cycle')
        sides.add(r.value)
        r.next()
      }
      expect(sides.size).toBe(3)
      f.change(`${key}-height`, 0.12)
      f.change(`${key}-proud`, 0.03)
      if (key === 'chairRail') f.change(`${key}-offset`, 0.8)
      expect(f.node[key]).toMatchObject({ enabled: true, height: 0.12, proud: 0.03 })
      f.click(`${key}-enabled`)
      expect(f.node[key]?.enabled).toBe(false)
      expect(f.node[key]?.height).toBe(0.12)
      expect(f.rows().some((r) => r.id === `${key}-profile`)).toBe(false)
    })
  test('hosted openings suppress curve editing', () => {
    const f = fixture()
    const id = 'door_test' as const
    f.node.children.push(id)
    f.nodes[id] = DoorNode.parse({ id })
    expect(f.rows().some((r) => r.id === 'curveOffset')).toBe(false)
  })
})
