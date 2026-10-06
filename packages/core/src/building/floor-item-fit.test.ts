import { describe, expect, test } from 'bun:test'
import { AGENT_OPERATIONS } from '../agent-operations'
import { BATH_CATALOG, bathScene } from '../agent-operations/__fixtures__/place-items-cases'
import { type AnyNode, ItemNode } from '../schema'
import { floorItemFit, floorItemWarning } from './floor-item-fit'

/**
 * place_items refuses a floor item in a door's way or too large for its room, while the editor's
 * item tool checked only collisions. One check, the same for both: an agent is refused (it cannot
 * see), a person is warned. What goes wrong, written first: the editor and
 * place_items disagreeing on the same spot; a warning on an item that fits; an item on a table or
 * a wall warned as if on the floor; a room without a name breaking the sentence.
 */

const assetOf = (id: string) => BATH_CATALOG.find((asset) => asset.id === id)!

const tub = (id: string, x: number, z: number, rotationDeg = 0) =>
  ItemNode.parse({
    id: `item_${id}`,
    parentId: 'level_b',
    position: [x, 0, z],
    rotation: [0, (rotationDeg * Math.PI) / 180, 0],
    asset: assetOf(id),
  })

const nodesWith = (scene = bathScene(), ...items: AnyNode[]) => ({
  ...(scene.nodes as Record<string, AnyNode>),
  ...Object.fromEntries(items.map((item) => [item.id, item])),
})

describe('one fit check for place_items and the editor', () => {
  const spots: [string, number, number][] = [
    ['bath-1600', 1.1, 0.45],
    ['bathtub', 1.1, 1.3],
    ['vanity', 1.8, 1.6],
    ['bath-1600', 1.1, 1.45],
  ]
  for (const [assetId, x, z] of spots)
    test(`${assetId} at (${x}, ${z})`, () => {
      const nodes = nodesWith()
      const placed = AGENT_OPERATIONS.place_items(nodes, { items: [{ assetId, x, z }] } as never, {
        activeLevelId: null,
        catalog: BATH_CATALOG,
      }).result as { items: { ok: boolean; code?: string }[] }
      const fit = floorItemFit(nodes, {
        levelId: 'level_b',
        x,
        z,
        rotationDeg: 0,
        dimensions: assetOf(assetId).dimensions,
      })
      expect(fit?.code ?? null).toBe(placed.items[0]!.ok ? null : placed.items[0]!.code!)
    })
})

describe('the warning a person reads', () => {
  test('a bath across the door blocks the door to its room', () => {
    const item = tub('bath-1600', 1.1, 0.45)
    expect(floorItemWarning(nodesWith(bathScene(), item), item)).toEqual({
      line: 'Blocks the door to Bath',
    })
  })

  test('a bath larger than its room is too large for it, with both sizes', () => {
    const item = tub('bathtub', 1.1, 1.3)
    expect(floorItemWarning(nodesWith(bathScene(), item), item)).toEqual({
      line: 'Too large for Bath',
      detail: '2.34 × 1.11 m in a 2.2 × 1.9 m room',
    })
  })

  test('an item that fits has none', () => {
    const item = tub('vanity', 1.8, 1.6)
    expect(floorItemWarning(nodesWith(bathScene(), item), item)).toBeNull()
  })

  test('a room without a name still reads', () => {
    const scene = bathScene()
    const nodes = scene.nodes as Record<string, AnyNode>
    const unnamed = { ...nodes, zone_bath: { ...nodes.zone_bath!, name: '' } as AnyNode }
    const item = tub('bath-1600', 1.1, 0.45)
    expect(floorItemWarning({ ...unnamed, [item.id]: item }, item)).toEqual({
      line: 'Blocks a door',
    })
  })

  test('an item on something other than the floor is not checked', () => {
    const item = { ...tub('bath-1600', 1.1, 0.45), parentId: 'wall_bath' } as ItemNode
    expect(floorItemWarning(nodesWith(bathScene(), item), item)).toBeNull()
  })
})
