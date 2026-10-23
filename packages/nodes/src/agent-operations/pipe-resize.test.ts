import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  LevelNode,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  PipeTrapNode,
  registerNode,
} from '@pascal-app/core'
import { pipeFittingDefinition, pipeSegmentDefinition, pipeTrapDefinition } from '@pascal-app/nodes'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
  registerNode(pipeTrapDefinition)
})
afterEach(() => restore())
const level = LevelNode.parse({})
const pipe = (path: number[][], diameter = 2) =>
  PipeSegmentNode.parse({ parentId: level.id, path, diameter })
const fitting = (fittingType: PipeFittingNode['fittingType'], rotation = [0, 0, 0]) =>
  PipeFittingNode.parse({ parentId: level.id, fittingType, rotation })
const ports = (node: AnyNode) => nodeRegistry.get(node.type)!.ports!(node)
const scene = (...nodes: AnyNode[]) => Object.fromEntries([level, ...nodes].map((n) => [n.id, n]))
const edit = builtinAgentOperations.pipe_resize
const context = { activeLevelId: level.id }
const attached = (f: PipeFittingNode, portIndex: number, length = 3) => {
  const p = ports(f)[portIndex]!
  return pipe([[...p.position], p.position.map((v, i) => v + p.direction[i]! * length)])
}
const nextNode = (node: AnyNode, result: ReturnType<typeof edit>) =>
  ({ ...node, ...result.changes?.update?.find((entry) => entry.id === node.id)?.data }) as AnyNode

test('branch resize carries a sloped coupling and both runs without changing grades', () => {
  const joint = fitting('coupling', [0, 0, -Math.atan(0.02)])
  const a = attached(joint, 0),
    b = attached(joint, 1)
  const result = edit(scene(a, b, joint), { nodeId: a.id, diameter: 4, scope: 'branch' }, context)
  expect(result.result.runs).toBe(2)
  expect(result.changes!.create).toHaveLength(0)
  const newJoint = nextNode(joint, result)
  for (const [i, run] of [a, b].entries()) {
    const next = nextNode(run, result) as PipeSegmentNode
    expect(next.diameter).toBe(4)
    expect(next.path[0]).toEqual([...ports(newJoint)[i]!.position])
    expect(next.path[1]).toEqual(run.path[1])
    const grade = (p: PipeSegmentNode) =>
      (p.path[0]![1] - p.path[1]![1]) / Math.abs(p.path[0]![0] - p.path[1]![0])
    expect(grade(next)).toBeCloseTo(grade(run), 10)
  }
})
test('segment scope inserts a reducer while leaving its connected fitting and neighbor fixed', () => {
  const joint = fitting('coupling', [0, 0, -Math.atan(0.02)])
  const a = attached(joint, 0),
    b = attached(joint, 1)
  const result = edit(scene(a, b, joint), { nodeId: a.id, diameter: 4 }, context)
  expect(result.result.runs).toBe(1)
  expect(result.changes!.create).toHaveLength(1)
  expect(nextNode(joint, result)).toEqual(joint)
  expect(nextNode(b, result)).toEqual(b)
  const reducer = result.changes!.create![0]!.node
  const reducerPorts = ports(reducer)
  for (let i = 0; i < 3; i++)
    expect(reducerPorts[0]!.position[i]).toBeCloseTo(ports(joint)[0]!.position[i]!, 10)
  expect(reducerPorts[1]!.position).toEqual((nextNode(a, result) as PipeSegmentNode).path[0]!)
  expect(reducerPorts.map((p) => p.diameter)).toEqual([2, 4])
})
test('branch traversal stops at junctions and existing size changes', () => {
  for (const kind of ['wye', 'sanitary-tee', 'cross', 'reducer'] as const) {
    const joint = fitting(kind)
    const a = attached(joint, 0),
      b = attached(joint, 1)
    const result = edit(scene(a, b, joint), { nodeId: a.id, diameter: 4, scope: 'branch' }, context)
    expect(result.result.runs).toBe(1)
    expect(nextNode(joint, result)).toEqual(joint)
    expect(nextNode(b, result)).toEqual(b)
    expect(result.changes!.create).toHaveLength(1)
  }
})
test('a fitting beside a different-size pipe stays fixed', () => {
  const joint = fitting('coupling'),
    a = attached(joint, 0),
    b = { ...attached(joint, 1), diameter: 3 }
  const result = edit(scene(a, b, joint), { nodeId: a.id, diameter: 4, scope: 'branch' }, context)
  expect(nextNode(joint, result)).toEqual(joint)
  expect(nextNode(b, result)).toEqual(b)
  expect(result.changes!.create).toHaveLength(1)
})
test('resizing caps keeps pipe endpoints fixed', () => {
  const cap = fitting('end-cap', [0, 0, -Math.atan(0.02)]),
    run = attached(cap, 0)
  const result = edit(scene(run, cap), { nodeId: run.id, diameter: 8 }, context)
  expect(result.changes!.create).toHaveLength(0)
  expect((nextNode(run, result) as PipeSegmentNode).path).toEqual(run.path)
  const nextCap = nextNode(cap, result)
  expect((nextCap as PipeFittingNode).diameter).toBe(8)
  ports(cap)[0]!.position.forEach((v, i) => {
    expect(ports(nextCap)[0]!.position[i]).toBeCloseTo(v, 10)
  })
})
test('short runs and ambiguous connections are refused without mutation', () => {
  const joint = fitting('coupling'),
    short = attached(joint, 0, 0.15)
  const nodes = scene(joint, short),
    before = JSON.stringify(nodes)
  expect(() => edit(nodes, { nodeId: short.id, diameter: 8 }, context)).toThrow('straight pipe')
  expect(JSON.stringify(nodes)).toBe(before)
  const a = attached(joint, 0),
    duplicate = attached(joint, 0)
  expect(() => edit(scene(joint, a, duplicate), { nodeId: a.id, diameter: 4 }, context)).toThrow(
    'overlapping',
  )
})
test('same size is a no-op and invalid diameters are refused', () => {
  const run = pipe([
    [0, 2, 0],
    [3, 1.94, 0],
  ])
  expect(edit(scene(run), { nodeId: run.id, diameter: 2 }, context).changes).toBeUndefined()
  for (const diameter of [NaN, Infinity, 0, 9])
    expect(() => edit(scene(run), { nodeId: run.id, diameter }, context)).toThrow()
})

