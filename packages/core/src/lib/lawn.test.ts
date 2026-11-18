import { describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  buildLawn,
  commitTerrainField,
  createTerrainField,
  heightAt,
  LawnNode,
  LevelNode,
  PlantingNode,
  planLawn,
  plantingAreaOutline,
  plantingOrganicOutline,
  SiteNode,
  SlabNode,
  sampleLawnStrokes,
  WallNode,
} from '../index'
import { area, containsPoint, distanceToBoundary } from './polygon-boolean'

const square = (size: number): [number, number][] => [
  [0, 0],
  [size, 0],
  [size, size],
  [0, size],
]
const site = () =>
  SiteNode.parse({ id: 'site_lawn', polygon: { type: 'polygon', points: square(50) } })
const lawn = (props = {}) =>
  LawnNode.parse({
    id: 'lawn_test',
    parentId: 'site_lawn',
    outline: square(10),
    edgeFade: 0,
    ...props,
  })

describe('retained lawn ground', () => {
  test('keeps an exact narrow path hole and reports its owner and union area', () => {
    const owner = site()
    const path = SlabNode.parse({
      id: 'slab_path',
      parentId: owner.id,
      polygon: [
        [2, 2],
        [8, 2],
        [8, 2.1],
        [2, 2.1],
      ],
      metadata: { flatwork: 'walk' },
    })
    const plan = planLawn(lawn(), { [owner.id]: owner, [path.id]: path })
    expect(plan.facts.requestedAreaM2).toBe(100)
    expect(plan.facts.retainedAreaM2).toBeCloseTo(99.4, 7)
    expect(plan.polygons[0]?.holes).toHaveLength(1)
    expect(plan.facts.exclusions).toContainEqual({
      id: path.id,
      category: 'paving',
      areaM2: expect.closeTo(0.6, 7),
    })
    expect(plan.facts.excludedUnionAreaM2).toBeCloseTo(0.6, 7)
    const built = buildLawn(lawn(), { [owner.id]: owner, [path.id]: path })
    let baseArea = 0
    for (let offset = 0; offset < built.base.indices.length; offset += 3) {
      const points = [0, 1, 2].map((corner) => {
        const index = built.base.indices[offset + corner] ?? 0
        return [built.base.positions[index * 3] ?? 0, built.base.positions[index * 3 + 2] ?? 0] as [
          number,
          number,
        ]
      })
      baseArea += area([{ outer: points, holes: [] }])
    }
    expect(baseArea).toBeCloseTo(99.4, 5)
  })

  test('preserves a courtyard in a rotated building and excludes a floorless shell', () => {
    const owner = site()
    const building = BuildingNode.parse({
      id: 'building_lawn',
      parentId: owner.id,
      position: [5, 0, 5],
      rotation: [0, Math.PI / 2, 0],
    })
    const level = LevelNode.parse({ id: 'level_lawn', parentId: building.id, level: 0 })
    const courtyard = SlabNode.parse({
      id: 'slab_courtyard',
      parentId: level.id,
      polygon: square(3),
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
    })
    const scene = {
      [owner.id]: owner,
      [building.id]: building,
      [level.id]: level,
      [courtyard.id]: courtyard,
    }
    const plan = planLawn(lawn(), scene)
    expect(plan.facts.retainedAreaM2).toBeCloseTo(92, 6)
    expect(containsPoint(plan.polygons, [6.5, 3.5])).toBe(true)
    expect(containsPoint(plan.polygons, [5.5, 4.5])).toBe(false)
    const walls = square(3).map((start, index, points) =>
      WallNode.parse({
        id: `wall_lawn_${index}`,
        parentId: level.id,
        start,
        end: points[(index + 1) % points.length],
        thickness: 0.1,
      }),
    )
    const shellScene = {
      [owner.id]: owner,
      [building.id]: building,
      [level.id]: level,
      ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
    }
    const shell = planLawn(lawn(), shellScene)
    expect(containsPoint(shell.polygons, [6.5, 3.5])).toBe(false)
    expect(
      shell.facts.exclusions.some(
        (exclusion) => exclusion.id === building.id && exclusion.category === 'building',
      ),
    ).toBe(true)
  })

  test('excludes the same deformed outline used by the actual planting generator', () => {
    const owner = site()
    const bed = PlantingNode.parse({
      id: 'planting_bed',
      parentId: owner.id,
      area: 9,
      center: [5, 5],
      seed: 31,
    })
    const outline = plantingOrganicOutline(plantingAreaOutline(9, [5, 5]), bed.seed)
    const plan = planLawn(lawn(), { [owner.id]: owner, [bed.id]: bed })
    expect(plan.facts.retainedAreaM2).toBeCloseTo(100 - area([{ outer: outline, holes: [] }]), 3)
    expect(containsPoint(plan.polygons, [5, 5])).toBe(false)
  })

  test('clips to the property and reports coverage and union loss', () => {
    const owner = SiteNode.parse({
      id: 'site_lawn',
      polygon: { type: 'polygon', points: square(8) },
    })
    const plan = planLawn(lawn(), { [owner.id]: owner })
    expect(plan.facts.retainedAreaM2).toBe(64)
    expect(plan.facts.coverageFraction).toBe(0.64)
    expect(plan.facts.excludedUnionAreaM2).toBe(36)
  })

  test('reports individual owners but subtracts overlapping owners only once', () => {
    const owner = site()
    const first = SlabNode.parse({
      id: 'slab_first',
      parentId: owner.id,
      polygon: square(4).map(([x, z]) => [x + 2, z + 2]),
    })
    const second = SlabNode.parse({
      id: 'slab_second',
      parentId: owner.id,
      polygon: square(4).map(([x, z]) => [x + 4, z + 4]),
    })
    const plan = planLawn(lawn(), { [owner.id]: owner, [first.id]: first, [second.id]: second })
    expect(plan.facts.exclusions.map((exclusion) => exclusion.areaM2)).toEqual([16, 16])
    expect(plan.facts.excludedUnionAreaM2).toBe(28)
    expect(plan.facts.retainedAreaM2).toBe(72)
  })

  test('does not let another Site or its beds change this lawn', () => {
    const owner = site()
    const unrelated = SiteNode.parse({ id: 'site_elsewhere' })
    const bed = PlantingNode.parse({
      id: 'planting_elsewhere',
      parentId: unrelated.id,
      area: 25,
      center: [5, 5],
    })
    const baseline = buildLawn(lawn(), { [owner.id]: owner })
    expect(
      buildLawn(lawn(), { [owner.id]: owner, [unrelated.id]: unrelated, [bed.id]: bed }),
    ).toEqual(baseline)
  })

  test('splits the base along rendered cell diagonals rather than bilinear heights', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1, step: 1 })
    field.heights.set([0, 0, 1, 0, 2, 0, 1, 0, 0])
    const owner = SiteNode.parse({ ...site(), terrain: commitTerrainField(field) })
    const built = buildLawn(lawn({ outline: square(2) }), { [owner.id]: owner })
    for (let offset = 0; offset < built.base.indices.length; offset += 3) {
      const vertices = [0, 1, 2].map((corner) => {
        const index = built.base.indices[offset + corner] ?? 0
        return [
          built.base.positions[index * 3] ?? 0,
          built.base.positions[index * 3 + 1] ?? 0,
          built.base.positions[index * 3 + 2] ?? 0,
        ]
      })
      const x = vertices.reduce((sum, point) => sum + (point[0] ?? 0), 0) / 3
      const y = vertices.reduce((sum, point) => sum + (point[1] ?? 0), 0) / 3
      const z = vertices.reduce((sum, point) => sum + (point[2] ?? 0), 0) / 3
      expect(y).toBeCloseTo(heightAt(field, x, z), 5)
    }
    for (let offset = 0; offset < built.blades.rootHeight.length; offset += 4) {
      const roots = built.blades.rootHeight
      expect(roots[offset + 1]).toBeCloseTo(
        heightAt(field, roots[offset] ?? 0, roots[offset + 2] ?? 0),
        5,
      )
    }
  })
})

