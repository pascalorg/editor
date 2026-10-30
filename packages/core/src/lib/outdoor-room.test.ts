import { describe, expect, test } from 'bun:test'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import { enclosed } from '../commands/structure/structure.test'
import { type AnyNode, type AnyNodeId, type SlabNode, WallNode, type ZoneNode } from '../schema'
import type { BeamNode } from '../schema/nodes/beam'
import type { ColumnNode } from '../schema/nodes/column'
import { railingWallDefaults } from '../schema/nodes/railing-wall'
import { derivedDeletionIntent } from '../store/derived-node-guard'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { planSeparatorInsertion } from '../systems/wall/wall-topology'
import { beamBottomElevation } from './beam'
import { FRAMING_POST_SIZES } from './framing-post'
import { DECK_FLOOR_DROP, DECKING_THICKNESS, PORCH_FLOOR_DROP } from './outdoor-room'
import { PORCH_POST_SETBACK } from './porch-framing'
import { porchPartOf } from './porch-framing-sync'
import { reconcileLevelStructure } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'

const LEVEL = 'level_test'

/** Settle the level's structure the way the live sync does after an edit. */
function settle(before: Record<string, AnyNode>, after: Record<string, AnyNode>) {
  let i = 0
  const derived = reconcileLevelStructure({
    levelId: LEVEL,
    nodes: after,
    previousNodes: before,
    mintId: (kind) => {
      let id: string
      do id = `${kind}_derived${++i}`
      while (after[id])
      return id
    },
  })
  return applyToScratch(after, structureChangeBatch(derived.patches))
}

/** The kitchen (an 8 × 4 room) with invisible walls closing off a porch on its z = 4 side. */
function withPorch() {
  const { nodes } = enclosed()
  let next: Record<string, AnyNode> = nodes
  let n = 0
  for (const [start, end] of [
    [
      [2, 4],
      [2, 6],
    ],
    [
      [2, 6],
      [6, 6],
    ],
    [
      [6, 6],
      [6, 4],
    ],
  ] as Array<[[number, number], [number, number]]>) {
    const plan = planSeparatorInsertion(next as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start,
      end,
      joinRadius: 0.05,
      mintId: () => `separator_test${++n}`,
    })
    expect(plan).not.toBeNull()
    next = applyToScratch(next, plan!.changes)
  }
  return settle(nodes, next)
}

const zones = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
const plates = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')

describe('a room closed off outside the house by invisible walls', () => {
  test('is a porch: concrete, a step down, covered', () => {
    const nodes = withPorch()
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    expect(porch).toBeDefined()
    expect(porch.name).toBe('Porch')
    expect(porch.floor?.drop).toBeCloseTo(PORCH_FLOOR_DROP, 9)
    expect(porch.hasCeiling).toBeUndefined()
    expect(zones(nodes).find((zone) => zone.name === 'Kitchen')?.roomType).toBeUndefined()
  })

  test('its floor plate steps down from the house and is a porch slab', () => {
    const nodes = withPorch()
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    const base = plates(nodes).find((plate) => plate.plateRole === 'base')!
    const own = plates(nodes).find((plate) => plate.zoneIds?.includes(porch.id) && plate !== base)!
    expect(own.elevation).toBeCloseTo(base.elevation - PORCH_FLOOR_DROP, 6)
    expect(own.metadata?.floor).toBe('porch-slab')
  })

  test('the house wall it faces is an outside wall there, even under its ceiling', () => {
    const nodes = withPorch()
    const wall = Object.values(nodes).find(
      (node): node is WallNode => node.type === 'wall' && node.start[1] === 4 && node.end[1] === 4,
    )!
    expect([wall.frontSide, wall.backSide].sort()).toEqual(['exterior', 'interior'])
  })

  test('invisible walls never cut the wall they meet', () => {
    const nodes = withPorch()
    const walls = Object.values(nodes).filter((node) => node.type === 'wall')
    expect(walls).toHaveLength(4)
  })
})

