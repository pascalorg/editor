import { describe, expect, test } from 'bun:test'
import {
  AnyNode,
  buildPlanting,
  estimatePlanting,
  FLAT_GROUND,
  type HedgeMesh,
  PLANTING_LIMITS,
  PLANTING_MAX_TRIANGLES,
  PlantingNode,
  PlantingSpecies,
  planPlanting,
  plantingArea,
  plantingCentroid,
  plantingContains,
  plantingEdgeDistance,
  plantingOrganicOutline,
  plantingSeenDepth,
  plantingSimple,
} from '../index'
import { hedgeBufferHashes } from './__fixtures__/hedge-v1-cases'

type Point = [number, number]
const rectangle: Point[] = [
  [-3, -2],
  [5, -2],
  [5, 2],
  [-3, 2],
]
const bed = (extra: Partial<PlantingNode> = {}) =>
  PlantingNode.parse({ id: 'planting_test', outline: rectangle, seed: 19, ...extra })
const triangles = (meshes: HedgeMesh[]) =>
  meshes.reduce((sum, mesh) => sum + mesh.index.length / 3, 0)
// Independent textbook shoelace oracle, not a call back into the outline generator.
function area(points: Point[]) {
  return (
    points.reduce((sum, [x, z], i) => {
      const q = points[(i + 1) % points.length]!
      return sum + x * q[1] - q[0] * z
    }, 0) / 2
  )
}

const sketchOutline: Point[] = [
  [-2.9, 1.25],
  [2.9, 1.25],
  [2.9, -1.25],
  [-2.9, -1.25],
]

// A connected component of touching mature crowns is a drift; nearby dots alone are not.
// The oracle uses the species' public mature spread, not scatter exclusion radii.
function crownComponents(
  node: PlantingNode,
  placements: ReturnType<typeof planPlanting>['placements'],
) {
  const remaining = new Set(placements.map((_, i) => i))
  const components: number[][] = []
  for (const first of remaining) {
    remaining.delete(first)
    const component = [first]
    for (const index of component) {
      const p = placements[index]!
      for (const next of remaining) {
        const q = placements[next]!
        if (
          p.species === q.species &&
          Math.hypot(p.x - q.x, p.z - q.z) <=
            (node.plants[p.species]!.spread * (p.scale + q.scale)) / 2
        ) {
          remaining.delete(next)
          component.push(next)
        }
      }
    }
    components.push(component)
  }
  return components
}

// Provenance: rectangle/triangle/L-shape geometry and the stored schema contract. Smoothing
// may change implementation, but cannot change requested area, centre, topology or winding.
describe('planting outlines', () => {
  test('the default sketch outline has bays as well as bulges, not only rounded corners', () => {
    const outline = planPlanting(bed({ outline: sketchOutline }), FLAT_GROUND).outline
    expect(Math.abs(area(outline))).toBeCloseTo(14.5, 7)
    const winding = Math.sign(area(outline))
    const turns = outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length]!
      const c = outline[(i + 2) % outline.length]!
      return winding * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    })
    // A smoothed rectangle remains convex; a true bay introduces a reflex turn.
    expect(turns.some((turn) => turn < -1e-6)).toBe(true)
    expect(turns.some((turn) => turn > 1e-6)).toBe(true)
    expect(outline).toEqual(planPlanting(bed({ outline: sketchOutline }), FLAT_GROUND).outline)
  })
  test('textbook area, centroid, containment, distance and seen-side direction', () => {
    expect(plantingArea(rectangle)).toBe(32)
    expect(plantingCentroid(rectangle)).toEqual([1, 0])
    const triangle: Point[] = [
      [0, 0],
      [6, 0],
      [0, 3],
    ]
    expect(plantingArea(triangle)).toBe(9)
    expect(plantingCentroid(triangle)).toEqual([2, 1])
    expect(plantingContains(triangle, 1, 1)).toBe(true)
    expect(plantingContains(triangle, 5, 2)).toBe(false)
    expect(plantingEdgeDistance(rectangle, 1, 0)).toBe(2)
    expect(plantingSeenDepth(rectangle, 1, 1)).toBeCloseTo(0.25, 10)
    expect(plantingSeenDepth(rectangle, 1, -1)).toBeCloseTo(0.75, 10)
  })
  test.each([
    ['rectangle', rectangle, 32, [1, 0]],
    [
      'concave L',
      [
        [0, 0],
        [4, 0],
        [4, 1],
        [1, 1],
        [1, 4],
        [0, 4],
      ],
      7,
      [19 / 14, 19 / 14],
    ],
    [
      'narrow neck',
      [
        [0, 0],
        [2, 0],
        [2, 0.95],
        [4, 0.95],
        [4, 0],
        [6, 0],
        [6, 2],
        [4, 2],
        [4, 1.05],
        [2, 1.05],
        [2, 2],
        [0, 2],
      ],
      8.2,
      [3, 1],
    ],
  ] as [string, Point[], number, Point][])(
    '%s stays simple, centred and area-preserving for either winding',
    (_name, input, expectedArea, center) => {
      for (const points of [input, [...input].reverse()])
        for (const seed of [1, 19, 2147483647]) {
          const result = plantingOrganicOutline(points, seed)
          expect(Math.abs(area(result))).toBeCloseTo(expectedArea, 7)
          expect(Math.sign(area(result))).toBe(Math.sign(area(points)))
          expect(plantingSimple(result)).toBe(true)
          expect(result.length).toBeLessThanOrEqual(PLANTING_LIMITS.maxOutlinePoints)
          const centroid = plantingCentroid(result)
          expect(centroid[0]).toBeCloseTo(center[0], 7)
          expect(centroid[1]).toBeCloseTo(center[1], 7)
          expect(result).toEqual(plantingOrganicOutline(points, seed))
        }
    },
  )
  test('recognises crossing, repeated and doubled-back boundaries instead of treating them as beds', () => {
    for (const points of [
      [
        [0, 0],
        [4, 4],
        [0, 4],
        [4, 0],
      ],
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [0, 0],
        [4, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    ] as Point[][])
      expect(plantingSimple(points)).toBe(false)
  })
})

