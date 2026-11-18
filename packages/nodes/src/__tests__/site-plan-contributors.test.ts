import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  buildFloorplanContext,
  type FloorplanGeometry,
  HedgeNode,
  LawnNode,
  loadPlugin,
  nodeRegistry,
  PlantingNode,
  type SceneSnapshot,
  SiteNode,
} from '@pascal-app/core'
import { buildSitePlanDrawing, registerSitePlanContributor } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { renderPlugin } from '@pascal-app/nodes/render'

const contributorKey = 'acceptance:legacy-site-plan'
let restore = () => {}
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => {
  registerSitePlanContributor(contributorKey, null)
  restore()
})

const site = SiteNode.parse({ id: 'site_contributions', children: ['hedge_legacy'] })
const hedge = HedgeNode.parse({
  id: 'hedge_legacy',
  parentId: site.id,
  path: [
    [0, 0],
    [4, 0],
  ],
})
const snapshot: SceneSnapshot = {
  nodes: { [site.id]: site, [hedge.id]: hedge },
  rootNodeIds: [site.id],
  collections: {},
  materials: {},
}

test('a legacy Site-scoped plugin keeps its custom contribution without duplicate automatic geometry', async () => {
  const marker: FloorplanGeometry = {
    kind: 'line',
    x1: 1,
    y1: 2,
    x2: 3,
    y2: 4,
    stroke: '#123456',
    metadata: { acceptance: contributorKey },
  }
  let automaticCalls = 0
  let customCalls = 0
  await loadPlugin({
    id: 'acceptance:legacy-garden',
    apiVersion: 1,
    nodes: [
      {
        kind: 'hedge',
        schemaVersion: 1,
        schema: HedgeNode,
        category: 'site',
        defaults: () => hedge,
        capabilities: {},
        floorplanScope: 'site',
        // Intentionally no sitePlan opt-in, as on a pre-existing plugin.
        floorplan: () => {
          automaticCalls++
          return marker
        },
      },
    ],
  })
  const markers = () =>
    buildSitePlanDrawing(snapshot).primitives.filter(
      (primitive) => primitive.metadata?.acceptance === contributorKey,
    )

  expect(markers()).toEqual([])
  expect(automaticCalls).toBe(0)
  registerSitePlanContributor(contributorKey, () => {
    customCalls++
    return { primitives: [marker] }
  })
  expect(markers()).toEqual([marker])
  expect(customCalls).toBe(1)
  expect(automaticCalls).toBe(0)
})

test.each([
  ['editor', builtinPlugin],
  ['render', renderPlugin],
] as const)(
  '%s garden definitions explicitly contribute once to the public Site drawing',
  async (_name, plugin) => {
    await loadPlugin(plugin)
    const planting = PlantingNode.parse({
      id: 'planting_contributions',
      parentId: site.id,
      area: 12,
      seed: 19,
    })
    const lawn = LawnNode.parse({
      id: 'lawn_contributions',
      parentId: site.id,
      outline: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    })
    const scene: SceneSnapshot = {
      ...snapshot,
      nodes: {
        ...snapshot.nodes,
        [site.id]: { ...site, children: [hedge.id, planting.id, lawn.id] },
        [planting.id]: planting,
        [lawn.id]: lawn,
      },
    }
    const drawing = buildSitePlanDrawing(scene)
    for (const node of [hedge, planting, lawn]) {
      const definition = nodeRegistry.get(node.type)!
      expect(definition.sitePlan).toBe(true)
      const expected = definition.floorplan!(
        node,
        buildFloorplanContext(node, scene.nodes, {
          selected: false,
          highlighted: false,
          hovered: false,
          moving: false,
          unit: 'metric',
          palette: undefined,
          purpose: 'document',
        }),
      )
      expect(expected).not.toBeNull()
      expect(
        drawing.primitives.filter(
          (primitive) => JSON.stringify(primitive) === JSON.stringify(expected),
        ),
      ).toHaveLength(1)
    }
  },
)
