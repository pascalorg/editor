import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  applyHeightPatch,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  FenceNode,
  flattenPatch,
  LevelNode,
  SlabNode,
} from '@pascal-app/core'
import { resolveFenceLiftElevation, resolveFenceLiftElevationForNodes } from '../lift'

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

function makeRailing(
  supportSlabId: string | undefined,
  parentId: string | null = LEVEL_ID,
  supportOffset?: number,
) {
  return FenceNode.parse({
    parentId,
    start: [0, 0],
    end: [4, 0],
    supportSlabId,
    supportOffset,
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

  test('adds a manual support offset without changing the support source', () => {
    const deck = makeDeck(1.25)

    expect(resolveFenceLiftElevation(makeRailing(deck.id, LEVEL_ID, 0.4), resolverFor(deck))).toBe(
      1.65,
    )
    expect(resolveFenceLiftElevation(makeRailing(undefined, LEVEL_ID, -0.3), resolverFor())).toBe(
      -0.3,
    )
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

  test('an unhosted fence stands on the ground, not the storey plane', () => {
    const railing = makeRailing(undefined)
    expect(resolveFenceLiftElevation(railing, resolverFor(), 1.4)).toBe(1.4)
    // The offset is a delta from the support, so it rides the ground with it.
    expect(
      resolveFenceLiftElevation(makeRailing(undefined, LEVEL_ID, 0.2), resolverFor(), 1.4),
    ).toBeCloseTo(1.6)
  })

  test('a live host slab wins over the ground under it', () => {
    // A deck pad on a hillside is a built surface: the railing on it stays flat
    // at the pad's elevation rather than following the terrain around it.
    const deck = makeDeck(1.25)
    expect(resolveFenceLiftElevation(makeRailing(deck.id), resolverFor(deck), 1.4)).toBe(1.25)
  })

  test('a stale host falls back to the ground, not to zero', () => {
    const deck = makeDeck(1.25)
    const railing = makeRailing(deck.id)
    // Deleted host.
    expect(resolveFenceLiftElevation(railing, resolverFor(), 1.4)).toBe(1.4)
    // Host on another level.
    const offLevel = makeDeck(1.25, 'level-2')
    expect(resolveFenceLiftElevation(makeRailing(offLevel.id), resolverFor(offLevel), 1.4)).toBe(
      1.4,
    )
  })
})

describe('resolveFenceLiftElevationForNodes', () => {
  const SPACING = 1
  const COLS = 9

  /** A site whose ground is a flat plateau at `height`, covering the fence. */
  function plateauSite(height: number) {
    let field = createTerrainField({
      cols: COLS,
      rows: COLS,
      spacing: SPACING,
      origin: [-4, -4],
    })
    const patch = flattenPatch(field, { minX: -4, minZ: -4, maxX: 4, maxZ: 4 }, height)
    if (patch) field = applyHeightPatch(field, patch)
    return {
      id: 'site_test',
      type: 'site',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_a'],
      terrain: encodeTerrainField(field),
    } as unknown as AnyNode
  }

  /** `level_0` at grade under a building on `site_test`, holding one fence. */
  function sceneWith(fence: AnyNode, site: AnyNode | null) {
    return Object.fromEntries(
      [
        ...(site ? [site] : []),
        BuildingNode.parse({
          id: 'building_a',
          parentId: site?.id ?? null,
          children: ['level_0'],
        }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: [fence.id],
        }),
        fence,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
  }

  function railingOnLevel(supportSlabId?: string, supportOffset?: number) {
    return FenceNode.parse({
      id: 'fence_test',
      parentId: 'level_0',
      start: [0, 0],
      end: [3, 0],
      supportSlabId,
      supportOffset,
    }) as AnyNode
  }

  test('an unhosted fence inherits the sculpted ground', () => {
    const fence = railingOnLevel()
    const nodes = sceneWith(fence, plateauSite(1.5))
    expect(resolveFenceLiftElevationForNodes(fence as never, nodes)).toBeCloseTo(1.5)
  })

  test('no terrain keeps the fence on the storey plane', () => {
    const fence = railingOnLevel()
    expect(resolveFenceLiftElevationForNodes(fence as never, sceneWith(fence, null))).toBe(0)
  })

  test('a manual offset stays a delta from the ground', () => {
    const fence = railingOnLevel(undefined, 0.25)
    const nodes = sceneWith(fence, plateauSite(1.5))
    expect(resolveFenceLiftElevationForNodes(fence as never, nodes)).toBeCloseTo(1.75)
  })
})
