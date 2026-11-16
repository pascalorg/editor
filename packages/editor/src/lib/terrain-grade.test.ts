import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  LevelNode,
  persistedTerrainFieldOf,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { gradeSiteAroundHouse } from './terrain-grade'

// `updateNode` batches its dirty-node flush through rAF, which bun's runtime does not provide.
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

/** A lot rising toward −z at 1 m per metre, a house on its lowest slab; `annex` adds a second level with its own slab. */
function hillside(withHouse = true, annex = false): Record<string, AnyNode> {
  const field = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = Math.round(
        Math.max(0, -(-20 + row * 0.5)) / field.step,
      )
  const site = SiteNode.parse({
    id: 'site_g',
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
    children: withHouse ? ['building_g'] : [],
  })
  if (!withHouse) return { [site.id]: site }
  const building = BuildingNode.parse({
    id: 'building_g',
    parentId: site.id,
    children: ['level_g'],
  })
  const level = LevelNode.parse({
    id: 'level_g',
    parentId: building.id,
    level: 0,
    height: 3,
    children: ['slab_g'],
  })
  const slab = SlabNode.parse({
    id: 'slab_g',
    parentId: level.id,
    boundary: 'auto',
    polygon: [
      [-5, 0],
      [5, 0],
      [5, 6],
      [-5, 6],
    ],
    elevation: 0.15,
  })
  const nodes = { [site.id]: site, [building.id]: building, [level.id]: level, [slab.id]: slab }
  if (!annex) return nodes
  const upper = LevelNode.parse({
    id: 'level_u',
    parentId: building.id,
    level: 1,
    height: 3,
    children: ['slab_u'],
  })
  const annexSlab = SlabNode.parse({
    id: 'slab_u',
    parentId: upper.id,
    boundary: 'auto',
    polygon: [
      [8, 0],
      [12, 0],
      [12, 4],
      [8, 4],
    ],
    elevation: 0.15,
  })
  return {
    ...nodes,
    [building.id]: { ...building, children: [level.id, upper.id] },
    [upper.id]: upper,
    [annexSlab.id]: annexSlab,
  } as Record<string, AnyNode>
}

const groundOf = (at: [number, number]) => {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const field = persistedTerrainFieldOf(nodes.site_g as SiteNode, nodes)
  if (!field) throw new Error('expected a persisted field')
  return heightAt(field, at[0], at[1])
}
const wallsNow = () =>
  Object.values(useScene.getState().nodes).filter((node) => node.type === 'terrain-break')

const original = useScene.getState()
afterEach(() => {
  useScene.setState(original)
  clearSceneHistory()
})

describe('gradeSiteAroundHouse', () => {
  test('writes the batter behind the house as one undo step, the way the agent tool does', () => {
    useScene.setState({ nodes: hillside(), rootNodeIds: ['site_g'] } as never)
    clearSceneHistory()
    const outcome = gradeSiteAroundHouse({ run: 2, marginM: 1 })
    expect(outcome).toMatchObject({ ok: true, padHeightM: 0 })
    const nodes = useScene.getState().nodes as Record<string, AnyNode>
    const field = persistedTerrainFieldOf(nodes.site_g as SiteNode, nodes)
    if (!field) throw new Error('expected a persisted field')
    // 1 m behind the wall is the pad edge; 4 m further the ground is 2 m up the 1:2 batter.
    expect(heightAt(field, 0, -1)).toBeCloseTo(0, 1)
    expect(heightAt(field, 0, -5)).toBeCloseTo(2, 1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    const restored = useScene.getState().nodes as Record<string, AnyNode>
    expect(Object.values(restored).some((node) => node.type === 'terrain-tile')).toBe(false)
  })

  test('a built wall is one undo step with the ground, and a second call replaces it in one step', () => {
    useScene.setState({ nodes: hillside(), rootNodeIds: ['site_g'] } as never)
    clearSceneHistory()
    const first = gradeSiteAroundHouse({ run: 2, marginM: 1, wallM: 1, exactWall: true })
    expect(first).toMatchObject({ ok: true })
    const [wall] = wallsNow()
    expect(wallsNow()).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    gradeSiteAroundHouse({ run: 2, marginM: 1, wallM: 0.5, exactWall: true })
    expect(wallsNow()).toHaveLength(1)
    expect(wallsNow()[0]?.id).not.toBe(wall?.id)
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    useScene.temporal.getState().undo()
    expect(wallsNow().map((node) => node.id as string)).toEqual([wall?.id as string])
    useScene.temporal.getState().undo()
    expect(wallsNow()).toHaveLength(0)
  })

  test("a pad per level grades each level's outline at its own floor, in one step", () => {
    useScene.setState({ nodes: hillside(true, true), rootNodeIds: ['site_g'] } as never)
    clearSceneHistory()
    expect(gradeSiteAroundHouse({ run: 2, marginM: 1, padPerLevel: true })).toMatchObject({
      ok: true,
    })
    // The house level's floor is 0.15 under its slab top (0), the annex level's is at its slab top 3.15 less 0.15.
    expect(groundOf([0, 3])).toBeCloseTo(0, 1)
    expect(groundOf([10, 2])).toBeCloseTo(3, 1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('a scene without a house is answered with the refusal, and nothing is written', () => {
    useScene.setState({ nodes: hillside(false), rootNodeIds: ['site_g'] } as never)
    clearSceneHistory()
    const outcome = gradeSiteAroundHouse({ run: 2, marginM: 1 })
    expect(outcome).toMatchObject({ ok: false, code: 'footprint_empty' })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
})