/** The kitchen with a room off its z = 4 side: railings on `railed` sides, invisible walls on the rest. */
function withRailings(railed: ReadonlySet<number>) {
  const { nodes } = enclosed()
  let next: Record<string, AnyNode> = nodes
  const sides: Array<[[number, number], [number, number]]> = [
    [
      [2, 4],
      [2, 6],
    ],
    [
      [2, 6],
      [6, 6],
    ],
    [
      [6, 6],
      [6, 4],
    ],
  ]
  sides.forEach(([start, end], index) => {
    if (railed.has(index)) {
      const railing = WallNode.parse({
        ...railingWallDefaults(),
        id: `wall_railing${index}`,
        parentId: LEVEL,
        start,
        end,
      })
      next = { ...next, [railing.id]: railing }
      return
    }
    const plan = planSeparatorInsertion(next as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start,
      end,
      joinRadius: 0.05,
      mintId: () => `separator_rail${index}`,
    })
    next = applyToScratch(next, plan!.changes)
  })
  return settle(nodes, next)
}

describe('a room fenced off outside the house by railings', () => {
  test('is a deck: boards, 1 in down, no ceiling, framed', () => {
    const nodes = withRailings(new Set([0, 1, 2]))
    const deck = zones(nodes).find((zone) => zone.roomType === 'deck')!
    expect(deck).toBeDefined()
    expect(deck.name).toBe('Deck')
    expect(deck.hasCeiling).toBe(false)
    expect(deck.floor?.drop).toBeCloseTo(DECK_FLOOR_DROP, 9)
    expect(
      plates(nodes).find((slab) => slab.zoneIds?.includes(deck.id) && slab.plateRole !== 'base')
        ?.metadata?.floor,
    ).toBe('deck')
    expect(
      Object.values(nodes).some((node) => node.type === 'ceiling' && node.zoneId === deck.id),
    ).toBe(false)
  })

  test("its railings stand on its own floor: the house's floor stops at the house wall", () => {
    const nodes = withRailings(new Set([0, 1, 2]))
    const deck = zones(nodes).find((zone) => zone.roomType === 'deck')!
    const base = plates(nodes).find((plate) => plate.plateRole === 'base')!
    const own = plates(nodes).find(
      (plate) => plate.plateRole !== 'base' && plate.zoneIds?.includes(deck.id),
    )!
    const houseWall = Object.values(nodes).find(
      (node): node is WallNode =>
        node.type === 'wall' &&
        node.wallType !== 'railing' &&
        node.start[1] === 4 &&
        node.end[1] === 4,
    )!
    const railing = railingWallDefaults().thickness
    const bounds = (polygon: Array<[number, number]>) => ({
      minX: Math.min(...polygon.map(([x]) => x)),
      maxX: Math.max(...polygon.map(([x]) => x)),
      minZ: Math.min(...polygon.map(([, z]) => z)),
      maxZ: Math.max(...polygon.map(([, z]) => z)),
    })
    // No ring of house floor under the railings, and no hole cut for the deck in it.
    const face = 4 + getWallThickness(houseWall) / 2
    expect(bounds(base.polygon).maxZ).toBeCloseTo(face, 3)
    expect(base.holes).toEqual([])
    // The deck's floor runs from the house wall's face out to the railings' outside faces.
    const deckBounds = bounds(own.polygon)
    expect(deckBounds.minZ).toBeCloseTo(face, 3)
    expect(deckBounds.maxZ).toBeCloseTo(6 + railing / 2, 3)
    expect(deckBounds.minX).toBeCloseTo(2 - railing / 2, 3)
    expect(deckBounds.maxX).toBeCloseTo(6 + railing / 2, 3)
  })

  test('closed with invisible walls as well, it is a porch, posts and beam along its railings too', () => {
    const nodes = withRailings(new Set([0, 2]))
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    expect(porch).toBeDefined()
    expect(
      Object.values(nodes).filter(
        (node) => node.type === 'beam' && porchPartOf(node)?.porchOf === porch.id,
      ),
    ).toHaveLength(3)
  })
})

