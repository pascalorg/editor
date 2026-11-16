import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  rampOffsetPoint,
  rampStations,
  storedHeightAt,
  terrainEditField,
  terrainPreviewField,
} from '@pascal-app/core'
import { AGENT_OPERATIONS, applySceneChanges } from '@pascal-app/core/agent-operations'
import { type AnyNode, type RampNode, SiteNode } from '@pascal-app/core/schema'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }
const HALF_WIDTH = 1.5

/** A 40 × 40 m lot on a 6 % cross-fall with a ramp that turns through a quarter circle. */
function hillside(): { before: Nodes; after: Nodes; ramp: RampNode; siteId: string } {
  const field = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) {
      const x = -20 + col * 0.5
      const z = -20 + row * 0.5
      field.heights[row * field.cols + col] = Math.round(
        (0.06 * x + 0.04 * z + 0.15 * Math.sin(x / 3)) * 100,
      )
    }
  const site = SiteNode.parse({
    id: 'site_cut',
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
    terrain: encodeTerrainField(field),
  })
  const before: Nodes = { [site.id]: site }
  const outcome = AGENT_OPERATIONS.add_ramp(
    before,
    {
      siteId: site.id,
      start: [-8, -9],
      segments: [
        { type: 'line', end: [-8, -4] },
        { type: 'arc', center: [-2, -4], sweep: -Math.PI / 2 },
      ],
      width: HALF_WIDTH * 2,
      startHeight: 0,
      endHeight: -1.5,
      thickness: 0.15,
      startTransition: 0,
      endTransition: 0,
      terrainMode: 'cut-fill',
    } as never,
    context,
  )
  const ramp = outcome.changes?.create?.find(({ node }) => node.type === 'ramp')?.node
  if (ramp?.type !== 'ramp') throw new Error('The operation did not create a ramp')
  return { before, after: applySceneChanges(before, outcome.changes), ramp, siteId: site.id }
}

function fieldOf(nodes: Nodes, siteId: string) {
  const site = nodes[siteId]
  const field = site?.type === 'site' ? persistedTerrainFieldOf(site, nodes) : null
  if (!field) throw new Error('Missing terrain')
  return field
}

/** Points beside the corridor's true side lines, `outset` metres outside them. */
function besideTheEdge(ramp: RampNode, outset: number): [number, number][] {
  const points: [number, number][] = []
  for (const station of rampStations(ramp, 0.25))
    for (const side of [-1, 1])
      points.push(rampOffsetPoint(station, side * (ramp.width / 2 + outset)))
  return points
}

