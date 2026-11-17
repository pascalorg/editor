import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { addDormerOutput } from '@pascal-app/core/agent-tools'
import {
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  type SceneSnapshot,
} from '@pascal-app/core/runtime'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import { SceneBridge } from '../bridge/scene-bridge'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { registerRedo } from './redo'
import { registerSceneLifecycleTools } from './scene-lifecycle'
import { createTestSceneOperations } from './scene-lifecycle/test-utils'
import { registerSharedTools } from './shared-tools'
import { registerUndo } from './undo'

const hostId = 'rseg_native'
let runtime: ReturnType<typeof openDetachedScene>
let bridge: SceneBridge
let client: Client
let server: McpServer
let editorBefore: ReturnType<SceneBridge['exportJSON']>

function snapshot(): SceneSnapshot {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: [hostId] })
  const segment = RoofSegmentNode.parse({
    id: hostId,
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: [],
  })
  return {
    nodes: Object.fromEntries(
      [building, level, roof, segment].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [building.id],
    collections: {},
    materials: {},
    installedPlugins: [],
  } as SceneSnapshot
}

beforeEach(async () => {
  editorBefore = new SceneBridge().exportJSON()
  runtime = openDetachedScene(snapshot(), {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: null,
      selection: [],
      units: 'metric',
      catalogVersion: 'dormer-test',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds('dormer-acceptance'),
  })
  bridge = new SceneBridge({ runtime })
  const { operations } = createTestSceneOperations({ bridge })
  server = new McpServer({ name: 'dormer-acceptance', version: '1' })
  registerSharedTools(server, operations)
  registerSceneLifecycleTools(server, operations)
  registerUndo(server, operations)
  registerRedo(server, operations)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'dormer-acceptance', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})
afterEach(async () => {
  await client.close()
  await server.close()
  runtime.dispose()
  expect(new SceneBridge().exportJSON()).toEqual(editorBefore)
})

type ToolReply = { isError?: boolean; content: Array<{ type: string; text?: string }> }
async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolReply
  return { result, text: result.content.find((part) => part.type === 'text')?.text ?? '' }
}
async function success(name: string, args: Record<string, unknown>) {
  const { result, text } = await call(name, args)
  expect(result.isError).toBeFalsy()
  return JSON.parse(text) as Record<string, unknown>
}
async function refused(args: Record<string, unknown>, code?: string) {
  const before = bridge.exportJSON()
  const history = bridge.getHistory()
  const { result, text } = await call('add_dormer', args)
  expect(result.isError).toBe(true)
  if (code) expect(JSON.parse(text)).toMatchObject({ code })
  expect(bridge.exportJSON()).toEqual(before)
  expect(bridge.getHistory()).toEqual(history)
  return text
}