describe('room type', () => {
  test('a porch made a deck steps 1 in down, takes boards, loses its ceiling and its name', () => {
    const nodes = withPorch()
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    const plan = setZoneIntent(nodes, { zoneId: porch.id, patch: { roomType: 'deck' } })
    expect(plan.conflicts).toBeUndefined()
    const changed = applyToScratch(nodes, structureChangeBatch(plan.changes))
    const after = settle(nodes, changed)
    const deck = after[porch.id] as ZoneNode
    expect(deck.roomType).toBe('deck')
    expect(deck.name).toBe('Deck')
    expect(deck.hasCeiling).toBe(false)
    expect(deck.floor?.drop).toBeCloseTo(DECK_FLOOR_DROP, 9)
    expect(deck.floor?.finish).toBe('library:wood-woodfine11')
    const plate = plates(after).find(
      (slab) => slab.zoneIds?.includes(deck.id) && slab.plateRole !== 'base',
    )!
    expect(plate.metadata?.floor).toBe('deck')
    expect(plate.metadata?.decking).toBeCloseTo(DECKING_THICKNESS, 9)
  })

  test('back to an ordinary room drops what the type brought, keeping a picked finish', () => {
    const nodes = withPorch()
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    const picked = applyToScratch(
      nodes,
      structureChangeBatch(
        setZoneIntent(nodes, {
          zoneId: porch.id,
          patch: { floor: { finish: 'library:tile-floor1' } },
        }).changes,
      ),
    )
    const plan = setZoneIntent(picked, { zoneId: porch.id, patch: { roomType: null } })
    const room = applyToScratch(picked, structureChangeBatch(plan.changes))[porch.id] as ZoneNode
    expect(room.roomType).toBeUndefined()
    expect(room.floor?.drop).toBeUndefined()
    expect(room.floor?.finish).toBe('library:tile-floor1')
    expect(room.hasCeiling).toBeUndefined()
  })
})

describe('planSeparatorInsertion', () => {
  test('joins a wall it ends on at its reference line and breaks across a wall it crosses', () => {
    const { nodes } = enclosed()
    // From inside the kitchen, through its z = 4 wall, to 2 m outside.
    const plan = planSeparatorInsertion(nodes as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start: [3, 0.03],
      end: [3, 6],
      joinRadius: 0.05,
    })!
    expect(plan.resolvedStart).toEqual([3, 0])
    expect(plan.separators.map((separator) => [separator.start, separator.end])).toEqual([
      [
        [3, 0],
        [3, 4],
      ],
      [
        [3, 4],
        [3, 6],
      ],
    ])
    expect(plan.changes.update).toEqual([])
    expect(plan.changes.delete).toEqual([])
  })

  test('drawn over an invisible wall or along a wall, adds only what is not there', () => {
    const nodes = withPorch() as Record<AnyNodeId, AnyNode>
    const draw = (start: [number, number], end: [number, number]) =>
      planSeparatorInsertion(nodes, { levelId: LEVEL as AnyNodeId, start, end, joinRadius: 0.05 })
    expect(draw([2, 6], [6, 6])).toBeNull()
    expect(draw([6, 6], [2, 6])).toBeNull()
    expect(draw([1, 0], [3, 0])).toBeNull()
    expect(
      draw([0, 6], [6, 6])!.separators.map((separator) => [separator.start, separator.end]),
    ).toEqual([
      [
        [0, 6],
        [2, 6],
      ],
    ])
  })
})

const porchOf = (nodes: Record<string, AnyNode>) =>
  zones(nodes).find((zone) => zone.roomType === 'porch')!
