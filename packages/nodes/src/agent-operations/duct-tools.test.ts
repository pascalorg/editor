import { afterEach, beforeEach, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AnyNode,
  DuctFittingNode,
  DuctSegmentNode,
  LevelNode,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { SceneBridge } from '@pascal-app/mcp/bridge'
import { createSceneOperations } from '@pascal-app/mcp/operations'
import { registerOperationTool } from '@pascal-app/mcp/tools/shared-tools'
import { ductFittingDefinition, ductSegmentDefinition } from '@pascal-app/nodes'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'
import { builtinAgentTools } from '@pascal-app/nodes/agent-tools'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(ductSegmentDefinition)
  registerNode(ductFittingDefinition)
})
afterEach(() => restore())
const level = LevelNode.parse({})
const run = (extra = {}) =>
  DuctSegmentNode.parse({
    parentId: level.id,
    shape: 'round',
    diameter: 6,
    path: [
      [0, 0, 0],
      [6, 0, 0],
    ],
    ...extra,
  })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((node) => [node.id, node]))
const edit = builtinAgentOperations.duct_edit
const context = { activeLevelId: level.id }

test('duct operation is offered with dimensions and edit scopes', () => {
  const contract = builtinAgentTools.tools.find((tool) => tool.name === 'duct_edit')!
  expect(contract.runsIn).toBe('operation')
  expect(contract.input).toHaveProperty('alignment')
})

test('face resize preserves the top of an unconnected rectangular run', () => {
  const duct = run({ shape: 'rect', width: 14, height: 8 })
  const result = edit(
    scene(duct),
    { nodeId: duct.id, action: 'resize', height: 12, alignment: 'top' },
    context,
  )
  const resized = { ...duct, ...result.changes!.update![0]!.data } as typeof duct
  expect(resized.path[0]![1] + (resized.height * 0.0254) / 2).toBeCloseTo(
    (duct.height * 0.0254) / 2,
    8,
  )
  expect(duct.path[0]![1]).toBe(0)
})

test('branch resize follows an elbow and keeps the two collars joined', () => {
  const elbow = DuctFittingNode.parse({
    parentId: level.id,
    fittingType: 'elbow',
    shape: 'round',
    diameter: 6,
    position: [3, 0, 0],
    rotation: [0, 0, 0],
  })
  const a = run({
    path: [
      [0, 0, 0],
      [2.8095, 0, 0],
    ],
  })
  const b = run({
    path: [
      [3, 0, 0.1905],
      [3, 0, 4],
    ],
  })
  const result = edit(
    scene(a, b, elbow),
    { nodeId: a.id, action: 'resize', scope: 'branch', diameter: 10 },
    context,
  )
  const after = scene(a, b, elbow)
  for (const update of result.changes!.update!)
    after[update.id] = { ...after[update.id], ...update.data } as AnyNode
  expect(result.changes!.update).toHaveLength(3)
  expect((after[b.id] as typeof b).diameter).toBe(10)
  const ports = ductFittingDefinition.ports!(after[elbow.id] as typeof elbow)
  expect((after[a.id] as typeof a).path[1]).toEqual([...ports[0]!.position])
  expect((after[b.id] as typeof b).path[0]).toEqual([...ports[1]!.position])
})

test('segment resize inserts a transition while leaving its neighbour fixed', () => {
  const a = run({
    path: [
      [0, 0, 0],
      [3, 0, 0],
    ],
  })
  const b = run({
    path: [
      [3, 0, 0],
      [6, 0, 0],
    ],
  })
  const result = edit(scene(a, b), { nodeId: b.id, action: 'resize', diameter: 10 }, context)
  expect(result.changes!.update!.map((entry) => entry.id)).toEqual([b.id])
  const adapter = result.changes!.create![0]!.node as typeof DuctFittingNode._output
  expect(adapter.fittingType).toBe('reducer')
  const ports = ductFittingDefinition.ports!(adapter)
  expect([...ports[0]!.position]).toEqual(a.path[1]!)
  expect((result.changes!.update![0]!.data as typeof b).path[0]).toEqual([...ports[1]!.position])
})

test('branch resize stops at a tee without resizing its other branches', () => {
  const tee = DuctFittingNode.parse({
    parentId: level.id,
    fittingType: 'tee',
    shape: 'round',
    diameter: 6,
    position: [0, 0, 0],
  })
  const duct = run({
    path: [
      [0.1905, 0, 0],
      [6, 0, 0],
    ],
  })
  const result = edit(
    scene(duct, tee),
    { nodeId: duct.id, action: 'resize', scope: 'branch', diameter: 10 },
    context,
  )
  expect(result.changes!.update!.map((entry) => entry.id)).toEqual([duct.id])
  expect(result.changes!.create).toHaveLength(1)
})

