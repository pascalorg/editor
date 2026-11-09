import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import {
  type AnyNode,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerSaveScene } from './save-scene'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

describe('save_scene', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    store = new InMemorySceneStore()
    const { operations } = createTestSceneOperations({ bridge, store })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSaveScene(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('saves the current scene and returns SceneMeta with editorUrl', async () => {
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'My Scene' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('My Scene')
    expect(typeof parsed.id).toBe('string')
    expect(parsed.version).toBe(1)
    expect(parsed.url).toBe(`/editor/${parsed.id}`)
    expect(parsed.editorUrl).toBe(`/editor/${parsed.id}`)
    expect(parsed.published).toBe(true)
    expect(typeof parsed.graphHash).toBe('string')
    expect(parsed.nodeCount).toBeGreaterThan(0)
  })

  test('saves a provided graph when includeCurrentScene is false', async () => {
    // The graph is now re-validated against AnyNode at the save boundary
    // (security fix from Phase 8 P4). Use a schema-compliant site node id
    // that matches `site_*`.
    const siteId = 'site_provided01'
    const graph = {
      nodes: {
        [siteId]: {
          object: 'node',
          id: siteId,
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          polygon: {
            type: 'polygon',
            points: [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
          },
          children: [],
        },
      },
      rootNodeIds: [siteId],
    }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: {
        name: 'From Graph',
        includeCurrentScene: false,
        graph,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('From Graph')
    expect(parsed.nodeCount).toBe(1)
  })

  /** The default scene's level with a walled 8 × 6 room and a roof on its walls, as a graph. */
  function roofedGraph() {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level') as LevelNode
    const corners: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ]
    const roof = RoofNode.parse({
      parentId: level.id,
      position: [4, 0, 3],
      support: { kind: 'walls' },
    })
    const segment = RoofSegmentNode.parse({ parentId: roof.id, width: 8, depth: 6 })
    const walls = corners.map((start, i) =>
      WallNode.parse({ parentId: level.id, start, end: corners[(i + 1) % 4], height: 2.5 }),
    )
    const exported = bridge.exportJSON()
    const graph = {
      ...exported,
      nodes: {
        ...exported.nodes,
        [level.id]: {
          ...level,
          children: [...level.children, ...walls.map((w) => w.id), roof.id],
        },
        ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
        [roof.id]: { ...roof, children: [segment.id] },
        [segment.id]: segment,
      },
    }
    return { graph, level, roof }
  }

  // The graph is judged against the scene it is saved over, as apply_patch's writes are: a roof it
  // puts on the walls of the storey holding it is saved on the level above them.
  test('a provided graph’s roof on its walls’ storey is saved on a Roof level, said in notes', async () => {
    const { graph, level, roof } = roofedGraph()
    const first = await client.callTool({ name: 'save_scene', arguments: { name: 'Base' } })
    const { id } = parseToolText(first.content as StoredTextContent[])
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { id, name: 'Roofed', includeCurrentScene: false, graph },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    const saved = (await store.load(parsed.id as string))!.graph.nodes as Record<string, AnyNode>
    const roofLevel = saved[saved[roof.id]!.parentId!] as LevelNode
    expect(roofLevel.metadata).toMatchObject({ role: 'roof' })
    expect(roofLevel.children).toEqual([roof.id])
    expect((saved[level.id] as LevelNode).children).not.toContain(roof.id)
    expect(parsed.notes).toHaveLength(1)
  })

  // A fresh session holds the default scene: a project's graph saved over its stored scene from
  // there is judged against that scene, so its legacy roof is not read as a new write.
  test('a graph saved over a stored scene the session does not hold is judged against that one', async () => {
    const { graph, level, roof } = roofedGraph()
    const stored = await store.save({ name: 'Legacy', graph: graph as never })
    bridge.setScene({}, [])
    bridge.loadDefault()
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { id: stored.id, name: 'Legacy', includeCurrentScene: false, graph },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.notes).toBeUndefined()
    const saved = (await store.load(stored.id))!.graph.nodes as Record<string, AnyNode>
    expect(saved[roof.id]!.parentId).toBe(level.id)
  })

  test('a graph with no scene under it is saved as it is, a walled declared roof level included', async () => {
    const { graph, level, roof } = roofedGraph()
    const legacy = {
      ...graph,
      nodes: {
        ...graph.nodes,
        [level.id]: { ...graph.nodes[level.id], metadata: { role: 'roof' } },
      },
    }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Imported', includeCurrentScene: false, graph: legacy },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    const saved = (await store.load(parsed.id as string))!.graph.nodes as Record<string, AnyNode>
    expect(saved[roof.id]!.parentId).toBe(level.id)
    expect(parsed.notes).toBeUndefined()
  })

  test('rejects a graph with a malicious URL (P4 security fix)', async () => {
    const siteId = 'site_evil0000001'
    const itemId = 'item_evil0000001'
    const graph = {
      nodes: {
        [siteId]: {
          object: 'node',
          id: siteId,
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          polygon: {
            type: 'polygon',
            points: [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
          },
          children: [],
        },
        [itemId]: {
          object: 'node',
          id: itemId,
          type: 'item',
          parentId: null,
          visible: true,
          metadata: {},
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          asset: {
            id: 'evil',
            name: 'evil',
            category: 'x',
            src: 'javascript:alert(1)',
            dimensions: [1, 1, 1],
            offset: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          children: [],
        },
      },
      rootNodeIds: [siteId],
    }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Evil', includeCurrentScene: false, graph },
    })
    expect(result.isError).toBe(true)
  })

  test('migrates a provided legacy wall assembly before validating and saving it', async () => {
    const wall = WallNode.parse({ id: 'wall_legacysave', start: [0, 0], end: [4, 0] })
    const assembly = { framing: { kind: 'wood', depth: 0.14 } }
    const graph = { nodes: { [wall.id]: { ...wall, assembly } }, rootNodeIds: [wall.id] }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Legacy wall', includeCurrentScene: false, graph },
    })

    expect(result.isError).toBeFalsy()
    const payload = parseToolText(result.content as StoredTextContent[])
    const saved = await store.load(payload.id as string)
    expect((saved!.graph.nodes[wall.id] as WallNode).assembly).toEqual({
      face: 'exterior',
      layers: [{ id: 'framing', role: 'structure', thickness: 0.14, core: true, material: 'wood' }],
    })
    expect(graph.nodes[wall.id]).toEqual({ ...wall, assembly })
  })

  test('errors when includeCurrentScene is false and no graph is provided', async () => {
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'No Graph', includeCurrentScene: false },
    })
    expect(result.isError).toBe(true)
  })

  test.each([
    ['long', 'a'.repeat(81), 'a'.repeat(121)],
    ['empty', '', ''],
  ])(
    'saves %s legacy text and layers above the former F2 caps without loss',
    async (_, preset, cavityInsulation) => {
      const wall = WallNode.parse({ id: 'wall_unboundedsave', start: [0, 0], end: [4, 0] })
      const graph = {
        nodes: {
          [wall.id]: {
            ...wall,
            assembly: {
              preset,
              cavityInsulation,
              exterior: { finish: 'stone', thickness: 5.001 },
              sheathing: { material: 'osb', thickness: 5.001 },
              framing: { kind: 'wood', depth: 5.001 },
              interior: { finish: 'drywall', thickness: 5.001 },
            },
          },
        },
        rootNodeIds: [wall.id],
      }
      const result = await client.callTool({
        name: 'save_scene',
        arguments: { name: 'Unbounded legacy wall', includeCurrentScene: false, graph },
      })

      expect(result.isError).toBeFalsy()
      const payload = parseToolText(result.content as StoredTextContent[])
      const saved = await store.load(payload.id as string)
      const assembly = WallNode.parse(saved?.graph.nodes[wall.id]).assembly!
      expect(assembly.presetId).toBe(preset)
      expect(assembly.cavityInsulation).toBe(cavityInsulation)
      expect(assembly.layers.map(({ id, thickness }) => [id, thickness])).toEqual([
        ['exterior', 5.001],
        ['sheathing', 5.001],
        ['framing', 5.001],
        ['interior', 5.001],
      ])
    },
  )

  test('returns version_conflict when expectedVersion mismatches', async () => {
    const first = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Original' },
    })
    const parsed = parseToolText(first.content as StoredTextContent[])
    const result = await client.callTool({
      name: 'save_scene',
      arguments: {
        id: parsed.id as string,
        name: 'Second',
        expectedVersion: 99,
      },
    })
    expect(result.isError).toBe(true)
  })

  // 2026-10-03, a Claude Code run on the hosted MCP: the server reloaded, the session started over
  // on a blank scene, and save_scene(projectId) wrote it over the project's draft — 8 levels and
  // 10 imported plans lost.
  test('refuses to write a scene this session did not load over a project that holds one', async () => {
    const project = await store.createProject({ name: 'The Victor' })
    const walls = Array.from({ length: 4 }, (_, index) =>
      WallNode.parse({ start: [index, 0], end: [index + 1, 0] }),
    )
    await store.save({
      id: project.projectId,
      name: 'The Victor',
      projectId: project.projectId,
      graph: {
        nodes: Object.fromEntries(walls.map((wall) => [wall.id, wall])),
        rootNodeIds: [],
      } as never,
    })
    const blank = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'The Victor', projectId: project.projectId },
    })
    expect(blank.isError).toBe(true)
    expect(JSON.stringify(blank.content)).toContain('scene_not_loaded')
    expect((await store.getProjectStatus(project.projectId))?.nodeCount).toBe(4)
    // Said on purpose, it replaces.
    const replaced = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'The Victor', projectId: project.projectId, replace: true },
    })
    expect(replaced.isError).toBeFalsy()
  })

  test('saves into a project that holds nothing yet', async () => {
    const project = await store.createProject({ name: 'Empty' })
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Empty', projectId: project.projectId },
    })
    expect(result.isError).toBeFalsy()
  })

  // The first save after create_project was refused "projectId is
  // required for Supabase store. Call create_project first.", though the session held its project.
  test("without a target, saves to the session's project", async () => {
    const project = await store.createProject({ name: 'Hawkesbury' })
    const meta = await store.save({
      id: project.projectId,
      name: 'Hawkesbury',
      projectId: project.projectId,
      graph: { nodes: bridge.getNodes(), rootNodeIds: bridge.getRootNodeIds() } as never,
    })
    bridge.setActiveScene(meta)
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Hawkesbury', saveMode: 'checkpoint' },
    })
    expect(result.isError).toBeFalsy()
    const saved = parseToolText(result.content as StoredTextContent[])
    expect(saved).toMatchObject({ id: project.projectId, projectId: project.projectId, version: 2 })
  })
})
