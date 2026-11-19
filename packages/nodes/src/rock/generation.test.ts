import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  BuildingNode,
  buildRock,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  planRock,
  RockNode,
  rockFacts,
  rockSections,
  rockSlabHoles,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { Box3, LOD, Mesh, PerspectiveCamera, Raycaster, Vector3 } from 'three'
import {
  edges,
  float32Slack,
  insidePolygon,
  insideSegments,
  type Point,
  planeSegments,
  segmentDistance,
} from './__tests__/geometry-oracles'
import { buildRockGeometry, buildRockMesh } from './geometry'

const types = ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'] as const
const rectangle: Point[] = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const concave: Point[] = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [0, 0],
  [0, 2],
  [-3, 2],
]
const node = (extra: Partial<RockNode> = {}) =>
  RockNode.parse({ polygon: rectangle, gen: 2, height: 2.4, seed: 17, ...extra })
const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')
const signature = (built: ReturnType<typeof buildRock>) =>
  [built.near, built.far].map((mesh) => {
    if (!mesh) throw new Error('An accepted gen-2 rock must produce both levels')
    return { position: hash(mesh.position), index: hash(mesh.index) }
  })
function disposeGeometry(group: ReturnType<typeof buildRockGeometry>) {
  group.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose()
  })
}

