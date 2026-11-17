import { describe, expect, test } from 'bun:test'
import { clearSceneHistory, heightAt, persistedTerrainFieldOf, useScene } from '@pascal-app/core'
import {
  applySceneChanges,
  carveTerrainPad,
  shapeSiteTerrain,
} from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { type AnyNode, SiteNode } from '@pascal-app/core/schema'
import type { AgentOperationOutcome } from './types'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }

// B1 writes only the touched 0.5 m tiles; an untouched lot has no terrain payload.
function lot(width: number, depth: number): Nodes {
  const site = SiteNode.parse({
    id: 'site_flat',
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [width, 0],
        [width, depth],
        [0, depth],
      ],
    },
  })
  return { [site.id]: site }
}

const raise = { verb: 'raise', area: { x: 10, z: 5, radiusM: 2 }, heightM: 0.5 } as const
const pad: [number, number][] = [
  [8, 3],
  [12, 3],
  [12, 7],
  [8, 7],
]

const applied = (nodes: Nodes, outcome: AgentOperationOutcome): Nodes =>
  outcome.changes ? (applySceneChanges(nodes, outcome.changes) as Nodes) : nodes

function refusalOf(call: () => unknown): { code: string; message: string } | null {
  try {
    call()
  } catch (error) {
    if (isAgentRefusal(error)) return { code: error.code, message: error.message }
    throw error
  }
  return null
}

describe('shaping a site with no shaped ground', () => {
  test('shape_site_terrain starts from flat ground and persists only touched tiles', () => {
    const nodes = lot(20, 10)

    const outcome = shapeSiteTerrain(nodes, raise, context)

    const after = applied(nodes, outcome)
    const field = persistedTerrainFieldOf(after.site_flat as SiteNode, after)
    expect(field?.spacing).toBe(0.5)
    expect((after.site_flat as SiteNode).terrain).toBeUndefined()
    expect(Object.values(after).filter((node) => node.type === 'terrain-tile')).toHaveLength(1)
    expect(heightAt(field as never, 10, 5)).toBe(0.5)
    expect(outcome.result).toMatchObject({
      beforeMinMaxM: { minM: 0, maxM: 0 },
      afterMinMaxM: { minM: 0.5, maxM: 0.5 },
    })
    expect(outcome.result.changedSamples).toBeGreaterThan(0)
  })

  test('carve_terrain_pad levels a pad on it', () => {
    const outcome = carveTerrainPad(lot(20, 10), { pad, padHeightM: 0.5 }, context)

    expect(outcome.result.cutVolumeM3).toBe(0)
    expect(outcome.result.fillVolumeM3).toBeGreaterThan(0)
    expect(outcome.result.padHeightM).toBeCloseTo(0.5, 6)
  })

  test('tile creation and the shape are one undo step', () => {
    const original = useScene.getState()
    try {
      const before = lot(20, 10)
      useScene.setState({ nodes: before, rootNodeIds: ['site_flat'] } as never)
      clearSceneHistory()
      const outcome = shapeSiteTerrain(before, raise, context)
      useScene.setState({ nodes: applied(before, outcome) } as never)
      expect(
        Object.values(useScene.getState().nodes).some((node) => node.type === 'terrain-tile'),
      ).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      const restored = useScene.getState().nodes as Nodes
      expect((restored.site_flat as SiteNode).terrain).toBeUndefined()
      expect(restored).toEqual(before)
    } finally {
      useScene.setState(original)
      clearSceneHistory()
    }
  })

  test('a shape that moves nothing writes no field', () => {
    const outcome = refusalOf(() =>
      shapeSiteTerrain(lot(20, 10), { verb: 'flatten', area: raise.area, heightM: 0 }, context),
    )

    expect(outcome?.code).toBe('no_change')
  })
})

describe('the size of one terrain write', () => {
  // The former 62 m limit came from serializing one monolithic field, not the lot.
  for (const width of [62, 63, 128]) {
    test(`a ${width} m lot supports repeated bounded tile writes`, () => {
      let nodes = lot(width, 80)
      for (const x of [10, 40]) {
        nodes = applied(
          nodes,
          shapeSiteTerrain(nodes, { ...raise, area: { x, z: 5, radiusM: 2 } }, context),
        )
      }
      nodes = applied(nodes, carveTerrainPad(nodes, { pad, padHeightM: 1 }, context))
      const field = persistedTerrainFieldOf(nodes.site_flat as SiteNode, nodes)
      expect(heightAt(field as never, 10, 5)).toBe(1)
      expect(heightAt(field as never, 40, 5)).toBe(0.5)
      expect((nodes.site_flat as SiteNode).terrain).toBeUndefined()
      const tiles = Object.values(nodes).filter((node) => node.type === 'terrain-tile')
      expect(tiles).toHaveLength(2)
      for (const tile of tiles)
        expect(
          new TextEncoder().encode(JSON.stringify({ from: tile, to: tile })).length,
        ).toBeLessThan(64 * 1024)
    })
  }

  test('a small lot is shaped again and again', () => {
    let nodes = lot(20, 10)
    for (const x of [6, 10, 14]) {
      const area = { x, z: 5, radiusM: 2 }
      nodes = applied(nodes, shapeSiteTerrain(nodes, { ...raise, area }, context))
    }

    const field = persistedTerrainFieldOf(nodes.site_flat as SiteNode, nodes)
    for (const x of [6, 10, 14]) expect(heightAt(field as never, x, 5)).toBe(0.5)
  })
})
