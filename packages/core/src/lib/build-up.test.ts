import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CEILING_BUILD_UP_PRESETS,
  CEILING_CLAMP_MARGIN,
  CeilingBuildUp,
  CeilingNode,
  ceilingBuildUpThickness,
  ceilingCapLift,
  LevelNode,
  ROOF_BUILD_UP_PRESETS,
  RoofBuildUp,
  RoofSegmentNode,
  roofBuildUpDepths,
  roofBuildUpPatch,
  roofStructureDepth,
  SlabNode,
} from '../index'

const IN = 0.0254

const plane = (buildUp: Partial<RoofBuildUp> = {}): RoofBuildUp => ({
  roofing: { kind: 'architectural-shingle', thickness: 0.5 * IN },
  sheathing: { kind: 'osb', thickness: (7 / 16) * IN },
  structure: { system: 'rafters', size: '2x10', spacing: 16 * IN },
  ...buildUp,
})

describe('roof plane layers', () => {
  test('a plane without layers keeps the deck and shingle it always drew', () => {
    const old = RoofSegmentNode.parse({ id: 'rseg_old', type: 'roof-segment' })
    expect(old.buildUp).toBeUndefined()
    expect([old.deckThickness, old.shingleThickness]).toEqual([0.1, 0.05])
  })

  test('the deck is structure and sheathing, the covering roofing and underlayment', () => {
    const { deck, covering } = roofBuildUpDepths(
      plane({ underlayment: { kind: 'synthetic', thickness: 0.02 * IN } }),
    )
    expect(deck / IN).toBeCloseTo(9.25 + 7 / 16, 9)
    expect(covering / IN).toBeCloseTo(0.52, 9)
  })

  test('cavity insulation fills the rafters, rigid board and an interior finish add to the deck', () => {
    const bare = roofBuildUpDepths(plane()).deck
    expect(roofBuildUpDepths(plane({ insulation: { kind: 'batt', thickness: 6 * IN } })).deck).toBe(
      bare,
    )
    expect(
      roofBuildUpDepths(plane({ insulation: { kind: 'batt', thickness: 10 * IN } })).deck / IN,
    ).toBeCloseTo(10 + 7 / 16, 9)
    expect(
      roofBuildUpDepths(
        plane({
          insulation: { kind: 'rigid', thickness: 2 * IN },
          finish: { kind: 'drywall', thickness: 0.5 * IN },
        }),
      ).deck / IN,
    ).toBeCloseTo(9.25 + 7 / 16 + 2.5, 9)
  })

  test('setting the layers writes the deck and shingle thickness the plane draws with', () => {
    const buildUp = plane({ structure: { system: 'trusses', size: '2x6', spacing: 24 * IN } })
    const node = RoofSegmentNode.parse({
      id: 'rseg_layered',
      type: 'roof-segment',
      ...roofBuildUpPatch(buildUp),
    })
    expect(node.buildUp).toEqual(buildUp)
    // a 2x6 top chord on its 2x6 heel
    expect(node.deckThickness / IN).toBeCloseTo(2 * 5.5 + 7 / 16, 9)
    expect(node.shingleThickness / IN).toBeCloseTo(0.5, 9)
  })

  test('a truss stands its top chord on its heel: two chord depths, where a rafter is one', () => {
    expect(
      roofStructureDepth({ system: 'rafters', size: '2x8', spacing: 16 * IN }) / IN,
    ).toBeCloseTo(7.25, 9)
    expect(
      roofStructureDepth({ system: 'trusses', size: '2x4', spacing: 24 * IN }) / IN,
    ).toBeCloseTo(7, 9)
  })

  test('the default preset is 2x4 trusses on their heel under 7/16 in OSB', () => {
    const [first] = ROOF_BUILD_UP_PRESETS
    expect(RoofBuildUp.parse(first!.buildUp)).toEqual(first!.buildUp)
    expect(roofBuildUpDepths(first!.buildUp).deck / IN).toBeCloseTo(7 + 7 / 16, 9)
    for (const preset of ROOF_BUILD_UP_PRESETS) expect(preset.buildUp.presetId).toBe(preset.id)
  })
})