test('face alignment refuses connected runs rather than separating collars', () => {
  const a = run({
    path: [
      [0, 0, 0],
      [3, 0, 0],
    ],
  })
  const b = run({
    path: [
      [3, 0, 0],
      [6, 0, 0],
    ],
  })
  expect(() =>
    edit(scene(a, b), { nodeId: b.id, action: 'resize', diameter: 10, alignment: 'top' }, context),
  ).toThrow('Face alignment')
})

test('resize refuses a transition that consumes the remaining run', () => {
  const a = run({
    path: [
      [0, 0, 0],
      [3, 0, 0],
    ],
  })
  const b = run({
    path: [
      [3, 0, 0],
      [3.2, 0, 0],
    ],
  })
  expect(() =>
    edit(scene(a, b), { nodeId: b.id, action: 'resize', diameter: 10 }, context),
  ).toThrow('Not enough straight duct')
})

for (const offset of [1, -1])
  test(`obstacle offset ${offset} keeps original endpoints and joins every new collar`, () => {
    const duct = run()
    const result = edit(
      scene(duct),
      { nodeId: duct.id, action: 'offset', offset, from: 1, to: 4 },
      context,
    )
    const first = { ...duct, ...result.changes!.update![0]!.data } as typeof duct
    const created = result.changes!.create!.map((entry) => entry.node)
    const ducts = [first, ...created.filter((node) => node.type === 'duct-segment')]
    expect(created.filter((node) => node.type === 'duct-fitting')).toHaveLength(4)
    expect(first.path[0]).toEqual(duct.path[0]!)
    expect(ducts.at(-1)!.path[1]).toEqual(duct.path[1]!)
    expect(ducts[2]!.path[0]![1]).toBe(offset)
    const ports = [first, ...created].flatMap((node) =>
      nodeRegistry.get(node.type)!.ports!(node).map((port) => ({ ...port, nodeId: node.id })),
    )
    const open = ports.filter(
      (port) =>
        !ports.some(
          (other) =>
            other.nodeId !== port.nodeId &&
            Math.hypot(...port.position.map((n, i) => n - other.position[i]!)) < 1e-6,
        ),
    )
    expect(open).toHaveLength(2)
  })

test('offset refuses insufficient space without mutating the scene', () => {
  const duct = run()
  const nodes = scene(duct)
  const before = JSON.stringify(nodes)
  expect(() =>
    edit(nodes, { nodeId: duct.id, action: 'offset', offset: 0.1, from: 1, to: 4 }, context),
  ).toThrow('Allow')
  expect(JSON.stringify(nodes)).toBe(before)
})

test('nearby ducts on a different level are not resized', () => {
  const duct = run()
  const other = run({
    parentId: LevelNode.parse({}).id,
    path: [
      [6, 0, 0],
      [9, 0, 0],
    ],
  })
  const result = edit(
    scene(duct, other),
    { nodeId: duct.id, action: 'resize', scope: 'branch', diameter: 10 },
    context,
  )
  expect(result.changes!.update!.map((entry) => entry.id)).toEqual([duct.id])
})

test('duct offset works through MCP and undoes in one step', async () => {
  const duct = run()
  const root = { ...level, children: [duct.id] }
  const bridge = new SceneBridge()
  bridge.setScene(scene(root, duct), [level.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'duct-test', version: '0.0.0' })
  const contract = builtinAgentTools.tools.find((tool) => tool.name === 'duct_edit')!
  registerOperationTool(server, createSceneOperations({ bridge }), {
    contract,
    operation: edit,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  const client = new Client({ name: 'duct-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const result = await client.callTool({
      name: 'duct_edit',
      arguments: { nodeId: duct.id, action: 'offset', from: 1, to: 4, offset: 1 },
    })
    expect(result.isError).not.toBe(true)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'duct-fitting'),
    ).toHaveLength(4)
    bridge.undo()
    expect(bridge.getNodes()[duct.id]?.path).toEqual(duct.path)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'duct-fitting'),
    ).toHaveLength(0)
  } finally {
    await client.close()
    await server.close()
  }
})

