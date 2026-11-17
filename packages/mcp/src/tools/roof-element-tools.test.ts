import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { addRoofElementOutput } from '@pascal-app/core/agent-tools'
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

const kinds = [
  'chimney',
  'skylight',
  'solar-panel',
  'cupola',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
] as const
const nativeNames = [
  'Chimney',
  'Skylight',
  'Solar Panel',
  'Cupola',
  'Box Vent',
  'Ridge Vent',
  'Turbine Vent',
  'Eyebrow Vent',
]
const hostId = 'rseg_native'
let scene: ReturnType<typeof openDetachedScene>
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
    deckThickness: 0.25,
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
  scene = openDetachedScene(snapshot(), {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: null,
      selection: [],
      units: 'metric',
      catalogVersion: 'roof-test',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds('roof-element-acceptance'),
  })
  bridge = new SceneBridge({ runtime: scene })
  const { operations } = createTestSceneOperations({ bridge })
  server = new McpServer({ name: 'roof-element-acceptance', version: '1' })
  registerSharedTools(server, operations)
  registerSceneLifecycleTools(server, operations)
  registerUndo(server, operations)
  registerRedo(server, operations)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'roof-element-acceptance', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  await server.close()
  scene.dispose()
  expect(new SceneBridge().exportJSON()).toEqual(editorBefore)
})

type ToolReply = { isError?: boolean; content: Array<{ type: string; text?: string }> }
async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolReply
  const text = result.content.find((part) => part.type === 'text')?.text ?? ''
  return { result, text }
}
async function success(name: string, args: Record<string, unknown>) {
  const { result, text } = await call(name, args)
  expect(result.isError).toBeFalsy()
  return JSON.parse(text) as Record<string, unknown>
}

async function expectRefusal(args: Record<string, unknown>, code?: string) {
  const before = bridge.exportJSON()
  const history = bridge.getHistory()
  const { result, text } = await call('add_roof_element', args)
  expect(result.isError).toBe(true)
  if (code) expect(JSON.parse(text)).toMatchObject({ code })
  expect(bridge.exportJSON()).toEqual(before)
  expect(bridge.getHistory()).toEqual(history)
  return text
}