describe('the ground beside a graded ramp', () => {
  test('grading really lowers the corridor, so the cut is there to meet', () => {
    const { before, after, ramp, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    const middle = rampStations(ramp, 1).filter((station) => station.distance > 1)
    const moved = middle.filter(
      (station) =>
        Math.abs(heightAt(graded, ...station.point) - heightAt(natural, ...station.point)) > 0.05,
    )
    expect(moved.length).toBeGreaterThan(middle.length / 2)
  })

  test('is the ground before the grading, right up to the corridor edge', () => {
    const { before, after, ramp, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    for (const outset of [0.001, 0.01, 0.1, 0.25, 0.5, 1]) {
      for (const [x, z] of besideTheEdge(ramp, outset)) {
        expect(heightAt(graded, x, z)).toBeCloseTo(heightAt(natural, x, z), 9)
      }
    }
  })

  test('is also the natural ground on the corridor edge itself, where a mesh clips', () => {
    const { before, after, ramp, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    // A clipped rim vertex lies on a chord of the curve, a few millimetres inside the edge.
    for (const inset of [0, 0.002, 0.005, 0.01]) {
      for (const [x, z] of besideTheEdge(ramp, -inset)) {
        expect(heightAt(graded, x, z)).toBeCloseTo(heightAt(natural, x, z), 9)
      }
    }
  })

  test('the corridor itself keeps the graded ground', () => {
    const { before, after, ramp, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    const length = rampStations(ramp, 1).at(-1)?.distance ?? 0
    // The roadway's two ends are cut edges too, with the ground beyond them natural.
    const stations = rampStations(ramp, 1).filter(
      (station) => station.distance > 0.5 && station.distance < length - 0.5,
    )
    for (const station of stations)
      expect(heightAt(graded, ...station.point)).toBeCloseTo(station.height - ramp.thickness, 1)
    // 0.2 m inside the edge is still the graded ground.
    const inside = besideTheEdge(ramp, -0.2).filter((_, index) => index > 8)
    expect(
      inside.some(([x, z]) => Math.abs(heightAt(graded, x, z) - heightAt(natural, x, z)) > 0.02),
    ).toBe(true)
  })

  test('everywhere else is the ground it was', () => {
    const { before, after, ramp, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    const clear = (x: number, z: number) =>
      rampStations(ramp, 0.5).every(
        (station) => Math.hypot(station.point[0] - x, station.point[1] - z) > ramp.width / 2 + 1.2,
      )
    let checked = 0
    for (let x = -19.7; x < 19.7; x += 0.73)
      for (let z = -19.7; z < 19.7; z += 0.61) {
        if (!clear(x, z)) continue
        checked++
        // The two fields read tiles and the legacy grid with differently ordered arithmetic.
        expect(heightAt(graded, x, z)).toBeCloseTo(heightAt(natural, x, z), 12)
      }
    expect(checked).toBeGreaterThan(1000)
  })

  test('a tile write still reads every sample exactly as graded', () => {
    const { after, ramp, siteId } = hillside()
    const graded = fieldOf(after, siteId)
    const effect = ramp.terrainEffect
    if (!effect) throw new Error('The ramp has no receipt')
    expect(effect.samples.length).toBeGreaterThan(20)
    for (const [index, , applied] of effect.samples) {
      const x = effect.origin[0] + (index % effect.cols) * effect.spacing
      const z = effect.origin[1] + Math.floor(index / effect.cols) * effect.spacing
      expect(storedHeightAt(graded, x, z)).toBeCloseTo(applied * effect.step, 9)
    }
  })

  test('the bounds hold every height the ground reads', () => {
    const { before, after, siteId } = hillside()
    const natural = fieldOf(before, siteId)
    const graded = fieldOf(after, siteId)
    const [low, high] = graded.heightBounds ?? [0, 0]
    for (let x = -20; x <= 20; x += 0.5)
      for (let z = -20; z <= 20; z += 0.5)
        for (const field of [graded, natural]) {
          const here = heightAt(field, x, z)
          expect(here).toBeGreaterThanOrEqual(low - 1e-9)
          expect(here).toBeLessThanOrEqual(high + 1e-9)
        }
  })

  test('a scene without a graded ramp is the same field object as before', () => {
    const { before, siteId } = hillside()
    const site = before[siteId]
    if (site?.type !== 'site') throw new Error('Missing site')
    expect(persistedTerrainFieldOf(site, before)).toBe(persistedTerrainFieldOf(site, before))
  })
})

describe('a live stroke on a site with a ramp cut', () => {
  const rect = { minX: 10, minZ: -18, maxX: 16, maxZ: -12 }

  for (const withBreak of [false, true]) {
    test(`keeps the ground beside the ramp natural outside the stroke${withBreak ? ', with a break on the lot' : ''}`, () => {
      const { before, after, ramp, siteId } = hillside()
      let scene = after
      if (withBreak) {
        // A closed break far from the ramp puts the lot on the break authority's preview branch.
        const pad = [
          [12, 8],
          [16, 8],
          [16, 12],
          [12, 12],
        ]
        const outcome = (AGENT_OPERATIONS as never as Record<string, (...args: unknown[]) => never>)
          .carve_terrain_pad as unknown as (
          nodes: Nodes,
          input: unknown,
          context: unknown,
        ) => { changes: Parameters<typeof applySceneChanges>[1] }
        scene = applySceneChanges(
          after,
          outcome(after, { pad, padHeightM: -0.4, edges: 'retaining' }, context).changes,
        )
      }
      const site = scene[siteId]
      if (site?.type !== 'site') throw new Error('Missing site')
      const persisted = persistedTerrainFieldOf(site, scene)
      if (!persisted) throw new Error('Missing terrain')
      const preview = terrainEditField(site, scene, rect)
      const natural = fieldOf(before, siteId)
      const live = terrainPreviewField(preview, persisted)
      for (const outset of [0.001, 0.01, 0.1, 0.5]) {
        for (const [x, z] of besideTheEdge(ramp, outset)) {
          expect(heightAt(live, x, z)).toBeCloseTo(heightAt(natural, x, z), 9)
        }
      }
      // Inside the rectangle the stroke's own samples are read.
      expect(heightAt(live, 13, -15)).toBeCloseTo(heightAt(preview, 13, -15), 9)
    })
  }
})