describe('the stored planting', () => {
  test('defaults to three layers, keeps one node and survives the public scene schema', () => {
    const node = bed()
    expect(node.center).toEqual([0, 0])
    // Three layers, not exactly three species: Main approved a richer default mix
    // after the first sketch comparison failed visually (2026-11-17).
    expect(node.plants.length).toBeGreaterThanOrEqual(3)
    expect(node.plants.length).toBeLessThanOrEqual(8)
    expect(new Set(node.plants.map((p) => p.layer))).toEqual(new Set(['back', 'mid', 'edge']))
    const byLayer = Object.fromEntries(
      ['back', 'mid', 'edge'].map((layer) => [
        layer,
        Math.max(...node.plants.filter((p) => p.layer === layer).map((p) => p.height)),
      ]),
    )
    expect(byLayer.back!).toBeGreaterThan(byLayer.mid!)
    expect(byLayer.mid!).toBeGreaterThan(byLayer.edge!)
    expect(AnyNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
    const second = bed()
    node.plants[0]!.height = 2
    expect(second.plants[0]!.height).not.toBe(2)
    expect('placements' in second).toBe(false)
    expect('meshes' in second).toBe(false)
  })
  test('accepts inclusive area and species boundaries', () => {
    for (const area of [0.25, 2500]) expect(PlantingNode.safeParse({ area }).success).toBe(true)
    for (const count of [1, 8])
      expect(
        PlantingNode.safeParse({ area: 20, plants: Array.from({ length: count }, () => ({})) })
          .success,
      ).toBe(true)
    for (const [key, min, max] of [
      ['height', 0.05, 4],
      ['spread', 0.1, 5],
      ['spacing', 0.12, 5],
      ['share', 0.01, 100],
    ] as const)
      for (const value of [min, max])
        expect(PlantingSpecies.safeParse({ [key]: value }).success).toBe(true)
  })
  test.each([
    {},
    { area: 10, outline: rectangle },
    { area: 0.249 },
    { area: 2500.01 },
    { area: Infinity },
    { area: 10, center: [NaN, 0] },
    { area: 10, plants: [] },
    { area: 10, plants: Array.from({ length: 9 }, () => ({})) },
    {
      outline: [
        [0, 0],
        [1, 0],
      ],
    },
    {
      outline: [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ],
    },
    {
      outline: Array.from({ length: 65 }, (_, i) => [
        Math.cos((i * 2 * Math.PI) / 65),
        Math.sin((i * 2 * Math.PI) / 65),
      ]),
    },
    { area: 10, pattern: 'random' },
    { area: 10, ground: 'grass' },
    { area: 10, edging: 'wood' },
    { area: 10, seed: 0.5 },
    { area: 10, gen: 0 },
    { area: 10, plants: [{ habit: 'tree' }] },
    { area: 10, plants: [{ leafColor: 'green' }] },
    { area: 10, plants: [{ flowerColor: '#fff' }] },
  ])('rejects malformed or unbounded stored input %j', (input) => {
    expect(PlantingNode.safeParse(input).success).toBe(false)
  })
  test('rejects out-of-bound dimensions and non-finite species values', () => {
    for (const [key, min, max] of [
      ['height', 0.05, 4],
      ['spread', 0.1, 5],
      ['spacing', 0.12, 5],
      ['share', 0.01, 100],
    ] as const)
      for (const value of [min - 0.001, max + 0.001, NaN, Infinity])
        expect(PlantingSpecies.safeParse({ [key]: value }).success).toBe(false)
  })
})

// Pairwise Euclidean separation is independent of the scatter's acceleration structure.
// Layers are judged by their observable +Z ordering, not candidate-specific band constants.
describe('planting layout', () => {
  test('the default sketch bed has touching mature drifts in every layer, not isolated cushions', () => {
    const node = bed({ outline: sketchOutline })
    const plan = planPlanting(node, FLAT_GROUND)
    const components = crownComponents(node, plan.placements)
    for (const layer of ['back', 'mid', 'edge']) {
      const sizes = components
        .filter((component) => plan.placements[component[0]!]!.layer === layer)
        .map((component) => component.length)
      expect(Math.max(0, ...sizes)).toBeGreaterThanOrEqual(3)
    }
    const carpets = plan.placements.filter((p) => node.plants[p.species]!.habit === 'carpet')
    expect(carpets.length).toBeGreaterThanOrEqual(3)
    expect(new Set(carpets.map((p) => p.scale)).size).toBeGreaterThan(1)
    // Seeded variety is not permission to produce nondeterministic placement.
    expect(plan.placements).toEqual(planPlanting(node, FLAT_GROUND).placements)
    expect(plan.placements).not.toEqual(planPlanting({ ...node, seed: 20 }, FLAT_GROUND).placements)
  })
  test('the default palette supplies a tall shrub backdrop and multiple flowering drifts', () => {
    const node = bed({ outline: sketchOutline })
    const placements = planPlanting(node, FLAT_GROUND).placements
    const shrubs = placements.filter((p) => {
      const species = node.plants[p.species]!
      return p.layer === 'back' && (species.habit === 'ball' || species.habit === 'mound')
    })
    expect(shrubs.length).toBeGreaterThanOrEqual(3)
    const shrubGroups = crownComponents(node, placements).filter((component) =>
      shrubs.includes(placements[component[0]!]!),
    )
    expect(Math.max(0, ...shrubGroups.map((component) => component.length))).toBeGreaterThanOrEqual(
      3,
    )
    for (const p of shrubs) {
      expect(node.plants[p.species]!.height).toBeGreaterThanOrEqual(1.2)
      expect(node.plants[p.species]!.height).toBeLessThanOrEqual(1.8)
    }
    const floweringSpikes = node.plants.filter((p) => p.habit === 'spike' && p.flowerColor)
    expect(new Set(floweringSpikes.map((p) => p.flowerColor)).size).toBeGreaterThanOrEqual(2)
    // A palette entry is not an accent if the default scatter never places it.
    expect(placements.some((p) => node.plants[p.species]!.habit === 'tuft')).toBe(true)
    for (const species of floweringSpikes) {
      const index = node.plants.indexOf(species)
      const largest = crownComponents(node, placements)
        .filter((component) => placements[component[0]!]!.species === index)
        .reduce((max, component) => Math.max(max, component.length), 0)
      expect(largest).toBeGreaterThanOrEqual(3)
    }
    expect(
      placements.some((p) => {
        const species = node.plants[p.species]!
        return species.habit === 'mound' && species.layer === 'mid' && species.flowerColor
      }),
    ).toBe(true)
    const average = (layer: string, coordinate: 'z' | 'height') => {
      const selected = placements.filter((p) => p.layer === layer)
      expect(selected.length).toBeGreaterThan(0)
      return (
        selected.reduce(
          (sum, p) => sum + (coordinate === 'z' ? p.z : node.plants[p.species]!.height * p.scale),
          0,
        ) / selected.length
      )
    }
    expect(average('back', 'z')).toBeLessThan(average('mid', 'z'))
    expect(average('mid', 'z')).toBeLessThan(average('edge', 'z'))
    expect(average('back', 'height')).toBeGreaterThan(average('mid', 'height'))
    expect(average('mid', 'height')).toBeGreaterThan(average('edge', 'height'))
  })
  test.each(['drifts', 'mixed', 'rows'] as const)(
    '%s obeys the polygon, spacing, species and obstacle predicate',
    (pattern) => {
      const calls: [number, number, number][] = []
      const accept = (x: number, z: number, radius: number) => {
        calls.push([x, z, radius])
        return x - radius > 0
      }
      const node = bed({ pattern })
      const plan = planPlanting(node, FLAT_GROUND, accept)
      expect(calls.length).toBeGreaterThan(0)
      expect(plan.placements.length).toBeGreaterThan(0)
      for (const [i, p] of plan.placements.entries()) {
        expect(plantingContains(plan.outline, p.x, p.z)).toBe(true)
        expect(p.x - p.radius).toBeGreaterThan(0)
        expect(
          calls.some(
            ([x, z, radius]) => x === p.x && z === p.z && radius >= p.radius && x - radius > 0,
          ),
        ).toBe(true)
        expect(p.layer).toBe(node.plants[p.species]!.layer)
        expect(p.radius).toBe(node.plants[p.species]!.spacing / 2)
        for (const q of plan.placements.slice(i + 1))
          expect(Math.hypot(p.x - q.x, p.z - q.z) + 1e-9).toBeGreaterThanOrEqual(
            p.radius + q.radius,
          )
      }
      expect(planPlanting(node, FLAT_GROUND, () => false).placements).toEqual([])
    },
  )
  test('default layers put structure behind mid planting and the soft edge toward +Z', () => {
    const plan = planPlanting(bed(), FLAT_GROUND)
    const mean = (layer: string) => {
      const plants = plan.placements.filter((p) => p.layer === layer)
      expect(plants.length).toBeGreaterThan(0)
      return plants.reduce((sum, p) => sum + p.z, 0) / plants.length
    }
    expect(mean('back')).toBeLessThan(mean('mid'))
    expect(mean('mid')).toBeLessThan(mean('edge'))
  })
  test('drifts have more same-species nearest neighbours than a mixed bed, over fixed seeds', () => {
    const plants = [
      PlantingSpecies.parse({ habit: 'mound', layer: 'mid', spacing: 0.4 }),
      PlantingSpecies.parse({ habit: 'ball', layer: 'mid', spacing: 0.4 }),
    ]
    const agreement = (pattern: 'drifts' | 'mixed') => {
      let same = 0,
        count = 0
      for (const seed of [7, 19, 41]) {
        const placements = planPlanting(bed({ plants, pattern, seed }), FLAT_GROUND).placements
        for (const p of placements) {
          let nearest = Infinity,
            species = -1
          for (const q of placements)
            if (q !== p) {
              const distance = Math.hypot(p.x - q.x, p.z - q.z)
              if (distance < nearest) {
                nearest = distance
                species = q.species
              }
            }
          if (species === p.species) same++
          count++
        }
      }
      return same / count
    }
    expect(agreement('drifts')).toBeGreaterThan(agreement('mixed'))
  })
  test('an unplaceable grass accent cannot starve smaller feasible plants', () => {
    // An accent reservation is a preference, not permission to return an empty bed.
    // One metre width cannot fit a five metre crown, while 0.2m mounds are feasible.
    const node = bed({
      outline: [
        [-0.5, -2],
        [0.5, -2],
        [0.5, 2],
        [-0.5, 2],
      ],
      plants: [
        PlantingSpecies.parse({ habit: 'tuft', layer: 'mid', spread: 5, spacing: 0.6 }),
        PlantingSpecies.parse({ habit: 'mound', layer: 'mid', spread: 0.2, spacing: 0.12 }),
      ],
    })
    const unrestricted = planPlanting(node, FLAT_GROUND)
    expect(unrestricted.placements.some((p) => p.species === 1)).toBe(true)
    // Independently exercise scene refusal: a rejected large crown does not reject
    // its smaller neighbour merely because both species share the same layer.
    const selective = planPlanting(node, FLAT_GROUND, (_x, _z, radius) => radius < 0.3)
    expect(selective.placements.length).toBeGreaterThan(0)
    expect(selective.placements.every((p) => p.species === 1)).toBe(true)
  })
  test('a grass-dominant palette is not capped at one tuft when its shrub cannot fit', () => {
    const node = bed({
      outline: [
        [-0.5, -2],
        [0.5, -2],
        [0.5, 2],
        [-0.5, 2],
      ],
      plants: [
        PlantingSpecies.parse({
          habit: 'tuft',
          layer: 'mid',
          spread: 0.2,
          spacing: 0.12,
          share: 100,
        }),
        PlantingSpecies.parse({
          habit: 'mound',
          layer: 'mid',
          spread: 5,
          spacing: 0.6,
          share: 0.01,
        }),
      ],
    })
    const plan = planPlanting(node, FLAT_GROUND)
    expect(plan.placements.filter((p) => p.species === 0).length).toBeGreaterThan(1)
  })
  test('an initial grass accent does not permanently exclude the rear of a grass-only bed', () => {
    // Independent vertical-line/polygon intersections locate the rear interior interval.
    // Initial accent positioning may prefer the front of the back band, not ban its rear.
    const depths: number[] = []
    for (const seed of [1, 7, 19]) {
      const node = bed({
        seed,
        plants: [
          PlantingSpecies.parse({ habit: 'tuft', layer: 'back', spread: 0.4, spacing: 0.4 }),
        ],
      })
      const plan = planPlanting(node, FLAT_GROUND)
      expect(plan.placements.length).toBeGreaterThan(0)
      for (const p of plan.placements) {
        const crossings: number[] = []
        plan.outline.forEach((a, i) => {
          const b = plan.outline[(i + 1) % plan.outline.length]!
          if (a[0] > p.x !== b[0] > p.x)
            crossings.push(a[1] + ((p.x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]))
        })
        crossings.sort((a, b) => a - b)
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const rear = crossings[i]!,
            front = crossings[i + 1]!
          if (p.z >= rear && p.z <= front) depths.push((front - p.z) / (front - rear))
        }
      }
    }
    // The rear fifth is real usable planting space, not an accent-only forbidden band.
    expect(Math.max(...depths)).toBeGreaterThan(0.8)
  })
  test('ground translation lifts roots exactly, and no crown crosses a terrain region break', () => {
    const flat = planPlanting(bed(), FLAT_GROUND)
    const raised = planPlanting(bed(), { heightAt: () => 3 })
    expect(raised.placements.length).toBe(flat.placements.length)
    raised.placements.forEach((p, i) => {
      expect(p.y - flat.placements[i]!.y).toBeCloseTo(3, 9)
    })
    const split = planPlanting(bed(), {
      heightAt: (x) => (x < 1 ? 0 : 2),
      regionAt: (x) => (x < 1 ? 'west' : 'east'),
    })
    expect(split.placements.length).toBeGreaterThan(0)
    for (const p of split.placements)
      expect(Math.abs(p.x - 1) + 1e-9).toBeGreaterThanOrEqual(p.radius)
  })
})