// Requirements are seed persistence, a hard actual budget and physical envelope. Neither the
// expected topology nor any candidate output is frozen, so an equivalent mesher may replace it.
describe('generation 2 saved-number geometry', () => {
  for (const rockType of types) {
    test(`${rockType}: repeat and save/load preserve near and far mesh bytes`, () => {
      for (const seed of [0, -7, 2147483647]) {
        const rock = node({ rockType, seed, weathering: 0.63, moss: 0.42 })
        const first = signature(buildRock(rock))
        expect(signature(buildRock(rock))).toEqual(first)
        expect(signature(buildRock(RockNode.parse(JSON.parse(JSON.stringify(rock)))))).toEqual(
          first,
        )
      }
    })

    test(`${rockType}: seed and weathering change the physical shape, moss does not`, () => {
      const rock = node({ rockType, weathering: 0 })
      const initial = signature(buildRock(rock))
      expect(signature(buildRock({ ...rock, seed: 18 }))).not.toEqual(initial)
      expect(signature(buildRock({ ...rock, weathering: 1 }))).not.toEqual(initial)
      expect(signature(buildRock({ ...rock, moss: 1 }))).toEqual(initial)
    })

    test(`${rockType}: rendered normals and indices also survive save/load byte for byte`, () => {
      const rock = node({ rockType, seed: -7 })
      const first = buildRockMesh(rock, -0.3, rock.height)
      const restored = buildRockMesh(
        RockNode.parse(JSON.parse(JSON.stringify(rock))),
        -0.3,
        rock.height,
      )
      try {
        for (const name of ['position', 'normal']) {
          expect(hash(first.getAttribute(name).array)).toBe(hash(restored.getAttribute(name).array))
          expect(Array.from(first.getAttribute(name).array).every(Number.isFinite)).toBe(true)
        }
        expect(first.index && hash(first.index.array)).toBe(
          restored.index && hash(restored.index.array),
        )
      } finally {
        first.dispose()
        restored.dispose()
      }
    })
  }

  test('the exterior type selection is not ignored by the mesh generator', () => {
    const signatures = types.map((rockType) =>
      JSON.stringify(signature(buildRock(node({ rockType })))),
    )
    expect(new Set(signatures).size).toBe(types.length)
  })

  const manyCorners = (indented: boolean): Point[] =>
    Array.from({ length: 64 }, (_, i) => {
      const angle = (i * Math.PI) / 32
      const radius = indented && i % 2 ? 1.4 : 3
      return [Math.cos(angle) * radius + 11, Math.sin(angle) * radius - 7]
    })
  const outlines = [
    rectangle,
    concave,
    [...concave].reverse(),
    manyCorners(false),
    manyCorners(true),
  ]
  for (const rockType of types) {
    test(`${rockType}: every physical level fits its polygon/height and never exceeds the hard cap`, () => {
      for (const polygon of outlines) {
        for (const weathering of [0, 1]) {
          const rock = node({ polygon, rockType, weathering, seed: -31 })
          const plan = planRock(rock, { footY: -1.3, topY: 1.4 })
          expect(plan.problem).toBeNull()
          expect(plan.withinBudget).toBe(true)
          const built = buildRock(rock, { footY: -1.3, topY: 1.4 })
          for (const [level, cap] of [
            ['near', 4096],
            ['far', 600],
          ] as const) {
            const mesh = built[level]
            expect(mesh).not.toBeNull()
            if (!mesh) throw new Error(`Missing ${level} geometry`)
            const count = mesh.index.length / 3
            expect(Number.isInteger(count)).toBe(true)
            expect(count).toBeGreaterThan(0)
            expect(count).toBeLessThanOrEqual(cap)
            expect(count).toBeLessThanOrEqual(plan.estimate[level].triangles)
            expect(mesh.position.length % 3).toBe(0)
            const slack = float32Slack(mesh.position)
            let bottom = Infinity
            let top = -Infinity
            for (let i = 0; i < mesh.position.length; i += 3) {
              const [x, y, z] = [mesh.position[i]!, mesh.position[i + 1]!, mesh.position[i + 2]!]
              expect([x, y, z].every(Number.isFinite)).toBe(true)
              expect(insidePolygon([x, z], polygon, slack)).toBe(true)
              expect(y).toBeGreaterThanOrEqual(-1.3 - slack)
              expect(y).toBeLessThanOrEqual(1.4 + slack)
              bottom = Math.min(bottom, y)
              top = Math.max(top, y)
            }
            expect(Math.abs(bottom + 1.3)).toBeLessThanOrEqual(slack)
            expect(Math.abs(top - 1.4)).toBeLessThanOrEqual(slack)
            // Vertices alone do not detect a triangle bridging a concave notch.
            for (let i = 0; i < mesh.index.length; i += 3) {
              const corners = [mesh.index[i]!, mesh.index[i + 1]!, mesh.index[i + 2]!]
              for (const index of corners) expect(index).toBeLessThan(mesh.position.length / 3)
              const points = corners.map(
                (index): Point => [mesh.position[index * 3]!, mesh.position[index * 3 + 2]!],
              )
              const centroid: Point = [
                points.reduce((sum, p) => sum + p[0], 0) / 3,
                points.reduce((sum, p) => sum + p[1], 0) / 3,
              ]
              expect(insidePolygon(centroid, polygon, slack)).toBe(true)
            }
          }
          expect(built.far!.index.length).toBeLessThanOrEqual(built.near!.index.length)
        }
      }
    })
  }

  test('reported estimated triangles actually bound both generated levels', () => {
    for (const rockType of types) {
      const site = SiteNode.parse({})
      const rock = node({ parentId: site.id, rockType })
      const facts = rockFacts(rock, { [site.id]: site, [rock.id]: rock })
      const built = buildRock(rock)
      expect(facts.estimatedTriangles.near).toBeGreaterThanOrEqual(built.near!.index.length / 3)
      expect(facts.estimatedTriangles.near).toBeLessThanOrEqual(4096)
      expect(facts.estimatedTriangles.far).toBeGreaterThanOrEqual(built.far!.index.length / 3)
      expect(facts.estimatedTriangles.far).toBeLessThanOrEqual(600)
    }
  })

  test('a thin stepping stone and maximum-height rock honour stored height without a supplied span', () => {
    for (const height of [0.12, 60]) {
      const built = buildRock(node({ rockType: 'stepping', height }))
      for (const mesh of [built.near, built.far]) {
        if (!mesh) throw new Error('Valid saved height produced no mesh')
        const ys = Array.from(mesh.position).filter((_, index) => index % 3 === 1)
        const slack = float32Slack(mesh.position)
        expect(Math.abs(Math.min(...ys) + 0.3)).toBeLessThanOrEqual(slack)
        expect(Math.abs(Math.max(...ys) - height)).toBeLessThanOrEqual(slack)
      }
    }
  })

  test('invalid physical outlines produce a refusal plan and no near/far mesh', () => {
    for (const polygon of [
      [
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ],
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    ] as Point[][]) {
      const rock = node({ polygon })
      const plan = planRock(rock)
      expect(plan.problem).not.toBeNull()
      expect(plan.withinBudget).toBe(false)
      expect(buildRock(rock)).toMatchObject({ near: null, far: null })
    }
  })
})

