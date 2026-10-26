import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  LevelNode,
  nodeRegistry,
  type PipeFittingNode,
  type PipeSegmentNode,
  PipeTrapNode,
  registerNode,
} from '@pascal-app/core'
import {
  PipeCollarInspector,
  pipeFittingDefinition,
  pipeSegmentDefinition,
  pipeTrapDefinition,
} from '@pascal-app/nodes'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
  registerNode(pipeTrapDefinition)
})
afterEach(() => restore())
const level = LevelNode.parse({})
const trap = () =>
  PipeTrapNode.parse({
    parentId: level.id,
    position: [1, 2, 3],
    rotation: Math.PI / 4,
    diameter: 1.5,
    pipeMaterial: 'abs',
  })
const scene = (...nodes: AnyNode[]) => Object.fromEntries([level, ...nodes].map((n) => [n.id, n]))
const edit = builtinAgentOperations.pipe_connect
const context = { activeLevelId: level.id }
const endpoint = (node: PipeTrapNode, portId = 'outlet', length = 2) => {
  const port = pipeTrapDefinition.ports!(node).find((p) => p.id === portId)!
  return port.position.map((v, i) => v + length * port.direction[i]!) as [number, number, number]
}
test('connects a rotated trap outlet using its profile and leaves the trap unchanged', () => {
  const node = trap(),
    nodes = scene(node),
    before = JSON.stringify(nodes)
  const result = edit(nodes, { nodeId: node.id, portId: 'outlet', end: endpoint(node) }, context)
  expect(JSON.stringify(nodes)).toBe(before)
  expect(result.changes!.update).toBeUndefined()
  const pipe = result
    .changes!.create!.map((entry) => entry.node)
    .find((n): n is PipeSegmentNode => n.type === 'pipe-segment')!
  expect(pipe.path[0]).toEqual([...pipeTrapDefinition.ports!(node)[1]!.position])
  expect(pipe.diameter).toBe(1.5)
  expect(pipe.pipeMaterial).toBe('abs')
  expect(pipe.parentId).toBe(level.id)
  expect(result.result.reducers).toBe(0)
})
test('a larger branch inserts a reducer with coincident, opposing collars', () => {
  const node = trap(),
    result = edit(
      scene(node),
      { nodeId: node.id, portId: 'outlet', end: endpoint(node), diameter: 3 },
      context,
    )
  const created = result.changes!.create!.map((entry) => entry.node)
  const reducer = created.find(
    (n): n is PipeFittingNode => n.type === 'pipe-fitting' && n.fittingType === 'reducer',
  )!
  const pipe = created.find((n): n is PipeSegmentNode => n.type === 'pipe-segment')!
  const source = pipeTrapDefinition.ports!(node)[1]!,
    ports = pipeFittingDefinition.ports!(reducer)
  for (let i = 0; i < 3; i++) {
    expect(ports[0]!.position[i]).toBeCloseTo(source.position[i]!, 10)
    expect(ports[1]!.position[i]).toBeCloseTo(pipe.path[0]![i]!, 10)
  }
  expect(ports[0]!.direction.reduce((sum, v, i) => sum + v * source.direction[i]!, 0)).toBeCloseTo(
    -1,
    10,
  )
  expect(ports.map((p) => p.diameter)).toEqual([1.5, 3])
})
test('vertical fixture-side connections follow the inlet axis', () => {
  const node = trap(),
    result = edit(
      scene(node),
      { nodeId: node.id, portId: 'inlet', end: endpoint(node, 'inlet') },
      context,
    )
  const pipe = result.changes!.create![0]!.node as PipeSegmentNode
  expect(pipe.path[0]![0]).toBe(pipe.path[1]![0])
  expect(pipe.path[0]![2]).toBe(pipe.path[1]![2])
  expect(pipe.path[1]![1] - pipe.path[0]![1]).toBeCloseTo(2)
})
test('occupied, wrong-direction, stale and cramped collars refuse atomically', () => {
  const node = trap(),
    nodes = scene(node)
  const first = edit(nodes, { nodeId: node.id, portId: 'outlet', end: endpoint(node) }, context)
  const connected = scene(node, ...first.changes!.create!.map((entry) => entry.node))
  expect(() =>
    edit(connected, { nodeId: node.id, portId: 'outlet', end: endpoint(node) }, context),
  ).toThrow('already connected')
  for (const input of [
    { nodeId: node.id, portId: 'missing', end: endpoint(node) },
    { nodeId: node.id, portId: 'outlet', end: endpoint(node, 'outlet', -2) },
    { nodeId: node.id, portId: 'outlet', end: endpoint(node, 'outlet', 0.1), diameter: 8 },
    { nodeId: node.id, portId: 'outlet', end: endpoint(node), diameter: 10 },
  ])
    expect(() => edit(nodes, input, context)).toThrow()
})
test('the inspector exposes collar size and elevation', () => {
  const node = trap()
  const html = renderToStaticMarkup(createElement(PipeCollarInspector, { node }))
  expect(html).toContain('Draw from collar')
  expect(html).toContain('1.5 in')
  expect(html).toContain('2.030 m')
})

test('collar connection works through MCP and undoes as one edit', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { SceneBridge } = await import('@pascal-app/mcp/bridge')
  const { createSceneOperations } = await import('@pascal-app/mcp/operations')
  const { registerOperationTool } = await import('@pascal-app/mcp/tools/shared-tools')
  const { builtinAgentTools } = await import('@pascal-app/nodes/agent-tools')
  const run = trap()
  const bridge = new SceneBridge()
  bridge.setScene(scene({ ...level, children: [run.id] }, run), [level.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'pipe-connect-test', version: '0.0.0' })
  registerOperationTool(server, createSceneOperations({ bridge }), {
    contract: builtinAgentTools.tools.find((tool) => tool.name === 'pipe_connect')!,
    operation: edit,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  const client = new Client({ name: 'pipe-connect-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const result = await client.callTool({
      name: 'pipe_connect',
      arguments: { nodeId: run.id, portId: 'outlet', end: endpoint(run), diameter: 3 },
    })
    expect(result.isError).not.toBe(true)
    expect(bridge.getNodes()[run.id]).toEqual(run)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'pipe-fitting'),
    ).toHaveLength(2)
    bridge.undo()
    expect(bridge.getNodes()[run.id]).toEqual(run)
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'pipe-fitting'),
    ).toHaveLength(0)
  } finally {
    await client.close()
    await server.close()
  }
})
