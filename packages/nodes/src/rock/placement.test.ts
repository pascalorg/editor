import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  LevelNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { rockDefinition } from './definition'
import { placeRock, planPointToSite } from './placement'

describe('placing a rock from a drawing', () => {
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  let original: ReturnType<typeof useScene.getState>

  const site = SiteNode.parse({
    polygon: {
      type: 'polygon',
      points: [
        [-30, -30],
        [30, -30],
        [30, 30],
        [-30, 30],
      ],
    },
  })
  const building = BuildingNode.parse({ parentId: site.id, position: [10, 0, 5] })
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const nodes: Record<string, AnyNode> = {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: level,
  }

  beforeEach(() => {
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    original = useScene.getState()
    useScene.setState({ nodes, rootNodeIds: [site.id] } as never)
    clearSceneHistory()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
    useScene.setState(original)
    clearSceneHistory()
  })

  const rocks = () => Object.values(useScene.getState().nodes).filter((n) => n.type === 'rock')
  const centreOf = (points: [number, number][]) => [
    points.reduce((sum, [x]) => sum + x, 0) / points.length,
    points.reduce((sum, [, z]) => sum + z, 0) / points.length,
  ]

  test('a click on a floor plan lands in the Site where the building stands', () => {
    const at = planPointToSite([2, 3], {
      nodes: useScene.getState().nodes,
      activeLevelId: level.id,
      drawingType: 'floor-plan',
    })

    expect(at).toEqual([12, 8])
  })

  test('a click on a site plan is already in the Site', () => {
    const at = planPointToSite([2, 3], {
      nodes: useScene.getState().nodes,
      activeLevelId: level.id,
      drawingType: 'site-plan',
    })

    expect(at).toEqual([2, 3])
  })

  test('creates one rock there and selects it', () => {
    const selected: string[] = []

    const id = placeRock(createSceneApi(useScene), [12, 8], (rockId) => selected.push(rockId))

    expect(rocks()).toHaveLength(1)
    expect(selected).toEqual([id as AnyNodeId])
    const [rock] = rocks()
    const centre = centreOf((rock as { polygon: [number, number][] }).polygon)
    expect(centre[0]).toBeCloseTo(12, 0)
    expect(centre[1]).toBeCloseTo(8, 0)
  })

  test('places nothing, and does not throw, where the scene has no Site', () => {
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)

    const id = placeRock(createSceneApi(useScene), [0, 0], () => {
      throw new Error('nothing to select')
    })

    expect(id).toBeNull()
  })

  test('the plan has its own tool, as the 3D view has', async () => {
    const extension = rockDefinition.extensions?.['pascal:editor/floorplan'] as
      | { tool?: () => Promise<{ default: unknown }> }
      | undefined

    const module = await extension?.tool?.()

    expect(typeof module?.default).toBe('function')
  })
})
