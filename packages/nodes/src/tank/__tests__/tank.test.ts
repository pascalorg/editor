import { describe, expect, test } from 'bun:test'
import { buildTankFloorplan } from '../floorplan'
import { tankParametrics } from '../parametrics'
import { TankNode } from '../schema'

describe('tank node', () => {
  test('accepts spherical tank kind and exposes the custom inspector panel', () => {
    const tank = TankNode.parse({ kind: 'spherical', diameter: 3 })

    expect(tank.kind).toBe('spherical')
    expect(tank.diameter).toBe(3)
    expect(tankParametrics.customPanel).toBeDefined()
  })

  test('renders spherical tanks as circular floorplan vessels with support legs', () => {
    const tank = TankNode.parse({
      kind: 'spherical',
      position: [2, 1.25, 3],
      diameter: 4,
      liquidLevel: 0.5,
    })

    const floorplan = buildTankFloorplan(tank)

    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    expect(floorplan.transform?.translate).toEqual([2, 3])
    expect(floorplan.children.filter((child) => child.kind === 'circle')).toHaveLength(6)
    expect(floorplan.children[0]).toMatchObject({ kind: 'circle', r: 2 })
  })
})
