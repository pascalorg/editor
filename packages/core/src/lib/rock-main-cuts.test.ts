import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '../registry/types'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RockNode,
  SiteNode,
  SlabNode,
  ZoneNode,
} from '../schema'
import { getLevelElevations } from '../services/storey'
import useLiveNodeOverrides from '../store/use-live-node-overrides'
import { liftedManualSlab } from './floor-construction-lift'
import { resolveGroundSlab } from './ground-read'
import { cutterContextNodes, withHostedCutterHoles } from './object-cuts'
import { rockSlabHoles } from './rock-cuts'
import { rockFacts } from './rock-facts'

const rectangle = (half: number): [number, number][] => [
  [-half, -half],
  [half, -half],
  [half, half],
  [-half, half],
]

// A +1m floor-construction lift is authored explicitly relative to the .05m
// reference. Expected world elevations are arithmetic, not copied cut outputs.
function fixture(upper: boolean, rockHeight: number) {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const lower = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const above = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  const zone = ZoneNode.parse({
    name: 'Construction room',
    parentId: lower.id,
    spaceRole: 'room',
    polygon: rectangle(4),
  })
  const base = SlabNode.parse({
    parentId: lower.id,
    plateRole: 'base',
    boundary: 'auto',
    polygon: rectangle(4),
    zoneIds: [zone.id],
    referenceFloorElevation: 0.05,
    floorHeight: 1.05,
    elevation: 1.05,
  })
  const slab = SlabNode.parse({
    parentId: upper ? above.id : lower.id,
    polygon: rectangle(3),
    elevation: 0.1,
  })
  const rock = RockNode.parse({
    parentId: site.id,
    gen: 2,
    polygon: rectangle(1),
    height: rockHeight,
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: { ...site, children: [building.id, rock.id] },
    [building.id]: { ...building, children: upper ? [lower.id, above.id] : [lower.id] },
    [lower.id]: { ...lower, children: [zone.id, base.id, ...(upper ? [] : [slab.id])] },
    ...(upper ? { [above.id]: { ...above, children: [slab.id] } } : {}),
    [zone.id]: zone,
    [base.id]: base,
    [slab.id]: slab,
    [rock.id]: rock,
  }
  const context: GeometryContext = {
    parent: nodes[slab.parentId!],
    children: [],
    siblings: [],
    resolve: (id) => nodes[id],
  }
  return { nodes, slab, rock, above, context }
}

describe('rock cuts follow main construction elevation, not authored slab numbers', () => {
  test('a low rock cannot cut or claim a manual slab lifted from .1m to 1.1m', () => {
    const { nodes, slab, rock, context } = fixture(false, 0.5)
    expect(liftedManualSlab(nodes, slab).elevation).toBeCloseTo(1.1, 8)
    expect(rockFacts(rock, nodes).topElevationM).toBeCloseTo(0.45, 8)
    expect(rockSlabHoles(slab, nodes)).toEqual([])
    expect(rockFacts(rock, nodes).throughSlabs).toEqual([])
    expect(withHostedCutterHoles(slab, cutterContextNodes(slab, context)).holes).toEqual([])
  })

  test('a rock reaching 1.45m cuts the lifted slab, without applying its lift twice', () => {
    const { nodes, slab, rock, context } = fixture(false, 1.5)
    const lifted = liftedManualSlab(nodes, slab)
    expect(lifted.elevation).toBeCloseTo(1.1, 8)
    expect(rockSlabHoles(slab, nodes).length).toBeGreaterThan(0)
    expect(rockFacts(rock, nodes).throughSlabs).toContainEqual(
      expect.objectContaining({ slabId: slab.id }),
    )
    // Both public consumers start from the stored slab. Cutting must not mutate its
    // elevation, otherwise their subsequent construction lift would be applied twice.
    const cut = withHostedCutterHoles(slab, cutterContextNodes(slab, context))
    expect(cut.elevation).toBe(0.1)
    expect(cut.holes.length).toBeGreaterThan(0)
    const supported = resolveGroundSlab(slab, nodes)
    expect(supported.elevation).toBeCloseTo(1.1, 8)
    expect(supported.holes.length).toBeGreaterThan(0)
  })

  test('a geometry context carries the lower footprint/zone needed to lift an upper floor', () => {
    for (const height of [3.5, 4.5]) {
      const { nodes, slab, above, context } = fixture(true, height)
      expect(getLevelElevations(nodes).get(above.id)?.baseY).toBeCloseTo(4, 8)
      // The slab top is 4 + .1 = 4.1. A 3.45m crown cannot reach it; 4.45m can.
      const built = withHostedCutterHoles(slab, cutterContextNodes(slab, context))
      if (height === 3.5) {
        expect(rockSlabHoles(slab, nodes)).toEqual([])
        expect(built.holes).toEqual([])
      } else {
        expect(rockSlabHoles(slab, nodes).length).toBeGreaterThan(0)
        expect(built.holes.length).toBeGreaterThan(0)
      }
    }
  })

  test('captured cut geometry ignores a live construction-height preview while live geometry follows it', () => {
    const { nodes, slab, context } = fixture(false, 0.5)
    const base = Object.values(nodes).find(
      (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'base',
    )!
    const saved = useLiveNodeOverrides.getState()
    const before = JSON.stringify(nodes)
    try {
      useLiveNodeOverrides.getState().set(base.id, { floorHeight: 0.05, elevation: 0.05 })
      // Live preview removes the +1 lift: .1m slab is now within the .45m rock.
      const live = withHostedCutterHoles(slab, cutterContextNodes(slab, context))
      expect(live.holes.length).toBeGreaterThan(0)
      // Export/captured geometry still has its +1 lift: 1.1m slab is out of reach.
      const captured = withHostedCutterHoles(
        slab,
        cutterContextNodes(slab, { ...context, sceneNodes: nodes }),
      )
      expect(captured.holes).toEqual([])
      expect(JSON.stringify(nodes)).toBe(before)
    } finally {
      useLiveNodeOverrides.setState(saved, true)
    }
  })
})