describe('bounded deterministic lawn detail', () => {
  test('repeats exact array bytes and seed changes root positions', () => {
    const owner = site()
    const input = lawn({ flowerDensity: 2, flowers: [{ species: 'daisy', share: 1 }] })
    const first = buildLawn(input, { [owner.id]: owner })
    const second = buildLawn(input, { [owner.id]: owner })
    expect(first).toEqual(second)
    expect(new Uint8Array(first.blades.rootHeight.buffer)).toEqual(
      new Uint8Array(second.blades.rootHeight.buffer),
    )
    expect(first.blades.rootHeight.byteLength + first.blades.traits.byteLength).toBe(
      first.blades.count * 32,
    )
    expect(first.blades.count).toBeGreaterThan(9800)
    expect(first.blades.count).toBeLessThanOrEqual(10000)
    expect(buildLawn({ ...input, seed: 77 }, { [owner.id]: owner }).blades.rootHeight).not.toEqual(
      first.blades.rootHeight,
    )
    for (const chunk of first.blades.chunks) {
      expect(chunk.midCount).toBe(Math.floor(chunk.count * 0.2))
      expect(chunk.start + chunk.count).toBeLessThanOrEqual(first.blades.count)
      expect(chunk.bounds[2] - chunk.bounds[0]).toBe(8)
    }
  })

  test('caps complete flower geometry and obeys the explicitly saved season', () => {
    const owner = site()
    const geometryPerSpecies: string[] = []
    for (const species of ['daisy', 'clover', 'yarrow'] as const) {
      const input = lawn({
        outline: square(40),
        flowers: [{ species, share: 1 }],
        flowerDensity: 2,
        roughness: 1,
      })
      const built = buildLawn(input, { [owner.id]: owner })
      expect(built.flowers.count).toBeGreaterThan(0)
      expect(built.flowers.count).toBeLessThanOrEqual(1024)
      expect(built.flowers.indices.length / 3).toBeLessThanOrEqual(built.flowers.count * 64)
      geometryPerSpecies.push(
        JSON.stringify([
          ...built.flowers.positions.subarray(0, (built.flowers.headIndexEnds[0] ?? 0) * 3),
        ]),
      )
      for (let head = 0; head < built.flowers.headIndexEnds.length; head++) {
        expect(
          ((built.flowers.headIndexEnds[head] ?? 0) -
            (built.flowers.headIndexEnds[head - 1] ?? 0)) /
            3,
        ).toBeLessThanOrEqual(64)
      }
      expect([...built.flowers.positions, ...built.flowers.normals].every(Number.isFinite)).toBe(
        true,
      )
      expect(buildLawn({ ...input, season: 'winter' }, { [owner.id]: owner }).flowers.count).toBe(0)
    }
    expect(new Set(geometryPerSpecies).size).toBe(3)
  })

  test('keeps roots out of actual bed and path exclusions, including merged flower roots', () => {
    const owner = site()
    const path = SlabNode.parse({
      id: 'slab_roots',
      parentId: owner.id,
      polygon: [
        [4, 0],
        [4.1, 0],
        [4.1, 10],
        [4, 10],
      ],
      metadata: { flatwork: 'walk' },
    })
    const bed = PlantingNode.parse({
      id: 'planting_roots',
      parentId: owner.id,
      area: 9,
      center: [7, 7],
      seed: 43,
    })
    const built = buildLawn(
      lawn({ flowerDensity: 2, flowers: [{ species: 'clover', share: 1 }] }),
      { [owner.id]: owner, [path.id]: path, [bed.id]: bed },
    )
    expect(built.flowers.count).toBeGreaterThan(0)
    for (let offset = 0; offset < built.blades.rootHeight.length; offset += 4) {
      expect(
        containsPoint(built.polygons, [
          built.blades.rootHeight[offset] ?? 0,
          built.blades.rootHeight[offset + 2] ?? 0,
        ]),
      ).toBe(true)
    }
    for (let head = 0; head < built.flowers.count; head++) {
      const start = (built.flowers.headIndexEnds[head - 1] ?? 0) * 3
      const positions = built.flowers.positions
      const x = ((positions[start] ?? 0) + (positions[start + 3] ?? 0)) / 2
      const z = ((positions[start + 2] ?? 0) + (positions[start + 5] ?? 0)) / 2
      expect(containsPoint(built.polygons, [x, z])).toBe(true)
    }
  })

  test('keeps the complete tall-blade wind envelope clear of paths and outline edges', () => {
    const owner = site()
    const path = SlabNode.parse({
      id: 'slab_wind_clearance',
      parentId: owner.id,
      polygon: [
        [4, 0],
        [4.1, 0],
        [4.1, 10],
        [4, 10],
      ],
    })
    const input = lawn({ height: 1, roughness: 1, wind: 1, edgeFade: 0 })
    const built = buildLawn(input, { [owner.id]: owner, [path.id]: path })
    for (let offset = 0; offset < built.blades.rootHeight.length; offset += 4) {
      const roots = built.blades.rootHeight,
        traits = built.blades.traits
      const distance = distanceToBoundary(built.polygons, [
        roots[offset] ?? 0,
        roots[offset + 2] ?? 0,
      ])
      const reach =
        (roots[offset + 3] ?? 0) * ((traits[offset + 1] ?? 0) * 1.6 + input.wind * 0.48) +
        (traits[offset + 3] ?? 0) / 2
      expect(reach).toBeLessThanOrEqual(distance + 0.00001)
    }
  })

  test('refuses work above the candidate cap before generating mesh buffers', () => {
    expect(() =>
      planLawn(
        lawn({
          outline: [
            [0, 0],
            [1000, 0],
            [1000, 1],
            [0, 1],
          ],
        }),
        {},
      ),
    ).not.toThrow()
    expect(() =>
      planLawn(
        lawn({
          outline: [
            [0, 0],
            [1000, 0],
            [0, 5],
          ],
        }),
        {},
      ),
    ).toThrow(/budget|candidate/i)
  })

  test('refuses terrain detail above the base work budget before mesh allocation', () => {
    const field = createTerrainField({ cols: 257, rows: 257, spacing: 0.001 })
    const owner = SiteNode.parse({ ...site(), terrain: commitTerrainField(field) })
    expect(() => planLawn(lawn(), { [owner.id]: owner })).toThrow(/terrain|budget/i)
  })

  test('refuses excessive combined stroke work even when individual stroke bounds are valid', () => {
    const points = Array.from({ length: 128 }, (_, index): [number, number] => [index / 10, 5])
    const stroke = { points, radiusM: 10, effect: 'taller' as const, strength: 1 }
    const input = lawn({ outline: square(50), strokes: Array.from({ length: 64 }, () => stroke) })
    expect(() => planLawn(input, {})).toThrow(/stroke.*budget/i)
    const bounded = planLawn(lawn({ strokes: [stroke] }), {})
    expect(bounded.facts.budget.maxStrokeWork).toBe(32000000)
    expect(bounded.facts.budget.strokeWorkEstimate).toBeLessThanOrEqual(
      bounded.facts.budget.maxStrokeWork,
    )
  })
})

