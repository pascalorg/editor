import { afterEach, describe, expect, test } from 'bun:test'
import type { GeometryContext } from '../registry/types'
import { BuildingNode, LevelNode, RockNode, SiteNode, SlabNode } from '../schema'
import useLiveNodeOverrides from '../store/use-live-node-overrides'
import useLiveTransforms from '../store/use-live-transforms'
import { cutterContextNodes, withHostedCutterHoles } from './object-cuts'
import { area } from './polygon-boolean'
import { rockSlabHoles } from './rock-cuts'
import { rockCentre } from './rock-outline'

type Point = [number, number]

const lot = (): Point[] => [
  [-20, -20],
  [20, -20],
  [20, 20],
  [-20, 20],
]

function scene({
  slabTop = 0.1,
  rockHeight = 3,
  building = {},
  slabHalf = 4,
}: {
  slabTop?: number
  rockHeight?: number
  building?: Partial<BuildingNode>
  slabHalf?: number
} = {}) {
  const site = SiteNode.parse({ polygon: { type: 'polygon', points: lot() } })
  const house = BuildingNode.parse({ parentId: site.id, ...building })
  const level = LevelNode.parse({ parentId: house.id, level: 0, height: 3 })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [-slabHalf, -slabHalf],
      [slabHalf + 4, -slabHalf],
      [slabHalf + 4, slabHalf + 1],
      [-slabHalf, slabHalf + 1],
    ],
    elevation: slabTop,
  })
  const rock = RockNode.parse({
    parentId: site.id,
    polygon: [
      [0, 0],
      [3, -0.5],
      [4, 2],
      [1, 3],
    ],
    height: rockHeight,
    seed: 4,
  })
  const nodes = {
    [site.id]: { ...site, children: [house.id, rock.id] },
    [house.id]: { ...house, children: [level.id] },
    [level.id]: { ...level, children: [slab.id] },
    [slab.id]: slab,
    [rock.id]: rock,
  }
  return { nodes, slab, rock, level, site }
}

const areaOf = (hole: Point[]) => area([{ outer: hole, holes: [] }])

describe('the holes a rock leaves in the floor it passes through', () => {
  test('a rock that rises through the floor leaves a hole the size of its cross-section there', () => {
    const { nodes, slab, rock } = scene()

    const holes = rockSlabHoles(slab, nodes)

    expect(holes).toHaveLength(1)
    const [hole] = holes
    // The cross-section at 0.1 m is a little smaller than the foot, which is about 8.5 m².
    expect(areaOf(hole as Point[])).toBeGreaterThan(4)
    expect(areaOf(hole as Point[])).toBeLessThan(areaOf(rock.polygon as Point[]))
  })

  test('a higher floor passes through the narrower part of the rock: a smaller hole', () => {
    const floor = scene({ slabTop: 0.1 })
    const raised = scene({ slabTop: 2 })

    const low = rockSlabHoles(floor.slab, floor.nodes)
    const high = rockSlabHoles(raised.slab, raised.nodes)

    expect(areaOf(high[0] as Point[])).toBeLessThan(areaOf(low[0] as Point[]))
  })

  test('a floor just under the rock’s top gets a hole, one just over it none', () => {
    // Main's terrain-absent Site is at -0.05: the crown is 2.95, not 3.
    const under = scene({ slabTop: 2.92, rockHeight: 3 })
    const over = scene({ slabTop: 2.98, rockHeight: 3 })

    expect(rockSlabHoles(under.slab, under.nodes)).toHaveLength(1)
    expect(rockSlabHoles(over.slab, over.nodes)).toEqual([])
  })

  test('a floor above the rock’s top gets none', () => {
    const { nodes, slab } = scene({ slabTop: 5, rockHeight: 3 })

    expect(rockSlabHoles(slab, nodes)).toEqual([])
  })

  test('a rock that ends below the floor gets none', () => {
    const { nodes, slab } = scene({ slabTop: 0.1, rockHeight: 0.05 })

    expect(rockSlabHoles(slab, nodes)).toEqual([])
  })

  test('a floor with no rock on its Site is exactly as it was', () => {
    const { nodes, slab, rock } = scene()
    const without = { ...nodes }
    delete without[rock.id]

    expect(rockSlabHoles(slab, without)).toEqual([])
  })

  test('a rock beyond the floor’s edge leaves none', () => {
    const { nodes, slab, rock } = scene()
    const away = {
      ...nodes,
      [rock.id]: { ...rock, polygon: rock.polygon.map(([x, z]) => [x + 30, z]) },
    }

    expect(rockSlabHoles(slab, away as typeof nodes)).toEqual([])
  })

  test('the hole is in the floor’s own frame when the building is placed and turned', () => {
    const { nodes, slab, rock } = scene({
      building: { position: [5, 0, 0], rotation: [0, Math.PI / 2, 0] },
      slabHalf: 8,
    })

    const [hole] = rockSlabHoles(slab, nodes)

    // A quarter turn about the building's origin, then its move: the Site point (x, z) is the
    // floor point (−z, x − 5).
    const [cx, cz] = rockCentre(rock.polygon as Point[])
    const points = hole as Point[]
    const centre = points.reduce<Point>(
      (sum, [x, z]) => [sum[0] + x / points.length, sum[1] + z / points.length],
      [0, 0],
    )
    expect(centre[0]).toBeCloseTo(-cz, 0)
    expect(centre[1]).toBeCloseTo(cx - 5, 0)
  })
})