describe('native dormer MCP transaction', () => {
  test('advertises the shared additive tool and its native output contract', async () => {
    const tool = (await client.listTools()).tools.find((entry) => entry.name === 'add_dormer')
    expect(tool).toBeDefined()
    expect(tool?.annotations).toMatchObject(ADDITIVE_TOOL_ANNOTATIONS)
    expect(tool?.outputSchema).toBeDefined()
    for (const key of ['rotation', 'seat', 'code'])
      expect(tool!.inputSchema.properties).not.toHaveProperty(key)
  })

  // Schema acceptance covers the complete enum; transport persistence needs only a
  // representative ordinary profile and the newly exposed existing conical option.
  for (const roofType of ['gable', 'conical'] as const) {
    test(`${roofType} creates exactly one native pair; one undo/redo and saved reload retain both references`, async () => {
      const before = bridge.exportJSON()
      const payload = await success('add_dormer', {
        segmentId: hostId,
        roofType,
        width: '1.4 m',
        depth: '2 m',
        wallHeight: '0.6 m',
        roofHeight: '0.8 m',
        windowWidth: '0.7 m',
        windowHeight: '0.5 m',
        name: 'Saved dormer',
      })
      expect(z.object(addDormerOutput).safeParse(payload).success).toBe(true)
      expect(payload).toMatchObject({
        roofId: 'roof_r',
        segmentId: hostId,
        atticRoomId: null,
        windowSillAboveAtticFloorM: null,
      })
      expect(payload).not.toHaveProperty('ok')
      const dormer = bridge.getNodes()[payload.dormerId as AnyNodeId]
      const window = bridge.getNodes()[payload.windowId as AnyNodeId]
      if (dormer?.type !== 'dormer' || window?.type !== 'window')
        throw new Error('Missing persisted native pair')
      expect(dormer).toMatchObject({
        parentId: hostId,
        roofSegmentId: hostId,
        roofType,
        width: 1.4,
        depth: 2,
        height: 0.6,
        roofHeight: 0.8,
        windowWidth: 0.7,
        windowHeight: 0.5,
        name: 'Saved dormer',
        children: [window.id],
      })
      dormer.position.forEach((v, i) => {
        expect(v).toBeCloseTo([0, 4, 2][i]!, 8)
      })
      expect(window).toMatchObject({
        parentId: dormer.id,
        dormerId: dormer.id,
        dormerFace: 'front',
        width: 0.7,
        height: 0.5,
      })
      expect(Object.keys(bridge.getNodes())).toHaveLength(Object.keys(before.nodes).length + 2)
      const after = bridge.exportJSON()
      expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
      expect(await success('undo', { steps: 1 })).toMatchObject({ undone: 1 })
      expect(bridge.exportJSON()).toEqual(before)
      expect(await success('redo', { steps: 1 })).toMatchObject({ redone: 1 })
      expect(bridge.exportJSON()).toEqual(after)
      const saved = await success('save_scene', { name: `Native ${roofType} dormer` })
      bridge.setScene({}, [])
      await success('load_scene', { id: saved.id })
      expect(bridge.getNodes()[dormer.id]).toEqual(dormer)
      expect(bridge.getNodes()[window.id]).toEqual(window)
      expect(
        (bridge.getNodes()[hostId] as RoofSegmentNode).children.filter((id) => id === dormer.id),
      ).toHaveLength(1)
    })
  }

  test('overlap failure cannot leak a window, allocate a history step or damage the first pair', async () => {
    const first = await success('add_dormer', { segmentId: hostId })
    expect(JSON.parse(await refused({ segmentId: hostId }, 'overlaps_dormer'))).toMatchObject({
      nodeIds: [first.dormerId],
    })
    // The next centre is outside the first dormer's .605m half-width/cut,
    // but two 1.21m-wide footprints still overlap by .21m.
    expect(
      JSON.parse(await refused({ segmentId: hostId, at: [1, 2] }, 'overlaps_dormer')),
    ).toMatchObject({ nodeIds: [first.dormerId] })
    await success('undo', { steps: 1 })
    expect(
      Object.values(bridge.getNodes()).some(
        (node) => node.type === 'dormer' || node.type === 'window',
      ),
    ).toBe(false)
  })

  test('semantic and schema refusals leave the detached scene and its history unchanged', async () => {
    await refused({}, 'roof_host_required')
    await refused({ roofId: 'roof_r' }, 'position_required')
    await refused({ segmentId: 'level_l' }, 'invalid_roof_host')
    await refused({ segmentId: hostId, at: [0, 0] }, 'too_wide')
    await refused({ segmentId: hostId, width: 1, windowWidth: 1.1 }, 'window_too_wide')
    await refused({ segmentId: hostId, windowHeight: 10 }, 'window_does_not_fit')
    await refused({ segmentId: hostId, depth: 0.5 }, 'window_not_exposed')
    await refused({ segmentId: hostId, width: 0 })
    await refused({ segmentId: hostId, roofType: 'barrel' })
    await refused({ segmentId: hostId, roofType: 'freeform' })
  })

  test('unknown physical cuts are explicit refusals, never a nominal-height fallback', async () => {
    const cut = SkylightNode.parse({
      id: 'skylight_cut',
      parentId: hostId,
      roofSegmentId: hostId,
      position: [0, 4, 2],
      width: 1,
      height: 1,
    })
    bridge.applyPatch([{ op: 'create', node: cut, parentId: hostId }])
    bridge.clearHistory()
    const result = JSON.parse(await refused({ segmentId: hostId }, 'dormer_geometry_unmeasured'))
    expect(result).toMatchObject({ reason: 'accessory-cut', nodeIds: [cut.id] })
  })
})