describe('ordered vector strokes', () => {
  const dab = (
    effect: 'bare' | 'grass' | 'taller' | 'shorter' | 'more-flowers' | 'fewer-flowers',
  ) => ({ points: [[5, 5]] as [number, number][], radiusM: 2, effect, strength: 1 })
  test('uses smooth swept-disk falloff and list ordering without changing unrelated channels', () => {
    expect(sampleLawnStrokes([dab('bare')], 5, 5).coverage).toBe(0)
    expect(sampleLawnStrokes([dab('bare')], 6, 5).coverage).toBeCloseTo(0.5)
    expect(sampleLawnStrokes([dab('bare')], 7, 5).coverage).toBe(1)
    expect(sampleLawnStrokes([dab('bare'), dab('grass')], 5, 5).coverage).toBe(1)
    expect(sampleLawnStrokes([dab('grass'), dab('bare')], 5, 5).coverage).toBe(0)
    expect(sampleLawnStrokes([dab('taller'), dab('grass')], 5, 5).height).toBe(2)
    expect(sampleLawnStrokes([dab('shorter')], 5, 5).height).toBe(0.25)
    expect(sampleLawnStrokes([dab('fewer-flowers'), dab('more-flowers')], 5, 5).flowers).toBe(1)
    expect(sampleLawnStrokes([dab('more-flowers')], 5, 5).flowers).toBeGreaterThan(
      sampleLawnStrokes([], 5, 5).flowers,
    )
    expect(
      sampleLawnStrokes(
        [
          {
            ...dab('bare'),
            points: [
              [2, 5],
              [8, 5],
            ],
          },
        ],
        6,
        6,
      ).coverage,
    ).toBeCloseTo(0.5)
  })

  test('changes roots, heights, flowers and soil base, retaining the footprint', () => {
    const owner = site()
    const input = lawn({ flowers: [{ species: 'clover', share: 1 }], flowerDensity: 2 })
    const original = buildLawn(input, { [owner.id]: owner })
    const brushed = buildLawn(
      { ...input, strokes: [dab('bare'), dab('taller'), dab('fewer-flowers')] },
      { [owner.id]: owner },
    )
    expect(brushed.facts.retainedAreaM2).toBe(original.facts.retainedAreaM2)
    expect(brushed.blades.count).toBeLessThan(original.blades.count)
    expect(brushed.base.colors).not.toEqual(original.base.colors)
    expect(brushed.facts.strokeAreas.estimated).toBe(true)
    expect(brushed.facts.strokeAreas.byEffect.bare).toBeGreaterThan(10)
  })

  test('retains a visible soil change for a minimum-radius dab between coarse ground vertices', () => {
    const owner = site()
    const input = lawn({ strokes: [{ ...dab('bare'), points: [[5.37, 5.43]], radiusM: 0.05 }] })
    const built = buildLawn(input, { [owner.id]: owner })
    expect(built.base.positions.length).toBeGreaterThan(
      buildLawn(lawn(), { [owner.id]: owner }).base.positions.length,
    )
    expect(built.facts.retainedAreaM2).toBe(100)
    expect(built.facts.strokeAreas.byEffect.bare).toBeGreaterThan(0)
    expect(Math.abs(built.facts.strokeAreas.byEffect.bare - Math.PI * 0.05 ** 2)).toBeLessThan(
      0.002,
    )
    expect(built.facts.strokeAreas.minimumSamplingResolutionM).toBeLessThanOrEqual(0.025)
    const source = [...built.base.positions]
    expect(
      source.some(
        (_, offset) =>
          offset % 3 === 0 &&
          Math.hypot((source[offset] ?? 0) - 5.37, (source[offset + 2] ?? 0) - 5.43) < 0.025,
      ),
    ).toBe(true)
  })
})