describe('native roof elements through the public MCP runtime', () => {
  test('advertises the shared strict contract and additive annotations', async () => {
    const tool = (await client.listTools()).tools.find((entry) => entry.name === 'add_roof_element')
    expect(tool).toBeDefined()
    expect(tool?.annotations).toMatchObject(ADDITIVE_TOOL_ANNOTATIONS)
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    })
    expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['kind', 'id', 'point']))
    expect(tool?.outputSchema).toBeDefined()
  })

  for (const [index, kind] of kinds.entries()) {
    test(`${kind} uses native construction, saves/reloads, and reverses in one real history call`, async () => {
      const before = bridge.exportJSON()
      const payload = await success('add_roof_element', { kind, id: hostId, point: [1, 1] })
      expect(z.object(addRoofElementOutput).safeParse(payload).success).toBe(true)
      expect(payload).toMatchObject({ ok: true, kind, roofId: 'roof_r', segmentId: hostId })
      const node = bridge.getNodes()[payload.id as AnyNodeId]
      if (!node || !('position' in node))
        throw new Error('Tool must persist its reported native node')
      expect(node).toMatchObject({
        type: kind,
        parentId: hostId,
        roofSegmentId: hostId,
        name: nativeNames[index],
      })
      const expected = kind === 'ridge-vent' ? [1, 0, 0] : [1, 5 + 0.3 * Math.SQRT2, 1]
      ;(node.position as number[]).forEach((value, i) => {
        expect(value).toBeCloseTo(expected[i]!, 8)
      })
      expect(payload.localPosition).toEqual(
        expected.map((value) => Math.round(value * 1000) / 1000),
      )
      expect(payload.planPoint).toEqual(kind === 'ridge-vent' ? [1, 0] : [1, 1])
      if (kind === 'solar-panel') expect(node).toMatchObject({ rows: 2, columns: 3 })
      if (kind === 'cupola')
        expect(node).toMatchObject({ slots: { louvers: 'library:preset-metal' } })
      const segment = bridge.getNodes()[hostId] as RoofSegmentNode
      expect(segment.children.filter((id) => id === node.id)).toHaveLength(1)
      const after = bridge.exportJSON()
      expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
      expect(await success('undo', { steps: 1 })).toMatchObject({ undone: 1 })
      expect(bridge.exportJSON()).toEqual(before)
      expect(await success('redo', { steps: 1 })).toMatchObject({ redone: 1 })
      expect(bridge.exportJSON()).toEqual(after)

      // Actual save_scene/load_scene transport and storage validation, not just JSON stringify.
      const saved = await success('save_scene', { name: `Native ${kind}` })
      expect(typeof saved.id).toBe('string')
      bridge.setScene({}, [])
      await success('load_scene', { id: saved.id })
      expect(bridge.getNodes()[node.id]).toEqual(node)
      expect(
        (bridge.getNodes()[hostId] as RoofSegmentNode).children.filter((id) => id === node.id),
      ).toHaveLength(1)
      expect(bridge.exportJSON().rootNodeIds).toEqual(after.rootNodeIds)
    })
  }

  // Native solar schema defaults are independently optional: rows=2, columns=3.
  // Exercise transport forwarding, not just the shared builder's option handling.
  for (const [options, expected] of [
    [{ rows: 20 }, { rows: 20, columns: 3 }],
    [{ columns: 1 }, { rows: 2, columns: 1 }],
  ] as const) {
    test(`solar preserves the omitted dimension for ${JSON.stringify(options)}`, async () => {
      const payload = await success('add_roof_element', {
        kind: 'solar-panel',
        id: hostId,
        point: [1, 1],
        ...options,
      })
      expect(bridge.getNodes()[payload.id as AnyNodeId]).toMatchObject({
        type: 'solar-panel',
        parentId: hostId,
        roofSegmentId: hostId,
        ...expected,
      })
      expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    })
  }

  test('solar options survive the protocol, native schema validation and saved reload', async () => {
    const payload = await success('add_roof_element', {
      kind: 'solar-panel',
      id: 'roof_r',
      point: [1, -1],
      rows: 20,
      columns: 1,
      name: 'Rear array',
    })
    const node = bridge.getNodes()[payload.id as AnyNodeId]
    expect(node).toMatchObject({ rows: 20, columns: 1, name: 'Rear array', rotation: 0 })
    if (node?.type !== 'solar-panel' || !node.surfaceNormal)
      throw new Error('Expected solar analytical normal')
    node.surfaceNormal.forEach((value, index) => {
      expect(value).toBeCloseTo([0, Math.SQRT1_2, -Math.SQRT1_2][index]!, 9)
    })
    const saved = await success('save_scene', { name: 'Configured array' })
    bridge.setScene({}, [])
    await success('load_scene', { id: saved.id })
    expect(bridge.getNodes()[node.id]).toEqual(node)
  })

  test('an unknown roof cut reports its provenance without a fallback, write or undo entry', async () => {
    const skylight = SkylightNode.parse({
      id: 'skylight_cut',
      parentId: hostId,
      roofSegmentId: hostId,
      position: [0, 6, 0],
      width: 1,
      height: 1,
    })
    bridge.applyPatch([{ op: 'create', node: skylight, parentId: hostId }])
    bridge.clearHistory()
    const text = await expectRefusal(
      { kind: 'chimney', id: hostId, point: [0, 0] },
      'roof_surface_unmeasured',
    )
    expect(JSON.parse(text)).toMatchObject({
      id: hostId,
      reason: 'accessory-cut',
      nodeIds: [skylight.id],
    })
    await expectRefusal(
      { kind: 'ridge-vent', id: hostId, point: [0, 2] },
      'roof_surface_unmeasured',
    )
  })

  test('semantic misses and bad targets are truthful refusals, not successful no-op writes', async () => {
    const text = await expectRefusal(
      { kind: 'chimney', id: hostId, point: [100, 100] },
      'roof_point_outside_segment',
    )
    expect(JSON.parse(text)).toMatchObject({
      reason: 'outside-surface',
      point: [100, 100],
      segmentId: hostId,
    })
    await expectRefusal({ kind: 'chimney', id: 'rseg_missing', point: [1, 1] }, 'node_not_found')
    await expectRefusal({ kind: 'chimney', id: 'level_l', point: [1, 1] }, 'roof_target_invalid')
  })

  for (const invalid of [
    { point: [1] },
    { point: [1, 2, 3] },
    { point: ['1', 1] },
    { kind: 'dormer' },
    { id: '' },
    { rows: 0 },
    { rows: 21 },
    { columns: 1.5 },
    { columns: '2' },
    { name: '' },
  ]) {
    test(`SDK input rejection is also atomic: ${JSON.stringify(invalid)}`, async () => {
      // JSON cannot carry NaN/Infinity. Direct finite-number cases live in core.
      // SDK validation owns these errors; no custom semantic code is invented.
      await expectRefusal({ kind: 'chimney', id: hostId, point: [1, 1], ...invalid })
    })
  }
})