const posts = (nodes: Record<string, AnyNode>, zoneId: string) =>
  Object.values(nodes).filter(
    (node): node is ColumnNode => node.type === 'column' && porchPartOf(node)?.porchOf === zoneId,
  )
const beams = (nodes: Record<string, AnyNode>, zoneId: string) =>
  Object.values(nodes).filter(
    (node): node is BeamNode => node.type === 'beam' && porchPartOf(node)?.porchOf === zoneId,
  )
const edit = (nodes: Record<string, AnyNode>, id: string, data: Partial<AnyNode>) =>
  ({ ...nodes, [id]: { ...nodes[id], ...data } }) as Record<string, AnyNode>
const intent = (
  nodes: Record<string, AnyNode>,
  zoneId: string,
  patch: Parameters<typeof setZoneIntent>[1]['patch'],
) =>
  settle(
    nodes,
    applyToScratch(nodes, structureChangeBatch(setZoneIntent(nodes, { zoneId, patch }).changes)),
  )
const inset = FRAMING_POST_SIZES['6x6'] / 2 + PORCH_POST_SETBACK

describe('a covered porch frames itself', () => {
  test('posts on its outside corners and between, a beam along each open side', () => {
    const nodes = withPorch()
    const porch = porchOf(nodes)
    const standing = posts(nodes, porch.id)
    // The 4 m front: a post at each corner and one between; the 2 m sides need none between.
    expect(standing.map((post) => [post.position[0], post.position[2]]).sort()).toEqual(
      [
        [2 + inset, 6 - inset],
        [4, 6 - inset],
        [6 - inset, 6 - inset],
      ].map(([x, z]) => [expect.closeTo(x!, 9), expect.closeTo(z!, 9)]) as never,
    )
    expect(beams(nodes, porch.id)).toHaveLength(3)
    expect(
      standing.every((post) => post.role === 'post' && post.width === FRAMING_POST_SIZES['6x6']),
    ).toBe(true)
  })

  test('the posts stand on the porch slab, up to the underside of the beam', () => {
    const nodes = withPorch()
    const porch = porchOf(nodes)
    const plate = plates(nodes).find(
      (slab) => slab.zoneIds?.includes(porch.id) && slab.plateRole !== 'base',
    )!
    const front = beams(nodes, porch.id).find((beam) => beam.start[1] === beam.end[1])!
    for (const post of posts(nodes, porch.id)) {
      expect(post.supportSlabId).toBe(plate.id)
      expect(plate.elevation + post.height).toBeCloseTo(
        beamBottomElevation(nodes as never, front),
        6,
      )
    }
  })

  test('moves with the porch', () => {
    const before = withPorch()
    const porch = porchOf(before)
    let moved: Record<string, AnyNode> = before
    for (const node of Object.values(before))
      if (node.type === 'separator')
        moved = edit(moved, node.id, {
          start: [node.start[0], node.start[1] === 6 ? 6.5 : node.start[1]],
          end: [node.end[0], node.end[1] === 6 ? 6.5 : node.end[1]],
        } as never)
    const after = settle(before, moved)
    expect(porchOf(after).id).toBe(porch.id)
    expect(posts(after, porch.id).map((post) => post.position[2])).toEqual(
      [6.5 - inset, 6.5 - inset, 6.5 - inset].map((z) => expect.closeTo(z, 9)) as never,
    )
    expect(new Set(posts(after, porch.id).map((post) => post.id))).toEqual(
      new Set(posts(before, porch.id).map((post) => post.id)),
    )
  })

  test('a post moved by hand hands the framing over; Automatic again rebuilds it', () => {
    const before = withPorch()
    const porch = porchOf(before)
    const middle = posts(before, porch.id).find((post) => Math.abs(post.position[0] - 4) < 1e-6)!
    const moved = settle(
      before,
      edit(before, middle.id, { position: [4.5, 0, middle.position[2]] } as never),
    )
    expect((moved[porch.id] as ZoneNode).porchFraming?.auto).toBe(false)
    expect((moved[middle.id] as ColumnNode).position[0]).toBe(4.5)
    const rebuilt = intent(moved, porch.id, { porchFraming: { auto: true } })
    expect((rebuilt[porch.id] as ZoneNode).porchFraming).toBeUndefined()
    expect((rebuilt[middle.id] as ColumnNode).position[0]).toBeCloseTo(4, 9)
  })

  test('a post deleted by hand stays deleted', () => {
    const before = withPorch()
    const porch = porchOf(before)
    const middle = posts(before, porch.id).find((post) => Math.abs(post.position[0] - 4) < 1e-6)!
    const { [middle.id]: _gone, ...rest } = before
    const after = settle(before, rest)
    expect((after[porch.id] as ZoneNode).porchFraming?.auto).toBe(false)
    expect(posts(after, porch.id)).toHaveLength(2)
  })

  test('closer post spacing and a bigger beam rebuild it', () => {
    const before = withPorch()
    const porch = porchOf(before)
    const after = intent(before, porch.id, { porchFraming: { postSpacing: 1, beamSize: '6x10' } })
    expect(posts(after, porch.id).length).toBeGreaterThan(posts(before, porch.id).length)
    expect(beams(after, porch.id).every((beam) => beam.size === '6x10')).toBe(true)
  })

  test('a deck or an uncovered porch has none', () => {
    const before = withPorch()
    const porch = porchOf(before)
    const deck = intent(before, porch.id, { roomType: 'deck' })
    expect(posts(deck, porch.id)).toHaveLength(0)
    expect(beams(deck, porch.id)).toHaveLength(0)
    const open = intent(before, porch.id, { hasCeiling: false })
    expect(posts(open, porch.id)).toHaveLength(0)
  })
})