describe('ceiling layers', () => {
  test('a ceiling without layers has no thickness', () => {
    const old = CeilingNode.parse({ id: 'ceiling_old', polygon: [] })
    expect(old.buildUp).toBeUndefined()
  })

  test('the thickness rises from the underside: finish, framing or the fill over it, decking', () => {
    expect(
      ceilingBuildUpThickness({
        finish: { kind: 'drywall', thickness: 0.5 * IN },
        framing: { system: 'joists', size: '2x6', spacing: 16 * IN },
      }) / IN,
    ).toBeCloseTo(6, 9)
    expect(
      ceilingBuildUpThickness({
        finish: { kind: 'drywall', thickness: 0.625 * IN },
        framing: { system: 'truss-chords', size: '2x4', spacing: 24 * IN },
        insulation: { kind: 'blown', thickness: 12 * IN },
      }) / IN,
    ).toBeCloseTo(12.625, 9)
    expect(
      ceilingBuildUpThickness({
        framing: { system: 'joists', size: '2x8', spacing: 16 * IN },
        decking: { kind: 'plywood', thickness: 0.75 * IN },
      }) / IN,
    ).toBeCloseTo(8, 9)
    expect(ceilingBuildUpThickness({})).toBe(0)
  })

  test('every preset parses', () => {
    for (const preset of CEILING_BUILD_UP_PRESETS)
      expect(CeilingBuildUp.parse(preset.buildUp)).toEqual(preset.buildUp)
  })

  const square: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const joists: CeilingBuildUp = {
    finish: { kind: 'drywall', thickness: 0.5 * IN },
    framing: { system: 'joists', size: '2x6', spacing: 16 * IN },
  }
  const scene = (ceiling: Partial<CeilingNode>, floorAbove: boolean) => {
    const nodes: AnyNode[] = [
      BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
      LevelNode.parse({ id: 'level_0', level: 0, height: 2.5, parentId: 'building_a' }),
      LevelNode.parse({
        id: 'level_1',
        level: 1,
        height: 2.5,
        parentId: 'building_a',
        children: floorAbove ? ['slab_above'] : [],
      }),
      // The floor above as its plate stands: on the walls below, its underside at their top.
      SlabNode.parse({ id: 'slab_above', polygon: square, elevation: 0.05, thickness: 0.05 }),
    ]
    const node = CeilingNode.parse({
      id: 'ceiling_a',
      parentId: 'level_0',
      polygon: square,
      ...ceiling,
    })
    return {
      node,
      nodes: Object.fromEntries([...nodes, node].map((n) => [n.id, n])) as Record<
        AnyNodeId,
        AnyNode
      >,
    }
  }

  test('the upper face stands on the layers under a roof, and short of the floor above', () => {
    const open = scene({ height: 2.4, buildUp: joists }, false)
    expect(ceilingCapLift(open.node, open.nodes)).toBeCloseTo(6 * IN, 9)
    // the floor above stands on the walls at 2.5 m: that, less the margin, is as high as it goes
    const under = scene({ height: 2.4, buildUp: joists }, true)
    expect(ceilingCapLift(under.node, under.nodes)).toBeCloseTo(0.1 - CEILING_CLAMP_MARGIN, 9)
    const bare = scene({ height: 2.4 }, true)
    expect(ceilingCapLift(bare.node, bare.nodes)).toBe(0)
  })
})

// A 320 px inspector shows about 26 characters beside "Preset"; longer labels were cut with "…".
test('every layers preset label fits the Preset select uncut', () => {
  for (const preset of [...ROOF_BUILD_UP_PRESETS, ...CEILING_BUILD_UP_PRESETS])
    expect(preset.label.length).toBeLessThanOrEqual(26)
})