test('face alignment moves automatic caps with the resized run', () => {
  const duct = run({ shape: 'rect', width: 14, height: 8 })
  const cap = DuctFittingNode.parse({
    parentId: level.id,
    fittingType: 'end-cap',
    shape: 'rect',
    width: 14,
    height: 8,
    position: [6.025, 0, 0],
  })
  const result = edit(
    scene(duct, cap),
    { nodeId: duct.id, action: 'resize', height: 12, alignment: 'top' },
    context,
  )
  expect(result.changes!.create).toHaveLength(0)
  const resized = result.changes!.update!.find((entry) => entry.id === duct.id)!.data as typeof duct
  const resizedCap = result.changes!.update!.find((entry) => entry.id === cap.id)!
    .data as typeof cap
  expect(resizedCap.height).toBe(12)
  expect(resized.path[1]![1]).toBeCloseTo(-0.0508, 6)
  expect(resizedCap.position[1]).toBeCloseTo(-0.0508, 6)
})

test('an obstacle offset transfers the far automatic cap to the tail section', () => {
  const duct = run()
  const cap = DuctFittingNode.parse({
    parentId: level.id,
    fittingType: 'end-cap',
    position: [6.025, 0, 0],
    shape: 'round',
    diameter: 6,
    metadata: { automaticRunEndCapOwnerId: duct.id, automaticRunEndCapEndpoint: 'end' },
  })
  const before = scene(duct, cap)
  const outcome = edit(
    before,
    { nodeId: duct.id, action: 'offset', from: 1, to: 5, offset: 1 },
    context,
  )
  const next = { ...before }
  for (const entry of outcome.changes!.create!) next[entry.node.id] = entry.node
  for (const entry of outcome.changes!.update!)
    next[entry.id] = { ...next[entry.id], ...entry.data } as AnyNode
  const updatedCap = next[cap.id] as DuctFittingNode
  expect(updatedCap.position).toEqual(cap.position)
  const tail = next[updatedCap.metadata.automaticRunEndCapOwnerId as string] as DuctSegmentNode
  expect(tail.id).not.toBe(duct.id)
  expect(tail.path.at(-1)).toEqual(duct.path.at(-1))
  expect(
    ductSegmentDefinition.parametrics!.onDeleteCascade!(tail, next, new Set(), new Set([tail.id])),
  ).toContain(cap.id)
})

test('agent operations bundle for a headless host without editor or viewer dependencies', async () => {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.resolve('@pascal-app/nodes/agent-operations'))],
    target: 'bun',
    write: false,
    external: ['@pascal-app/core', '@pascal-app/core/*', 'three', 'zod'],
    plugins: [
      {
        name: 'headless-operation-boundary',
        setup(build) {
          build.onResolve(
            { filter: /^(@pascal-app\/(viewer|editor)(\/|$)|react(-dom)?($|\/)|@react-three\/)/ },
            (args) => {
              throw new Error(`Headless operations cannot load ${args.path} from ${args.importer}`)
            },
          )
        },
      },
    ],
  })
  expect(result.success).toBe(true)
})

test('duct offsets detach every split section from the original wall', () => {
  const duct = run({
    wallAttachment: {
      wallId: 'wall_offset_host',
      side: 'front',
      startUV: [0, 0],
      endUV: [6, 0],
      offset: 0.1,
    },
  })
  const nodes = scene(duct)
  const before = JSON.stringify(nodes)
  const outcome = edit(
    nodes,
    { nodeId: duct.id, action: 'offset', from: 1, to: 4, offset: 1 },
    context,
  )
  const patch = outcome.changes!.update!.find((entry) => entry.id === duct.id)!.data
  const sections = [
    { ...duct, ...patch },
    ...outcome
      .changes!.create!.map((entry) => entry.node)
      .filter((node) => node.type === 'duct-segment'),
  ]
  expect(sections).toHaveLength(5)
  for (const section of sections) {
    expect(section.wallAttachment).toBeUndefined()
    expect(section.hangerOverrides).toBeUndefined()
  }
  expect(JSON.stringify(nodes)).toBe(before)
})

test('duct offsets refuse custom hangers and hosted children without partial edits', () => {
  const custom = run({ hangerOverrides: { '0:0': { fraction: 0.5 } } })
  const hosted = run()
  const child = DuctFittingNode.parse({ parentId: hosted.id })
  for (const [duct, nodes] of [
    [custom, scene(custom)],
    [hosted, scene(hosted, child)],
  ] as const) {
    const before = JSON.stringify(nodes)
    expect(() =>
      edit(nodes, { nodeId: duct.id, action: 'offset', from: 1, to: 4, offset: 1 }, context),
    ).toThrow('Remove custom hanger adjustments or hosted children')
    expect(JSON.stringify(nodes)).toBe(before)
  }
})