describe('a deck or patio carries a roof on posts once switched on', () => {
  const deckOf = (nodes: Record<string, AnyNode>) =>
    zones(nodes).find((zone) => zone.roomType === 'deck')!

  test('a deck fenced by railings has none until its posts and beam are on', () => {
    const before = withRailings(new Set([0, 1, 2]))
    const deck = deckOf(before)
    expect(posts(before, deck.id)).toHaveLength(0)
    const on = intent(before, deck.id, { porchFraming: { auto: true } })
    expect((on[deck.id] as ZoneNode).porchFraming?.auto).toBe(true)
    // The 4 m railing: a post at each outside corner and one between; a beam on each railing.
    expect(posts(on, deck.id)).toHaveLength(3)
    expect(beams(on, deck.id)).toHaveLength(3)
    const plate = plates(on).find(
      (slab) => slab.zoneIds?.includes(deck.id) && slab.plateRole !== 'base',
    )!
    expect(posts(on, deck.id).every((post) => post.supportSlabId === plate.id)).toBe(true)
  })

  test('a size chosen rebuilds them automatically; Off takes them all, edited or not', () => {
    const before = withRailings(new Set([0, 1, 2]))
    const deck = deckOf(before)
    const on = intent(before, deck.id, { porchFraming: { auto: true } })
    const middle = posts(on, deck.id).find((post) => Math.abs(post.position[0] - 4) < 1e-6)!
    const moved = settle(
      on,
      edit(on, middle.id, { position: [4.5, 0, middle.position[2]] } as never),
    )
    expect((moved[deck.id] as ZoneNode).porchFraming?.auto).toBe(false)
    const resized = intent(moved, deck.id, { porchFraming: { postSize: '4x4' } })
    expect((resized[deck.id] as ZoneNode).porchFraming?.auto).toBe(true)
    expect(posts(resized, deck.id).every((post) => post.width === FRAMING_POST_SIZES['4x4'])).toBe(
      true,
    )
    const handEdited = settle(
      resized,
      edit(resized, middle.id, { position: [4.5, 0, middle.position[2]] } as never),
    )
    const off = intent(handEdited, deck.id, { porchFraming: { auto: null } })
    expect((off[deck.id] as ZoneNode).porchFraming?.auto).toBeUndefined()
    expect(
      Object.values(off).filter((node) => node.type === 'column' || node.type === 'beam'),
    ).toHaveLength(0)
  })

  test('a porch keeps Automatic as its default, stored only when off', () => {
    const before = withPorch()
    const porch = porchOf(before)
    const resized = intent(before, porch.id, { porchFraming: { postSize: '8x8' } })
    expect((resized[porch.id] as ZoneNode).porchFraming?.auto).toBeUndefined()
    expect(posts(resized, porch.id).every((post) => post.width === FRAMING_POST_SIZES['8x8'])).toBe(
      true,
    )
  })
})

