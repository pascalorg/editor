import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createSceneApi,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  terrainBreakFacts,
  useScene,
} from '@pascal-app/core'
import { type AnyNodeId, SiteNode } from '@pascal-app/core/schema'
import {
  buildTerrainBreakMesh,
  commitTerrainBreakCreation,
  commitTerrainBreakEdit,
} from '@pascal-app/nodes'

const ground = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
const input = {
  line: [
    [4, 0],
    [4, 8],
  ] as [number, number][],
  kind: 'cliff' as const,
  left: 5,
  right: 2,
}
let previous: ReturnType<typeof useScene.getState>
let previousRaf: typeof requestAnimationFrame
let previousCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  previous = useScene.getState()
  previousRaf = globalThis.requestAnimationFrame
  previousCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({
    id: 'site_ui',
    terrain: encodeTerrainField(ground),
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
    },
  })
  useScene.setState({
    nodes: { [site.id]: site },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
})

afterEach(() => {
  useScene.setState(previous)
  clearSceneHistory()
  globalThis.requestAnimationFrame = previousRaf
  globalThis.cancelAnimationFrame = previousCancelRaf
})

function authored(id: AnyNodeId) {
  const nodes = useScene.getState().nodes
  const edge = nodes[id]
  const site = nodes.site_ui
  if (!edge || edge.type !== 'terrain-break' || !site || site.type !== 'site')
    throw new Error('Expected the committed terrain break and site')
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) throw new Error('Expected committed terrain authority')
  return { edge, field }
}

function faceHeights(id: AnyNodeId) {
  const { edge, field } = authored(id)
  const mesh = buildTerrainBreakMesh(edge, field, [ground])
  expect(mesh.indices.length).toBeGreaterThan(0)
  const heights = new Set<number>()
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const height = mesh.positions[i]
    if (height === undefined) throw new Error('Expected face vertex height')
    heights.add(height)
  }
  return [...heights].sort((a, b) => a - b)
}

describe('terrain-break UI commit path', () => {
  test('creation updates authoritative geometry and is undone as one scene gesture', () => {
    const before = JSON.stringify(useScene.getState().nodes)
    const id = commitTerrainBreakCreation(createSceneApi(useScene), input)
    const { edge, field } = authored(id)
    expect(heightAt(field, 3, 3)).toBe(5)
    expect(heightAt(field, 5, 3)).toBe(2)
    expect(terrainBreakFacts(edge, field)).toMatchObject({ lengthM: 8, faceAreaM2: 24 })
    expect(faceHeights(id)).toEqual([2, 5])
    const created = JSON.stringify(useScene.getState().nodes)
    useScene.temporal.getState().undo()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(before)
    useScene.temporal.getState().redo()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(created)
  })

  test('an edited height changes faces and measured facts in one undo step', () => {
    const sceneApi = createSceneApi(useScene)
    const id = commitTerrainBreakCreation(sceneApi, input)
    const before = JSON.stringify(useScene.getState().nodes)
    clearSceneHistory()
    const { edge } = authored(id)
    commitTerrainBreakEdit(sceneApi, edge.id, { left: 7 })
    const changed = authored(id)
    expect(heightAt(changed.field, 3, 3)).toBe(7)
    expect(terrainBreakFacts(changed.edge, changed.field)).toMatchObject({
      left: { minM: 7, maxM: 7 },
      dropMinM: 5,
      dropMaxM: 5,
      faceAreaM2: 40,
    })
    expect(faceHeights(id)).toEqual([2, 7])
    useScene.temporal.getState().undo()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(before)
    expect(faceHeights(id)).toEqual([2, 5])
  })

  test('collapsed and crossing edits do not change the scene or create undo entries', () => {
    const sceneApi = createSceneApi(useScene)
    const cliffId = commitTerrainBreakCreation(sceneApi, input)
    const padId = commitTerrainBreakCreation(sceneApi, {
      line: [
        [1, 2],
        [3, 2],
        [3, 6],
        [1, 6],
        [1, 2],
      ],
      kind: 'retaining',
      left: 7,
      right: 'ground',
    })
    clearSceneHistory()
    const before = JSON.stringify(useScene.getState().nodes)
    const cliff = authored(cliffId).edge
    const pad = authored(padId).edge
    expect(() =>
      commitTerrainBreakEdit(sceneApi, cliff.id, {
        line: [
          [4, 0],
          [4, 0],
        ],
      }),
    ).toThrow()
    expect(() =>
      commitTerrainBreakEdit(sceneApi, pad.id, {
        line: [
          [3, 2],
          [5, 2],
          [5, 6],
          [3, 6],
          [3, 2],
        ],
      }),
    ).toThrow()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
})
