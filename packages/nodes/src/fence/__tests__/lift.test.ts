import { describe, expect, test } from 'bun:test'
import { type AnyNode, FenceNode, SlabNode } from '@pascal-app/core'
import { resolveFenceLiftElevation } from '../lift'

const LEVEL_ID = 'level-1'

function makeDeck(elevation: number, parentId: string | null = LEVEL_ID): SlabNode {
  return SlabNode.parse({
    parentId,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    elevation,
    thickness: 0.05,
  })
}

function makeRailing(supportSlabId: string | undefined, parentId: string | null = LEVEL_ID) {
  return FenceNode.parse({
    parentId,
    start: [0, 0],
    end: [4, 0],
    supportSlabId,
  })
}

function resolverFor(...nodes: AnyNode[]) {
  const byId = new Map(nodes.map((node) => [node.id as string, node]))
  return (id: string) => byId.get(id)
}

describe('resolveFenceLiftElevation', () => {
  test('lifts onto the host slab walking surface', () => {
    const deck = makeDeck(1.25)
    const railing = makeRailing(deck.id)
    expect(resolveFenceLiftElevation(railing, resolverFor(deck))).toBe(1.25)
  })

  test('unhosted fence stays on the level floor', () => {
    const railing = makeRailing(undefined)
    expect(resolveFenceLiftElevation(railing, resolverFor())).toBe(0)
  })

  test('stale host (slab gone) falls back to the floor', () => {
    const deck = makeDeck(1.25)
    const railing = makeRailing(deck.id)
    expect(resolveFenceLiftElevation(railing, resolverFor())).toBe(0)
  })

  test('host on another level does not lift the fence', () => {
    const deck = makeDeck(1.25, 'level-2')
    const railing = makeRailing(deck.id)
    expect(resolveFenceLiftElevation(railing, resolverFor(deck))).toBe(0)
  })

  test('host id resolving to a non-slab node is ignored', () => {
    const deck = makeDeck(1.25)
    const impostor = makeRailing(undefined)
    const railing = makeRailing(impostor.id)
    expect(resolveFenceLiftElevation(railing, resolverFor(deck, impostor))).toBe(0)
  })
})