describe('deleting a floor plate', () => {
  /** The porch off the kitchen's z = 4 side and a deck fenced with railings off its z = 0 side, settled. */
  const withPorchAndDeck = () => {
    const porch = withPorch()
    const railed: Record<string, AnyNode> = { ...porch }
    for (const [index, [start, end]] of (
      [
        [
          [2, 0],
          [2, -2],
        ],
        [
          [2, -2],
          [6, -2],
        ],
        [
          [6, -2],
          [6, 0],
        ],
      ] as Array<[[number, number], [number, number]]>
    ).entries()) {
      const railing = WallNode.parse({
        ...railingWallDefaults(),
        id: `wall_deckrail${index}`,
        parentId: LEVEL,
        start,
        end,
      })
      railed[railing.id] = railing
    }
    return settle(porch, railed)
  }
  const sceneSync = (before: Record<string, AnyNode>, after: Record<string, AnyNode>) => {
    let i = 0
    return reconcileSceneStructure({
      nodes: after,
      previousNodes: before,
      mintId: (kind) => `${kind}_sync${++i}`,
    }).nodes as Record<string, AnyNode>
  }

  test("the house's shared plate is not a porch's or a deck's floor: they keep theirs", () => {
    const nodes = withPorchAndDeck()
    const base = plates(nodes).find((plate) => plate.plateRole === 'base')!
    const outdoor = zones(nodes).filter((zone) => zone.roomType)
    expect(outdoor.map((zone) => zone.roomType).sort()).toEqual(['deck', 'porch'])
    expect(outdoor.every((zone) => base.zoneIds?.includes(zone.id))).toBe(true)
    // The store's delete intent and the reconciler's both switch off the kitchen's floor alone.
    expect(derivedDeletionIntent(nodes as never, [base.id as AnyNodeId])).toEqual([
      { id: zones(nodes).find((zone) => zone.name === 'Kitchen')!.id, data: { hasFloor: false } },
    ] as never)
    const { [base.id]: _gone, ...rest } = nodes
    const after = sceneSync(nodes, rest)
    for (const zone of outdoor) {
      expect((after[zone.id] as ZoneNode).hasFloor).toBeUndefined()
      expect(
        plates(after).some(
          (plate) => plate.plateRole !== 'base' && plate.zoneIds?.includes(zone.id),
        ),
      ).toBe(true)
    }
    expect(
      (after[zones(nodes).find((zone) => zone.name === 'Kitchen')!.id] as ZoneNode).hasFloor,
    ).toBe(false)
  })

  test("a porch's own plate deleted takes the porch's floor only", () => {
    const nodes = withPorchAndDeck()
    const porch = zones(nodes).find((zone) => zone.roomType === 'porch')!
    const own = plates(nodes).find(
      (plate) => plate.plateRole !== 'base' && plate.zoneIds?.includes(porch.id),
    )!
    expect(derivedDeletionIntent(nodes as never, [own.id as AnyNodeId])).toEqual([
      { id: porch.id, data: { hasFloor: false } },
    ] as never)
  })
})
