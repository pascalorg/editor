import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
} from '@pascal-app/core'
import { applySceneChanges, setSiteLot } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { type AnyNode, SiteNode } from '@pascal-app/core/schema'

const context = { activeLevelId: null }
type Nodes = Record<string, AnyNode>

function slopedScene(): Nodes {
  // Deliberately not aligned with the tile lattice: resizing must not resample.
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16.2, -16.2] })
  for (let row = 0; row < 33; row++)
    for (let col = 0; col < 33; col++) field.heights[row * 33 + col] = 1200 - col * 25
  const site = SiteNode.parse({
    id: 'site_lot',
    terrain: encodeTerrainField(field),
    frontEdge: 1,
    polygon: {
      type: 'polygon',
      points: [
        [-15, -15],
        [15, -15],
        [15, 15],
        [-15, 15],
      ],
    },
  })
  return { [site.id]: site }
}

function assertEnlargement(nodes: Nodes) {
  const site = Object.values(nodes).find((node): node is SiteNode => node.type === 'site')
  if (!site) throw new Error('Fixture has no site')
  const before = persistedTerrainFieldOf(site, nodes)
  if (!before) throw new Error('Fixture has no legacy terrain')
  const frozen = JSON.stringify(site.terrain)
  const snapshot = structuredClone(nodes)
  const outcome = setSiteLot(nodes, { widthM: 60, depthM: 80 }, context)
  const afterNodes = applySceneChanges(nodes, outcome.changes)
  const afterSite = afterNodes[site.id] as SiteNode
  const after = persistedTerrainFieldOf(afterSite, afterNodes)
  if (!after) throw new Error('Enlargement lost terrain')
  expect(outcome.result.areaM2).toBe(4800)
  expect(outcome.result.polygon).toEqual(afterSite.polygon.points)
  expect(JSON.stringify(afterSite.terrain)).toBe(frozen)
  expect(afterSite.frontEdge).toBe(site.frontEdge)
  for (const [id, node] of Object.entries(nodes))
    if (id !== site.id) expect(afterNodes[id]).toEqual(node)
  for (let row = 0; row < before.rows; row++)
    for (let col = 0; col < before.cols; col++) {
      const x = before.origin[0] + col * before.spacing
      const z = before.origin[1] + row * before.spacing
      expect(heightAt(after, x, z)).toBe(heightAt(before, x, z))
      if (row + 1 < before.rows && col + 1 < before.cols)
        expect(heightAt(after, x + before.spacing / 3, z + before.spacing / 4)).toBe(
          heightAt(before, x + before.spacing / 3, z + before.spacing / 4),
        )
    }
  // Continuation already exists before the polygon changes; enlargement exposes it.
  for (const [x, z] of afterSite.polygon.points)
    expect(heightAt(after, x, z)).toBe(heightAt(before, x, z))
  expect(nodes).toEqual(snapshot)
  return { after, outcome }
}

describe('set_site_lot', () => {
  test('30 × 30 becomes 60 × 80 without resampling the legacy ground or losing its fall', () => {
    const { after, outcome } = assertEnlargement(slopedScene())
    expect(outcome.result.polygon).toEqual([
      [-30, -40],
      [30, -40],
      [30, 40],
      [-30, 40],
    ])
    expect(heightAt(after, 16.8, 0)).toBeLessThan(heightAt(after, 15.8, 0))
    expect(heightAt(after, 16.8, 0)).toBeGreaterThan(0)
    expect(outcome.result.sampling).toMatchObject({ approximate: true })
  })

  test('a polygon on flat ground returns independently known area and height range', () => {
    const site = SiteNode.parse({ id: 'site_flat' })
    const polygon: [number, number][] = [
      [2, 3],
      [8, 3],
      [8, 7],
      [2, 7],
    ]
    const outcome = setSiteLot({ [site.id]: site }, { polygon }, context)
    expect(outcome.result).toMatchObject({ siteId: site.id, polygon, areaM2: 24, minM: 0, maxM: 0 })
    expect(
      (applySceneChanges({ [site.id]: site }, outcome.changes)[site.id] as SiteNode).terrain,
    ).toBeUndefined()
  })

  test('an explicit rectangle anchor is its centre', () => {
    const outcome = setSiteLot(slopedScene(), { widthM: 10, depthM: 20, anchor: [7, -3] }, context)
    expect(outcome.result.polygon).toEqual([
      [2, -13],
      [12, -13],
      [12, 7],
      [2, 7],
    ])
    expect(outcome.result.areaM2).toBe(200)
  })

  test('invalid lot requests refuse atomically', () => {
    const nodes = slopedScene()
    const before = structuredClone(nodes)
    for (const input of [
      { widthM: 0, depthM: 80 },
      { widthM: 60 },
      {
        polygon: [
          [0, 0],
          [1, 0],
        ],
        widthM: 60,
        depthM: 80,
      },
    ]) {
      let code: string | undefined
      try {
        setSiteLot(nodes, input as never, context)
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        code = error.code
      }
      expect(code).toBe('invalid_input')
      expect(nodes).toEqual(before)
    }
  })
})

test('enlarging a cut lot with zero padding exposes falling ground without rewriting the padding', () => {
  const legacy = createTerrainField({ cols: 65, rows: 65, spacing: 0.5, origin: [-16, -16] })
  // Reduced owner-scene geometry: south lot samples at z=14..15 lie at -7.8 m;
  // the two frozen padding rows at z=15.5 and z=16 remain at zero.
  for (let row = 60; row <= 62; row++)
    for (let col = 2; col <= 62; col++) legacy.heights[row * 65 + col] = -780
  const site = SiteNode.parse({
    id: 'site_cut_lot',
    terrain: encodeTerrainField(legacy),
    polygon: {
      type: 'polygon',
      points: [
        [-15, -15],
        [15, -15],
        [15, 15],
        [-15, 15],
      ],
    },
  })
  const { after } = assertEnlargement({ [site.id]: site })
  // The frozen padding is at zero despite a -7.8 m cut inside the lot.
  // A datum-only continuation would pass preservation but fail to expose the fall.
  expect(heightAt(after, 0, 15)).toBeCloseTo(-7.8, 6)
  expect(heightAt(after, 0, 15.5)).toBe(0)
  expect(heightAt(after, 0, 16)).toBe(0)
  expect(heightAt(after, 0, 20)).toBeLessThan(0)
  expect(heightAt(after, 0, 30)).toBeLessThan(heightAt(after, 0, 20))
  expect(heightAt(after, 0, 80)).toBeCloseTo(-7.8, 6)
})
