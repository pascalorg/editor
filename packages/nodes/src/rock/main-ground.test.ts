import { describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  RockNode,
  rockFacts,
  rockHolesIn,
  rockSlabHoles,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { Box3, Mesh } from 'three'
import {
  edges,
  float32Slack,
  insidePolygon,
  insideSegments,
  planeSegments,
  segmentDistance,
} from './__tests__/geometry-oracles'
import { buildRockGeometry } from './geometry'

const polygon: [number, number][] = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]

// Analytical world datums from the approved main contract, not generator output:
// absent terrain = -0.05; persisted +2m grid = 2. A rock embeds 0.3m below
// ground and rises height above it. An intersecting slab is cut, not climbed.
describe('rocks on the real main Site ground', () => {
  for (const gen of [1, 2] as const) {
    for (const ground of [-0.05, 2]) {
      test(`gen ${gen}, ground ${ground}: facts, rendered mesh and slab cut share world heights`, () => {
        const field = createTerrainField({ origin: [-4, -4], cols: 9, rows: 9, spacing: 1 })
        field.heights.fill(200)
        const site = SiteNode.parse({
          ...(ground === 2 ? { terrain: encodeTerrainField(field) } : {}),
        })
        const building = BuildingNode.parse({ parentId: site.id })
        const level = LevelNode.parse({ parentId: building.id, level: 0 })
        const slab = SlabNode.parse({
          parentId: level.id,
          polygon: polygon.map(([x, z]) => [x * 2, z * 2]),
          elevation: ground + 1,
        })
        const rock = RockNode.parse({ parentId: site.id, polygon, gen, height: 2.4, seed: 17 })
        const nodes = {
          [site.id]: { ...site, children: [building.id, rock.id] },
          [building.id]: { ...building, children: [level.id] },
          [level.id]: { ...level, children: [slab.id] },
          [slab.id]: slab,
          [rock.id]: rock,
        }
        const before = JSON.stringify(nodes)
        const facts = rockFacts(rock, nodes)
        expect(facts.groundM.lowest).toBeCloseTo(ground, 8)
        expect(facts.groundM.highest).toBeCloseTo(ground, 8)
        expect(facts.footElevationM).toBeCloseTo(ground - 0.3, 8)
        expect(facts.topElevationM).toBeCloseTo(ground + 2.4, 8)
        expect(facts.throughSlabs).toEqual([expect.objectContaining({ slabId: slab.id })])
        const group = buildRockGeometry(rock, {
          parent: nodes[site.id],
          sceneNodes: nodes,
          resolve: (id) => nodes[id],
        })
        try {
          group.updateMatrixWorld(true)
          const bounds = new Box3().setFromObject(group)
          expect(bounds.min.y).toBeCloseTo(ground - 0.3, 5)
          expect(bounds.max.y).toBeCloseTo(ground + 2.4, 5)
          const visible: Mesh[] = []
          group.traverseVisible((object) => {
            if (object instanceof Mesh) visible.push(object)
          })
          expect(visible).toHaveLength(1)
          const mesh = visible[0]!
          const worldGeometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
          try {
            const positions = worldGeometry.getAttribute('position').array
            const segments = planeSegments(
              positions,
              worldGeometry.index?.array ?? null,
              slab.elevation,
            )
            const holes = rockSlabHoles(slab, nodes)
            expect(segments.length).toBeGreaterThan(0)
            expect(holes.length).toBeGreaterThan(0)
            const boundaries = [...segments, ...holes.flatMap(edges)]
            const slack = float32Slack(positions) + Math.SQRT2 * 0.00005
            let inside = 0
            let outside = 0
            for (let x = -2.73; x < 3; x += 0.19) {
              for (let z = -2.81; z < 3; z += 0.23) {
                const point: [number, number] = [x, z]
                if (boundaries.some((edge) => segmentDistance(point, edge) <= slack)) continue
                const inMesh = insideSegments(point, segments)
                expect(holes.some((hole) => insidePolygon(point, hole))).toBe(inMesh)
                if (inMesh) inside++
                else outside++
              }
            }
            expect(inside).toBeGreaterThan(0)
            expect(outside).toBeGreaterThan(0)
            const otherSite = SiteNode.parse({})
            const elsewhere = {
              ...nodes,
              [otherSite.id]: otherSite,
              [rock.id]: { ...rock, parentId: otherSite.id },
            }
            expect(rockSlabHoles(slab, elsewhere)).toEqual([])
            expect(rockHolesIn(slab, elsewhere[rock.id] as RockNode, elsewhere)).toEqual([])
            expect(JSON.stringify(nodes)).toBe(before)
          } finally {
            worldGeometry.dispose()
          }
        } finally {
          group.traverse((object) => {
            if (object instanceof Mesh) object.geometry.dispose()
          })
        }
      })
    }
  }
})