describe('a floor built from its own geometry context', () => {
  const contextOf = (nodes: ReturnType<typeof scene>['nodes'], parentId: string): GeometryContext =>
    ({
      parent: nodes[parentId as keyof typeof nodes],
      children: [],
      siblings: [],
      resolve: (id: string) => nodes[id as keyof typeof nodes],
    }) as unknown as GeometryContext

  test('finds the rocks of its Site and carries the hole beside the ones it already had', () => {
    const { nodes, slab, level } = scene()
    const withOwnHole = {
      ...slab,
      holes: [
        [
          [-3, -2],
          [-2, -2],
          [-2, -1],
        ] as Point[],
      ],
    }

    const built = withHostedCutterHoles(
      withOwnHole,
      cutterContextNodes(withOwnHole, contextOf(nodes, level.id)),
    )

    expect(built.holes).toHaveLength(2)
    expect(built.holes[0]).toEqual(withOwnHole.holes[0])
  })

  test('with no rock on the Site, the slab is returned as it was', () => {
    const { nodes, slab, level, rock, site } = scene()
    const bare = {
      ...nodes,
      [site.id]: { ...site, children: site.children.filter((id) => id !== rock.id) },
    }
    delete (bare as Record<string, unknown>)[rock.id]

    const built = withHostedCutterHoles(slab, cutterContextNodes(slab, contextOf(bare, level.id)))

    expect(built).toBe(slab)
  })
})

describe('a floor cut mid-gesture', () => {
  const contextOf = (nodes: ReturnType<typeof scene>['nodes'], parentId: string): GeometryContext =>
    ({
      parent: nodes[parentId as keyof typeof nodes],
      children: [],
      siblings: [],
      resolve: (id: string) => nodes[id as keyof typeof nodes],
    }) as unknown as GeometryContext

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
  })

  test('follows a rock being reshaped, before the edit is committed', () => {
    const { nodes, slab, level, rock } = scene()
    const away = rock.polygon.map(([x, z]) => [x + 30, z] as [number, number])

    useLiveNodeOverrides.getState().set(rock.id, { polygon: away })

    const built = withHostedCutterHoles(slab, cutterContextNodes(slab, contextOf(nodes, level.id)))
    expect(built.holes).toEqual([])
  })

  test('follows a rock being moved whole', () => {
    const { nodes, slab, level, rock } = scene()
    const before = withHostedCutterHoles(slab, cutterContextNodes(slab, contextOf(nodes, level.id)))

    useLiveTransforms.getState().set(rock.id, { position: [1, 0, 0], rotation: 0 })

    const after = withHostedCutterHoles(slab, cutterContextNodes(slab, contextOf(nodes, level.id)))
    const left = (holes: Point[][]) => Math.min(...holes.flat().map(([x]) => x ?? 0))
    expect(left(after.holes as Point[][])).toBeCloseTo(left(before.holes as Point[][]) + 1, 6)
  })

  test('follows a building being moved, clear of its rock', () => {
    const { nodes, slab, level } = scene({ slabHalf: 8 })
    const house = nodes[level.parentId as keyof typeof nodes] as { id: string }

    useLiveTransforms.getState().set(house.id, { position: [40, 0, 0], rotation: 0 })

    const built = withHostedCutterHoles(slab, cutterContextNodes(slab, contextOf(nodes, level.id)))
    expect(built.holes).toEqual([])
  })
})
