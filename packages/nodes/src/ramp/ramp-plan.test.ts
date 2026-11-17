import { describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  createTerrainField,
  encodeTerrainField,
  type FloorplanGeometry,
  heightAt,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  persistedTerrainFieldOf,
  RampNode,
  type SceneSnapshot,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { buildSitePlanDrawing } from '@pascal-app/editor'
import {
  builtinPlugin,
  commitRampCreation,
  commitRampEdit,
  rampFloorplanFrame,
  rampPlanToSite,
  rampSiteToPlan,
} from '@pascal-app/nodes'

type Point = [number, number]

function polygonPoints(
  geometry: FloorplanGeometry,
  toWorld: (point: Point) => Point = (point) => point,
): Point[][] {
  if (geometry.kind === 'polygon') return [geometry.points.map(toWorld)]
  if (geometry.kind !== 'group') return []
  const { translate = [0, 0], rotate = 0 } = geometry.transform ?? {}
  const transform = ([x, z]: Point): Point =>
    toWorld([
      x * Math.cos(rotate) - z * Math.sin(rotate) + translate[0],
      x * Math.sin(rotate) + z * Math.cos(rotate) + translate[1],
    ])
  return geometry.children.flatMap((child) => polygonPoints(child, transform))
}

function hasRampOutline(primitives: FloorplanGeometry[]): boolean {
  return primitives
    .flatMap((primitive) => polygonPoints(primitive))
    .some((points) => {
      const xs = points.map(([x]) => x)
      const zs = points.map(([, z]) => z)
      return (
        Math.abs(Math.min(...xs)) < 1e-8 &&
        Math.abs(Math.max(...xs) - 10) < 1e-8 &&
        Math.abs(Math.min(...zs) + 2) < 1e-8 &&
        Math.abs(Math.max(...zs) - 2) < 1e-8
      )
    })
}

describe('ramp plan coordinate frames', () => {
  const building = BuildingNode.parse({
    id: 'building_plan',
    position: [10, 0, 20],
    rotation: [0, Math.PI / 2, 0],
  })

  test('Site-plan clicks remain in Site metres despite the active building transform', () => {
    const frame = rampFloorplanFrame(building, 'level_plan', 'site-plan')
    for (const point of [
      [0, 0],
      [10, 0],
      [2, 3],
    ] satisfies Point[]) {
      expect(rampPlanToSite(frame.building, point)).toEqual(point)
      expect(rampSiteToPlan(frame.building, point)).toEqual(point)
    }
    expect(frame.activeLevelId).toBeNull()
  })

  test('ordinary floor-plan clicks still convert from the active building frame', () => {
    const frame = rampFloorplanFrame(building, 'level_plan', 'floor-plan')
    const sitePoint = rampPlanToSite(frame.building, [2, 3])
    expect(sitePoint[0]).toBeCloseTo(13, 8)
    expect(sitePoint[1]).toBeCloseTo(18, 8)
    const planPoint = rampSiteToPlan(frame.building, [13, 18])
    expect(planPoint[0]).toBeCloseTo(2, 8)
    expect(planPoint[1]).toBeCloseTo(3, 8)
    expect(frame.activeLevelId).toBe('level_plan')
  })

  test('a committed built-in ramp appears in the Site drawing without building translation or rotation', async () => {
    const restore = nodeRegistry._snapshot()
    try {
      nodeRegistry._reset()
      await loadPlugin(builtinPlugin)
      const site = SiteNode.parse({
        id: 'site_plan',
        children: [building.id, 'ramp_plan'],
        polygon: {
          type: 'polygon',
          points: [
            [-20, -20],
            [40, -20],
            [40, 40],
            [-20, 40],
          ],
        },
      })
      const host = BuildingNode.parse({ ...building, parentId: site.id, children: ['level_plan'] })
      const level = LevelNode.parse({ id: 'level_plan', parentId: host.id, level: 0, height: 3 })
      const ramp = RampNode.parse({
        id: 'ramp_plan',
        parentId: site.id,
        start: [0, 0],
        segments: [{ type: 'line', end: [10, 0] }],
        width: 4,
        startHeight: 0,
        endHeight: 1,
        terrainMode: 'none',
      })
      const scene: SceneSnapshot = {
        nodes: Object.fromEntries([site, host, level, ramp].map((node) => [node.id, node])),
        rootNodeIds: [site.id],
        collections: {},
        materials: {},
        installedPlugins: [],
      }
      expect(hasRampOutline(buildSitePlanDrawing(scene).primitives)).toBe(true)
      const hidden = {
        ...scene,
        nodes: { ...scene.nodes, [ramp.id]: { ...ramp, visible: false } },
      }
      expect(hasRampOutline(buildSitePlanDrawing(hidden).primitives)).toBe(false)
    } finally {
      restore()
    }
  })
})

test('the inspector reroutes its owned ground in one undo step', () => {
  const original = useScene.getState()
  try {
    const site = SiteNode.parse({
      id: 'site_inspector',
      terrain: encodeTerrainField(
        createTerrainField({ origin: [-2, -3], cols: 29, rows: 25, spacing: 0.5 }),
      ),
    })
    useScene.getState().setScene({ [site.id]: site }, [site.id])
    const api = createSceneApi(useScene)
    const ramp = RampNode.parse({
      parentId: site.id,
      start: [0, 0],
      segments: [{ type: 'line', end: [10, 0] }],
      width: 3,
      startHeight: 0,
      endHeight: -2,
      thickness: 0.15,
      terrainMode: 'cut-fill',
    })
    commitRampCreation(api, ramp)
    useScene.temporal.getState().clear()
    const before = structuredClone(useScene.getState().nodes)
    const beforeField = persistedTerrainFieldOf(site, before)
    if (!beforeField) throw new Error('Missing initial ramp grading')
    expect(heightAt(beforeField, 5, 0)).toBeCloseTo(-1.15, 8)
    expect(heightAt(beforeField, 5, 5)).toBeCloseTo(0, 8)
    commitRampEdit(api, ramp.id, {
      start: [0, 5],
      segments: [{ type: 'line', end: [10, 5] }],
    })
    const after = useScene.getState().nodes
    const ground = after[site.id]
    if (ground?.type !== 'site') throw new Error('The Site was removed')
    const field = persistedTerrainFieldOf(ground, after)
    if (!field) throw new Error('Missing terrain')
    expect(heightAt(field, 5, 0)).toBeCloseTo(0, 8)
    expect(heightAt(field, 5, 5)).toBeCloseTo(-1.15, 8)
    expect(ground.terrain).toEqual(site.terrain)
    const moved = structuredClone(after)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(moved)
  } finally {
    useScene.setState(original)
    useScene.temporal.getState().clear()
  }
})
