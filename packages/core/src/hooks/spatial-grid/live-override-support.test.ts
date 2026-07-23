import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, SlabNode } from '../../schema'
import useLiveNodeOverrides from '../../store/use-live-node-overrides'
import useLiveTransforms from '../../store/use-live-transforms'
import useScene from '../../store/use-scene'
import { spatialGridManager } from './spatial-grid-manager'

// Group drags publish translated slab polygons/elevations to
// `useLiveNodeOverrides` only — the scene store (and thus the manager's
// committed index) doesn't change until the validating click. Support
// queries must honor those live records, otherwise items and walls
// re-elect against the pre-drag footprint and jump to ground mid-preview.

const LEVEL_ID = 'level_test'

const SQUARE: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

function makeLevel(children: string[] = []): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children,
    level: 0,
  } as AnyNode
}

function makeSlab(
  id: string,
  polygon: Array<[number, number]>,
  elevation: number,
  overrides: Partial<SlabNode> = {},
): SlabNode {
  return {
    id,
    type: 'slab',
    object: 'node',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    children: [],
    polygon,
    holes: [],
    holeMetadata: [],
    elevation,
    autoFromWalls: false,
    ...overrides,
  } as SlabNode
}

const ITEM_DIMENSIONS: [number, number, number] = [0.5, 0.5, 0.5]
const NO_ROTATION: [number, number, number] = [0, 0, 0]

const itemSupportAt = (x: number, z: number) =>
  spatialGridManager.getSlabSupportForItem(LEVEL_ID, [x, 0, z], ITEM_DIMENSIONS, NO_ROTATION)

describe('support queries honor live node overrides', () => {
  beforeEach(() => {
    spatialGridManager.clear()
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
    const deck = makeSlab('slab_deck', SQUARE, 0.5)
    useScene.setState({ nodes: { [LEVEL_ID]: makeLevel([deck.id]), [deck.id]: deck } as never })
    spatialGridManager.handleNodeCreated(deck as AnyNode, LEVEL_ID)
  })

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
    useScene.setState({ nodes: {} })
    spatialGridManager.clear()
  })

  test('an item over a live-translated deck keeps electing it at the moved footprint', () => {
    // Prime the committed rendered-polygon cache before the drag starts.
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })

    const translated = SQUARE.map(([x, z]) => [x + 10, z]) as Array<[number, number]>
    useLiveNodeOverrides.getState().set('slab_deck', { polygon: translated })

    // The moved footprint elects the deck; the vacated one no longer does.
    expect(itemSupportAt(10, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0, slabId: null })

    // Release/cancel: committed data wins again (cached fast path).
    useLiveNodeOverrides.getState().clearAll()
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })
    expect(itemSupportAt(10, 0)).toEqual({ elevation: 0, slabId: null })
  })

  test('a live elevation change is visible to item and host queries', () => {
    useLiveNodeOverrides.getState().set('slab_deck', { elevation: 1.2 })
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 1.2, slabId: 'slab_deck' })
    expect(
      spatialGridManager.getHostSlabElevationForFootprint(
        LEVEL_ID,
        'slab_deck',
        [0, 0, 0],
        ITEM_DIMENSIONS,
        NO_ROTATION,
      ),
    ).toBeCloseTo(1.2)

    useLiveNodeOverrides.getState().clearAll()
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })
  })

  test('a deck translated via a useLiveTransforms delta supports items at the moved spot', () => {
    // The slab move tool and the room-preset stamp publish a translation
    // DELTA to useLiveTransforms (no polygon override) — the mesh moves but
    // the committed polygon stays put, so furniture riding the preview used
    // to elect ground and render under the deck until the validating click.
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })

    useLiveTransforms.getState().set('slab_deck', { position: [10, 0, 0], rotation: 0 })

    expect(itemSupportAt(10, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0, slabId: null })
    expect(
      spatialGridManager.getSlabSupportForWall(LEVEL_ID, [9.5, 0], [10.5, 0]).elevation,
    ).toBeCloseTo(0.5)

    useLiveTransforms.getState().clearAll()
    expect(itemSupportAt(0, 0)).toEqual({ elevation: 0.5, slabId: 'slab_deck' })
    expect(itemSupportAt(10, 0)).toEqual({ elevation: 0, slabId: null })
  })

  test('wall support follows a live-translated deck', () => {
    const committed = spatialGridManager.getSlabSupportForWall(LEVEL_ID, [-0.5, 0], [0.5, 0])
    expect(committed.elevation).toBeCloseTo(0.5)

    const translated = SQUARE.map(([x, z]) => [x + 10, z]) as Array<[number, number]>
    useLiveNodeOverrides.getState().set('slab_deck', { polygon: translated })

    const moved = spatialGridManager.getSlabSupportForWall(LEVEL_ID, [9.5, 0], [10.5, 0])
    expect(moved.elevation).toBeCloseTo(0.5)
    expect(moved.electedSlabId).toBe('slab_deck')

    const vacated = spatialGridManager.getSlabSupportForWall(LEVEL_ID, [-0.5, 0], [0.5, 0])
    expect(vacated.elevation).toBe(0)
  })
})
