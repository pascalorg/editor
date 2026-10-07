import { describe, expect, test } from 'bun:test'
import { AGENT_OPERATIONS } from '../agent-operations'
import { BATH_CATALOG, bathScene } from '../agent-operations/__fixtures__/place-items-cases'
import type { AnyNode } from '../schema'
import { floorItemFit } from './floor-item-fit'

/**
 * place_items refuses a floor item in a door's way or too large for its room, and the item kind's
 * placement notice warns a person from the same check (nodes/src/item/placement-notice.ts). What
 * goes wrong, written first: place_items and the check disagreeing on the same spot.
 */

const assetOf = (id: string) => BATH_CATALOG.find((asset) => asset.id === id)!

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
