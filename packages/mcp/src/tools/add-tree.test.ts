import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  SlabNode,
  TreeNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

const site = SiteNode.parse({ id: 'site_trees' })
type Nodes = Record<AnyNodeId, AnyNode>
type TreeFacts = {
  heightsM: number[]
  crownCoverM2: number
  nearestBuildingDistanceM: number | null
  reports: { code: string; treeId: string }[]
}

const groveInput = {
  form: 'spreading',
  heightM: 10,
  spreadM: 6,
  foliage: '#b2784c',
  density: 0.7,
  seed: 19,
  trees: [
    { at: [-10, -8] },
    {
      at: [6, -6],
      form: 'upright',
      heightM: 4,
      spreadM: 2,
      foliage: '#609343',
      density: 0,
      seed: 20,
    },
  ],
}
const storedGrove = [
  {
    position: [-10, 0, -8],
    form: 'spreading',
    heightM: 10,
    spreadM: 6,
    foliage: '#b2784c',
    density: 0.7,
    seed: 19,
  },
  {
    position: [6, 0, -6],
    form: 'upright',
    heightM: 4,
    spreadM: 2,
    foliage: '#609343',
    density: 0,
    seed: 20,
  },
]

async function connection(nodes: Nodes = { [site.id]: site }) {
  const bridge = new SceneBridge()
  const rootIds = Object.values(nodes)
    .filter((node) => node.type === 'site')
    .map((node) => node.id)
  bridge.setScene(nodes, rootIds)
  bridge.clearHistory()
  const server = createPascalMcpServer({ bridge, name: 'tree-acceptance', version: '0.0.0' })
  const client = new Client({ name: 'real-tree-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, server, client }
}

function houseScene(): Nodes {
  const slab = SlabNode.parse({
    id: 'slab_tree_house',
    parentId: 'level_tree_house',
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_tree_house',
    parentId: 'roof_tree_house',
    width: 4,
    depth: 4,
    overhang: 0.5,
  })
  const roof = RoofNode.parse({
    id: 'roof_tree_house',
    parentId: 'level_tree_house',
    children: [segment.id],
  })
  const level = LevelNode.parse({
    id: 'level_tree_house',
    parentId: 'building_tree_house',
    height: 3,
    children: [slab.id, roof.id],
  })
  const building = BuildingNode.parse({
    id: 'building_tree_house',
    parentId: site.id,
    children: [level.id],
  })
  return Object.fromEntries(
    [{ ...site, children: [building.id] }, building, level, slab, roof, segment].map((node) => [
      node.id,
      node,
    ]),
  )
}

function refusalCode(content: unknown): string | undefined {
  return JSON.parse((content as { text?: string }[] | undefined)?.[0]?.text ?? '{}').code
}

const treesIn = (bridge: SceneBridge) =>
  Object.values(bridge.getNodes())
    .filter((node) => node.type === 'tree')
    .map((node) => TreeNode.parse(node))

// The real MCP transport applies the shared operation through the production scene bridge.
describe('add_tree over MCP', () => {
  test('is offered once as an additive closed-world write, with no update or delete target', async () => {
    const { server, client } = await connection()
    try {
      const tools = (await client.listTools()).tools.filter((tool) => tool.name === 'add_tree')
      expect(tools).toHaveLength(1)
      expect(tools[0]?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      })
      expect(tools[0]?.inputSchema.required).toContain('trees')
      expect(tools[0]?.inputSchema.properties).toHaveProperty('trees')
      expect(tools[0]?.inputSchema.properties).not.toHaveProperty('treeId')
      expect(tools[0]?.inputSchema.properties).not.toHaveProperty('delete')
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('stores every tree with shared defaults and overrides, reports facts and undoes the grove together', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = JSON.stringify(bridge.getNodes())
      const result = await client.callTool({ name: 'add_tree', arguments: groveInput })
      expect(result.isError).toBeFalsy()
      const trees = treesIn(bridge)
      expect(trees).toHaveLength(2)
      expect(trees).toEqual(
        expect.arrayContaining(
          storedGrove.map((tree) =>
            expect.objectContaining({ ...tree, parentId: site.id, gen: 1 }),
          ),
        ),
      )
      expect(result.structuredContent).toMatchObject({ siteId: site.id, count: 2 })
      expect(result.structuredContent?.treeIds).toHaveLength(2)
      expect(result.structuredContent?.treeIds).toEqual(
        expect.arrayContaining(trees.map((tree) => tree.id)),
      )
      const facts = result.structuredContent?.facts as TreeFacts
      expect(facts.heightsM).toEqual([10, 4])
      // Mature crowns are disks: pi * (3² + 1²), even for the bare tree.
      expect(facts.crownCoverM2).toBeCloseTo(10 * Math.PI, 7)
      expect(facts.nearestBuildingDistanceM).toBeNull()
      expect(facts.reports).toEqual([])
      expect((await client.callTool({ name: 'undo', arguments: {} })).isError).toBeFalsy()
      expect(JSON.stringify(bridge.getNodes())).toBe(before)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('omitted fields use the documented tree defaults and a derived numeric spread', async () => {
    const { bridge, server, client } = await connection()
    try {
      const result = await client.callTool({
        name: 'add_tree',
        arguments: { trees: [{ at: [0, 0] }] },
      })
      expect(result.isError).toBeFalsy()
      const trees = treesIn(bridge)
      expect(trees).toHaveLength(1)
      const tree = trees[0]
      expect(tree).toMatchObject({
        parentId: site.id,
        position: [0, 0, 0],
        form: 'round',
        heightM: 8,
        foliage: '#609343',
        density: 0.85,
        seed: 1,
        gen: 1,
      })
      const spread = tree?.spreadM
      expect(typeof spread).toBe('number')
      if (typeof spread !== 'number')
        throw new Error('The operation must store a numeric crown spread.')
      const facts = result.structuredContent?.facts as TreeFacts
      expect(facts.heightsM).toEqual([8])
      expect(facts.crownCoverM2).toBeCloseTo(Math.PI * (spread / 2) ** 2, 7)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('accepts forty trees and derives distinct seeds from one shared default', async () => {
    const { bridge, server, client } = await connection()
    try {
      const trees = Array.from({ length: 40 }, (_, index) => ({
        at: [(index % 8) * 3 - 10, Math.floor(index / 8) * 4 - 10],
      }))
      const result = await client.callTool({ name: 'add_tree', arguments: { trees, seed: 19 } })
      expect(result.isError).toBeFalsy()
      const stored = treesIn(bridge)
      expect(stored).toHaveLength(40)
      expect(new Set(stored.map((tree) => tree.seed)).size).toBe(40)
      expect(result.structuredContent).toMatchObject({
        siteId: site.id,
        count: 40,
        facts: { heightsM: Array(40).fill(8) },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('reports roof and lot crown conflicts without refusing trees whose trunks stay outside', async () => {
    const { bridge, server, client } = await connection(houseScene())
    try {
      const result = await client.callTool({
        name: 'add_tree',
        arguments: { spreadM: 4, trees: [{ at: [4, 0] }, { at: [14, 8] }] },
      })
      expect(result.isError).toBeFalsy()
      const trees = treesIn(bridge)
      expect(trees).toHaveLength(2)
      const byX = (x: number) => trees.find((tree) => tree.position[0] === x)?.id
      const facts = result.structuredContent?.facts as TreeFacts
      expect(facts.crownCoverM2).toBeCloseTo(8 * Math.PI, 7)
      expect(facts.nearestBuildingDistanceM).toBeCloseTo(2, 7)
      expect(facts.reports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'tree_crown_over_roof',
            treeId: byX(4),
            roofIds: ['roof_tree_house'],
          }),
          expect.objectContaining({ code: 'tree_crown_crosses_lot', treeId: byX(14) }),
        ]),
      )
    } finally {
      await client.close()
      await server.close()
    }
  })
})

const building = BuildingNode.parse({ id: 'building_tree_frame', parentId: site.id })
const otherSite = SiteNode.parse({ id: 'site_other_trees' })
const validTrees = [{ at: [8, 8] }]
const refusalCases: { name: string; nodes?: Nodes; args: Record<string, unknown>; code: string }[] =
  [
    { name: 'an empty grove', args: { trees: [] }, code: 'invalid_input' },
    {
      name: 'more than forty trees',
      args: { trees: Array.from({ length: 41 }, () => ({ at: [8, 8] })) },
      code: 'invalid_input',
    },
    {
      name: 'a later tree outside the height bounds',
      args: { trees: [...validTrees, { at: [10, 8], heightM: 26 }] },
      code: 'invalid_input',
    },
    {
      name: 'an unsupported form',
      args: { trees: validTrees, form: 'unknown' },
      code: 'invalid_input',
    },
    { name: 'no Site', nodes: {}, args: { trees: validTrees }, code: 'no_site' },
    {
      name: 'an unknown Site',
      args: { trees: validTrees, siteId: 'site_missing' },
      code: 'no_site',
    },
    {
      name: 'several Sites without a choice',
      nodes: { [site.id]: site, [otherSite.id]: otherSite },
      args: { trees: validTrees },
      code: 'ambiguous_site',
    },
    {
      name: 'an unknown building frame',
      args: { trees: validTrees, buildingId: 'building_missing' },
      code: 'building_not_found',
    },
    {
      name: 'a building on another Site',
      nodes: {
        [site.id]: site,
        [otherSite.id]: otherSite,
        [building.id]: { ...building, parentId: otherSite.id },
      },
      args: { siteId: site.id, buildingId: building.id, trees: validTrees },
      code: 'building_site_mismatch',
    },
    {
      name: 'a tipped building frame',
      nodes: { [site.id]: site, [building.id]: { ...building, rotation: [0.1, 0, 0] } },
      args: { buildingId: building.id, trees: validTrees },
      code: 'tree_transform_unsupported',
    },
    {
      name: 'a later trunk inside the house',
      nodes: houseScene(),
      args: { trees: [...validTrees, { at: [0, 0] }] },
      code: 'tree_inside_building',
    },
  ]

describe('add_tree refusal atomicity over MCP', () => {
  for (const { name, nodes, args, code } of refusalCases)
    test(`refuses ${name} before writing any tree`, async () => {
      const { bridge, server, client } = await connection(nodes)
      try {
        const before = JSON.stringify(bridge.exportJSON())
        const result = await client.callTool({ name: 'add_tree', arguments: args })
        expect(result.isError).toBe(true)
        expect(refusalCode(result.content)).toBe(code)
        expect(JSON.stringify(bridge.exportJSON())).toBe(before)
        expect(treesIn(bridge)).toEqual([])
      } finally {
        await client.close()
        await server.close()
      }
    })
})