describe('planting meshes and budget', () => {
  test.each(['mound', 'ball', 'spike', 'tuft', 'carpet'] as const)(
    '%s emits deterministic valid geometry with an exact estimate and a far body prefix',
    (habit) => {
      const node = bed({
        plants: [
          PlantingSpecies.parse({
            habit,
            height: 0.8,
            spread: 0.6,
            spacing: 1,
            flowerColor: '#ff2255',
          }),
        ],
      })
      const { plan, meshes } = buildPlanting(node, FLAT_GROUND)
      expect(plan.placements.length).toBeGreaterThan(0)
      expect(triangles(meshes)).toBe(plan.estimate.triangles)
      expect(meshes.reduce((sum, m) => sum + m.position.length / 3, 0)).toBe(plan.estimate.vertices)
      expect(meshes.reduce((sum, m) => sum + m.bodyIndexCount / 3, 0)).toBe(
        plan.estimate.bodyTriangles,
      )
      expect(meshes.length).toBe(plan.estimate.meshes)
      expect(estimatePlanting(node, plan)).toEqual(plan.estimate)
      expect(hedgeBufferHashes(meshes)).toEqual(
        hedgeBufferHashes(buildPlanting(node, FLAT_GROUND).meshes),
      )
      expect(hedgeBufferHashes(meshes)).not.toEqual(
        hedgeBufferHashes(buildPlanting({ ...node, seed: 20 }, FLAT_GROUND).meshes),
      )
      expect(plan.estimate.bodyTriangles).toBeGreaterThan(0)
      expect(plan.estimate.bodyTriangles).toBeLessThan(plan.estimate.triangles)
      for (const mesh of meshes) {
        expect(mesh.position.every(Number.isFinite)).toBe(true)
        expect(mesh.normal.length).toBe(mesh.position.length)
        expect(mesh.color.length).toBe(mesh.position.length)
        expect(mesh.color.every((v) => Number.isFinite(v) && v >= 0 && v <= 1.0001)).toBe(true)
        expect(mesh.index.every((i) => i < mesh.position.length / 3)).toBe(true)
        expect(mesh.bodyIndexCount % 3).toBe(0)
        for (let i = 0; i < mesh.normal.length; i += 3)
          expect(Math.hypot(mesh.normal[i]!, mesh.normal[i + 1]!, mesh.normal[i + 2]!)).toBeCloseTo(
            1,
            4,
          )
      }
    },
  )
  test('flower colour adds visible coloured geometry without moving the layout', () => {
    const node = bed({
      plants: [PlantingSpecies.parse({ habit: 'mound', spacing: 1, leafColor: '#225522' })],
    })
    const bare = buildPlanting(node, FLAT_GROUND)
    const flowers = buildPlanting(
      { ...node, plants: node.plants.map((p) => ({ ...p, flowerColor: '#ff0000' })) },
      FLAT_GROUND,
    )
    expect(flowers.plan.placements).toEqual(bare.plan.placements)
    expect(triangles(flowers.meshes)).toBeGreaterThan(triangles(bare.meshes))
    expect(
      flowers.meshes.some((m) =>
        Array.from(m.color).some((r, i) => i % 3 === 0 && r > 0.3 && r > m.color[i + 1]! * 3),
      ),
    ).toBe(true)
  })
  test('soil/mulch and edging are actual mesh contributions even when all plants are refused', () => {
    const reject = () => false
    const empty = buildPlanting(bed({ ground: 'none', edging: 'none' }), FLAT_GROUND, reject)
    const soil = buildPlanting(bed({ ground: 'soil', edging: 'none' }), FLAT_GROUND, reject)
    const mulch = buildPlanting(bed({ ground: 'mulch', edging: 'none' }), FLAT_GROUND, reject)
    expect(triangles(empty.meshes)).toBe(0)
    expect(triangles(soil.meshes)).toBeGreaterThan(0)
    expect(hedgeBufferHashes(soil.meshes)).not.toEqual(hedgeBufferHashes(mulch.meshes))
    const heights = soil.meshes.flatMap((m) => Array.from(m.position).filter((_, i) => i % 3 === 1))
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.01)
    for (const edging of ['steel', 'stone'] as const) {
      const edged = buildPlanting(bed({ ground: 'soil', edging }), FLAT_GROUND, reject)
      expect(triangles(edged.meshes)).toBeGreaterThan(triangles(soil.meshes))
    }
  })
  test('the largest densest bed stays within the per-node cap by thinning, never allocating per-plant nodes', () => {
    const node = PlantingNode.parse({
      area: 2500,
      seed: 19,
      plants: [{ habit: 'mound', height: 4, spread: 5, spacing: 0.12, flowerColor: '#ffffff' }],
      edging: 'stone',
    })
    const { plan, meshes } = buildPlanting(node, FLAT_GROUND)
    expect(plan.withinBudget).toBe(true)
    expect(plan.placements.length).toBeGreaterThan(0)
    expect(plan.placements.length).toBeLessThanOrEqual(PLANTING_LIMITS.maxPlants)
    expect(triangles(meshes)).toBeLessThanOrEqual(PLANTING_MAX_TRIANGLES)
    expect(triangles(meshes)).toBe(plan.estimate.triangles)
    expect(meshes.length).toBeLessThan(plan.placements.length)
    expect(plan.area).toBeCloseTo(2500, 6)
  })
})