describe('production rock placement and LOD', () => {
  for (const depression of [false, true]) {
    test(`honours ${depression ? 'the lowest interior terrain sample' : 'a raised flat terrain'} in world coordinates`, () => {
      const field = createTerrainField({ origin: [-4, -4], cols: 9, rows: 9, spacing: 1 })
      field.heights.fill(Math.round(2 / field.step))
      if (depression) field.heights[4 * 9 + 4] = Math.round(-1 / field.step)
      const site = SiteNode.parse({ terrain: encodeTerrainField(field) })
      const rock = node({ parentId: site.id, height: 2.4 })
      const group = buildRockGeometry(rock, { parent: site })
      try {
        group.updateMatrixWorld(true)
        const box = new Box3().setFromObject(group)
        const ground = depression ? -1 : 2
        expect(box.min.y).toBeCloseTo(ground - 0.3, 5)
        expect(box.max.y).toBeCloseTo(ground + 2.4, 5)
      } finally {
        disposeGeometry(group)
      }
    })
  }

  test('a distant translated rock chooses LOD relative to itself, then returns to near', () => {
    const rock = node({
      polygon: [
        [99, 49],
        [101, 49],
        [101, 51],
        [99, 51],
      ],
      height: 1.2,
    })
    const group = buildRockGeometry(rock)
    try {
      group.updateMatrixWorld(true)
      const lods: LOD[] = []
      group.traverse((object) => {
        if (object instanceof LOD) lods.push(object)
      })
      expect(lods).toHaveLength(1)
      const lod = lods[0]!
      const camera = new PerspectiveCamera()
      const visibleTriangles = () => {
        let triangles = 0
        group.traverseVisible((object) => {
          if (object instanceof Mesh)
            triangles +=
              (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
        })
        return triangles
      }
      camera.position.set(100, 2, 54)
      camera.updateMatrixWorld(true)
      lod.update(camera)
      const near = visibleTriangles()
      expect(near).toBeGreaterThan(0)
      expect(near).toBeLessThanOrEqual(4096)
      camera.position.set(100, 2, 65)
      camera.updateMatrixWorld(true)
      lod.update(camera)
      expect(visibleTriangles()).toBeGreaterThan(0)
      expect(visibleTriangles()).toBeLessThanOrEqual(600)
      expect(visibleTriangles()).toBeLessThan(near)
      camera.position.set(100, 2, 54)
      camera.updateMatrixWorld(true)
      lod.update(camera)
      expect(visibleTriangles()).toBe(near)
    } finally {
      disposeGeometry(group)
    }
  })

  for (const rockType of types) {
    test(`${rockType}: recursive picking hits only the displayed LOD, including a zoomed distant camera`, () => {
      const group = buildRockGeometry(
        node({
          rockType,
          polygon: [
            [99, 49],
            [101, 49],
            [101, 51],
            [99, 51],
          ],
          height: 1.2,
        }),
      )
      try {
        group.updateMatrixWorld(true)
        const lods: LOD[] = []
        group.traverse((object) => {
          if (object instanceof LOD) lods.push(object)
        })
        expect(lods).toHaveLength(1)
        const lod = lods[0]!
        expect(lod.levels).toHaveLength(2)
        const origin = lod.getWorldPosition(new Vector3())
        // Sample both actual mesh extents, not a guessed silhouette or a fixed successful ray.
        const extents = lod.levels.map((level) => new Box3().setFromObject(level.object))
        const camera = new PerspectiveCamera(50, 1, 0.1, 100)
        const raycaster = new Raycaster()
        raycaster.camera = camera
        for (const view of ['top', 'side'] as const) {
          const direction =
            view === 'top' ? new Vector3(0, 1, 0) : new Vector3(0, 0.12, 1).normalize()
          camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
          for (const [distance, zoom, expectedLevel] of [
            [4.8, 1, 0],
            [15, 1, 1],
            [15, 4, 0],
          ] as const) {
            camera.position.copy(origin).addScaledVector(direction, distance)
            camera.zoom = zoom
            camera.lookAt(origin)
            camera.updateProjectionMatrix()
            camera.updateMatrixWorld(true)
            lod.update(camera)
            group.updateMatrixWorld(true)
            expect(lod.getCurrentLevel()).toBe(expectedLevel)
            const displayed: Mesh[] = []
            group.traverseVisible((object) => {
              if (object instanceof Mesh) displayed.push(object)
            })
            expect(displayed).toHaveLength(1)
            const visible = displayed[0]!
            for (const bounds of extents) {
              let hitsInExtent = 0
              for (const u of [0.25, 0.5, 0.75]) {
                for (const v of [0.25, 0.5, 0.75]) {
                  const target = bounds.getCenter(new Vector3())
                  target.x = bounds.min.x + u * (bounds.max.x - bounds.min.x)
                  if (view === 'top') target.z = bounds.min.z + v * (bounds.max.z - bounds.min.z)
                  else target.y = bounds.min.y + v * (bounds.max.y - bounds.min.y)
                  raycaster.set(camera.position, target.sub(camera.position).normalize())
                  const expected = raycaster.intersectObject(visible, false)
                  // Traverse the whole real tree: Three must honor the raycast false barrier,
                  // rather than also visiting hidden children or duplicating visible hits.
                  const actual = raycaster.intersectObject(group, true)
                  expect(actual.map((hit) => hit.distance)).toEqual(
                    expected.map((hit) => hit.distance),
                  )
                  for (const hit of actual) expect(hit.object).toBe(visible)
                  hitsInExtent += actual.length
                }
              }
              expect(hitsInExtent).toBeGreaterThan(0)
            }
          }
        }
      } finally {
        disposeGeometry(group)
      }
    })
  }
})

// Plane intersections are derived from the actual rendered triangles, never rockSection or the
// production ring helper. Grid occupancy compares sets rather than triangulation/vertex order.
describe('generation 2 floor cuts agree with the visible near mesh', () => {
  for (const polygon of [rectangle, concave]) {
    for (const rockType of types) {
      test(`${rockType}, ${polygon === concave ? 'concave' : 'convex'} footprint`, () => {
        // Match the analytical mesh span below without changing its source oracle.
        const site = SiteNode.parse({ terrain: encodeTerrainField(createTerrainField()) })
        const building = BuildingNode.parse({ parentId: site.id })
        const level = LevelNode.parse({ parentId: building.id, level: 0 })
        const rock = node({ parentId: site.id, polygon, rockType })
        const mesh = buildRockMesh(rock, -0.3, 2.4)
        try {
          const positions = mesh.getAttribute('position').array
          const slack = float32Slack(positions)
          // Existing polygon booleans round each plan coordinate to the nearest 0.1 mm.
          // Its worst Euclidean displacement is half a grid diagonal, not a Float32 ULP.
          const booleanSlack = Math.SQRT2 * 0.00005 + slack
          for (const elevation of [0.213, 0.917, 1.831, 2.6, -0.5]) {
            const slab = SlabNode.parse({
              parentId: level.id,
              polygon: [
                [-5, -5],
                [5, -5],
                [5, 5],
                [-5, 5],
              ],
              elevation,
            })
            const nodes = {
              [site.id]: site,
              [building.id]: building,
              [level.id]: level,
              [rock.id]: rock,
              [slab.id]: slab,
            }
            const holes = rockSlabHoles(slab, nodes)
            const segments = planeSegments(positions, mesh.index?.array ?? null, elevation)
            const sections = rockSections(rock, (elevation + 0.3) / 2.7, { footY: -0.3, topY: 2.4 })
            if (elevation > 2.4 || elevation < -0.3) {
              expect(holes).toEqual([])
              expect(segments).toEqual([])
              expect(sections).toEqual([])
              continue
            }
            expect(holes.length).toBeGreaterThan(0)
            expect(segments.length).toBeGreaterThan(0)
            const boundaries = holes.flatMap(edges)
            const rawBoundaries = sections.flatMap(edges)
            expect(rawBoundaries.length).toBeGreaterThan(0)
            // Before the pre-existing slab boolean grid, the generator's section must agree
            // with the rendered mesh to Float32 precision in both directions.
            for (const [from, to] of [
              [rawBoundaries, segments],
              [segments, rawBoundaries],
            ]) {
              for (const boundary of from!)
                for (const t of [0, 0.5, 1]) {
                  const point: Point = [
                    boundary[0][0] + t * (boundary[1][0] - boundary[0][0]),
                    boundary[0][1] + t * (boundary[1][1] - boundary[0][1]),
                  ]
                  expect(
                    Math.min(...to!.map((segment) => segmentDistance(point, segment))),
                  ).toBeLessThanOrEqual(slack)
                }
            }
            let checkedInside = 0
            let checkedOutside = 0
            for (let ix = 0; ix < 47; ix++)
              for (let iz = 0; iz < 39; iz++) {
                const point: Point = [-3.5 + ((ix + 0.37) * 7) / 47, -2.5 + ((iz + 0.61) * 5) / 39]
                if (
                  [...segments, ...boundaries].some(
                    (edge) => segmentDistance(point, edge) <= booleanSlack,
                  )
                )
                  continue
                const inMesh = insideSegments(point, segments)
                expect(holes.some((hole) => insidePolygon(point, hole))).toBe(inMesh)
                if (inMesh) checkedInside++
                else checkedOutside++
              }
            expect(checkedInside).toBeGreaterThan(0)
            expect(checkedOutside).toBeGreaterThan(0)
            // Cut boundaries cannot wander away from the mesh even between grid sample points.
            for (const boundary of boundaries)
              for (const t of [0, 0.5, 1]) {
                const point: Point = [
                  boundary[0][0] + t * (boundary[1][0] - boundary[0][0]),
                  boundary[0][1] + t * (boundary[1][1] - boundary[0][1]),
                ]
                expect(
                  Math.min(...segments.map((segment) => segmentDistance(point, segment))),
                ).toBeLessThanOrEqual(booleanSlack)
              }
          }
        } finally {
          mesh.dispose()
        }
      })
    }
  }
})