test('trap collars stay fixed and receive a reducer', () => {
  const trap = PipeTrapNode.parse({ parentId: level.id })
  const collar = ports(trap)[1]!
  const run = pipe([
    [...collar.position],
    collar.position.map((v, i) => v + collar.direction[i]! * 3),
  ])
  const result = edit(scene(run, trap), { nodeId: run.id, diameter: 4, scope: 'branch' }, context)
  expect(nextNode(trap, result)).toEqual(trap)
  expect(result.changes!.create).toHaveLength(1)
  ports(result.changes!.create![0]!.node)[0]!.position.forEach((v, i) => {
    expect(v).toBeCloseTo(collar.position[i]!, 10)
  })
})
test('vertical stacks resize without tilting and branch traversal includes elbows', () => {
  for (const kind of ['coupling', 'elbow'] as const) {
    const joint = fitting(kind, [0, 0, Math.PI / 2])
    const a = attached(joint, 0),
      b = attached(joint, 1)
    const result = edit(scene(a, b, joint), { nodeId: a.id, diameter: 4, scope: 'branch' }, context)
    expect(result.result.runs).toBe(2)
    const next = nextNode(a, result) as PipeSegmentNode
    expect(next.path[0]![0]).toBeCloseTo(next.path[1]![0], 10)
    expect(next.path[0]![2]).toBeCloseTo(next.path[1]![2], 10)
    expect(result.changes!.create).toHaveLength(0)
  }
})

test('resize tool works through MCP and undoes as one edit', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { SceneBridge } = await import('@pascal-app/mcp/bridge')
  const { createSceneOperations } = await import('@pascal-app/mcp/operations')
  const { registerOperationTool } = await import('@pascal-app/mcp/tools/shared-tools')
  const { builtinAgentTools } = await import('@pascal-app/nodes/agent-tools')
  const joint = fitting('coupling')
  const run = attached(joint, 0)
  const bridge = new SceneBridge()
  bridge.setScene(scene({ ...level, children: [run.id, joint.id] }, run, joint), [level.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'pipe-resize-test', version: '0.0.0' })
  registerOperationTool(server, createSceneOperations({ bridge }), {
    contract: builtinAgentTools.tools.find((tool) => tool.name === 'pipe_resize')!,
    operation: edit,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  const client = new Client({ name: 'pipe-resize-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const result = await client.callTool({
      name: 'pipe_resize',
      arguments: { nodeId: run.id, diameter: 4 },
    })
    expect(result.isError).not.toBe(true)
    expect((bridge.getNodes()[run.id] as PipeSegmentNode).diameter).toBe(4)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'pipe-fitting'),
    ).toHaveLength(2)
    bridge.undo()
    expect(bridge.getNodes()[run.id]).toEqual(run)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'pipe-fitting'),
    ).toHaveLength(1)
  } finally {
    await client.close()
    await server.close()
  }
})
