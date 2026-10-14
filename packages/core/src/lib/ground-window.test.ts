import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import hillside from './__fixtures__/owner-hillside-grade.json'
import { buildingGroundBox, levelGroundBox, terrainBetweenEyeAndBox } from './ground-window'

// The owner's hillside house (14 Oct), trimmed to site/building/levels/slabs: a 6 m plateau
// on the street side (-z) past the walls, the pad under the house flat at 0.
const nodes = hillside.nodes as unknown as Record<AnyNodeId, AnyNode>
const levelByName = (name: string) =>
  Object.values(nodes).find((node) => node.type === 'level' && node.name === name)

describe('the ground window’s boxes', () => {
  test('a level’s box is its plate’s extent, floor to ceiling', () => {
    const garden = levelByName('Garden level · walk-out')
    const box = garden && levelGroundBox(nodes, garden.id)
    expect(box?.min).toEqual([-6.15, 0.15, -7.15])
    expect(box?.max[0]).toBe(6.15)
    expect(box?.max[2]).toBe(7.15)
    expect(box?.max[1]).toBeCloseTo(0.15 + 2.85, 6)
  })

  test('the building’s box wraps every level, attic roof plate to garden plate', () => {
    const box = buildingGroundBox(nodes)
    expect(box?.min[1]).toBeCloseTo(0.15, 6)
    // Garden 2.85 + living 2.85 + street 2.65 under the attic's 5.19 m storey, on its 0.2 plate.
    expect(box?.max[1]).toBeCloseTo(8.35 + 0.2 + 5.19, 2)
    expect(box?.min[0]).toBe(-6.15)
  })

  test('an id that is no level has no box', () => {
    expect(levelGroundBox(nodes, 'level_missing')).toBeNull()
  })
})

describe('terrainBetweenEyeAndBox', () => {
  const garden = levelByName('Garden level · walk-out')
  const box = garden && levelGroundBox(nodes, garden.id)

  test('from the street side the plateau stands between the eye and the garden level', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 7, -20], box)).toBe(true)
  })

  test('from the garden side nothing stands in the way', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 3, 20], box)).toBe(false)
  })

  test('from high over the house itself the sight lines drop inside the footprint', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 30, -2], box)).toBe(false)
  })

  test('an eye inside the box looks out, never through a window', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 1.5, 0], box)).toBe(false)
  })

  test('a flat site never stands in the way', () => {
    const site = Object.values(nodes).find((node) => node.type === 'site')
    const flat = {
      ...nodes,
      [site?.id as AnyNodeId]: { ...site, terrain: undefined },
    } as typeof nodes
    expect(box && terrainBetweenEyeAndBox(flat, [0, 7, -20], box)).toBe(false)
  })
})
