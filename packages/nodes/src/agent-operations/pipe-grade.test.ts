import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  LevelNode,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  registerNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { pipeFittingDefinition, pipeSegmentDefinition } from '@pascal-app/nodes'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
})
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  restore()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})
const level = LevelNode.parse({})
const makePipe = (
  path: number[][] = [
    [0, 2, 0],
    [4, 1.92, 0],
  ],
) => PipeSegmentNode.parse({ parentId: level.id, path, diameter: 2, system: 'waste' })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((node) => [node.id, node]))
const edit = builtinAgentOperations.pipe_grade
const context = { activeLevelId: level.id }
function editedPath(pipe: PipeSegmentNode, input: Parameters<typeof edit>[1]) {
  const result = edit(scene(pipe), input, context)
  return (result.changes!.update!.find((entry) => entry.id === pipe.id)!.data as PipeSegmentNode)
    .path
}

test('changing grade can preserve either endpoint elevation', () => {
  const pipe = makePipe()
  const start = editedPath(pipe, {
    nodeId: pipe.id,
    action: 'grade',
    gradePercent: 3,
    anchor: 'start',
  })
  expect(start[0]![1]).toBe(2)
  expect(start[1]![1]).toBeCloseTo(1.88)
  const end = editedPath(pipe, { nodeId: pipe.id, action: 'grade', gradePercent: 3, anchor: 'end' })
  expect(end[1]![1]).toBeCloseTo(1.92)
  expect(end[0]![1]).toBeCloseTo(2.04)
})
test('reversing downhill flow changes elevation rather than only a label', () => {
  const pipe = makePipe()
  expect(
    editedPath(pipe, { nodeId: pipe.id, action: 'grade', gradePercent: 2, flow: 'reverse' })[1]![1],
  ).toBeCloseTo(2.08)
})
test('extending either endpoint preserves signed grade and the opposite elevation', () => {
  const pipe = makePipe()
  const end = editedPath(pipe, {
    nodeId: pipe.id,
    action: 'endpoint',
    pointIndex: 1,
    point: [8, 1.92, 0],
  })
  expect(end[1]![1]).toBeCloseTo(1.84)
  const start = editedPath(pipe, {
    nodeId: pipe.id,
    action: 'endpoint',
    pointIndex: 0,
    point: [-4, 2, 0],
  })
  expect(start[0]![1]).toBeCloseTo(2.08)
  expect(start[1]![1]).toBe(1.92)
})
test('elevation edits translate every vertex without flattening mixed grades', () => {
  const pipe = makePipe([
    [0, 2, 0],
    [2, 1.96, 0],
    [2, 1.96, 3],
  ])
  const path = editedPath(pipe, { nodeId: pipe.id, action: 'elevation', elevation: 4 })
  expect(path).toEqual([
    [0, 4, 0],
    [2, 3.96, 0],
    [2, 3.96, 3],
  ])
})
test('polyline edits preserve each leg grade, rather than averaging the whole run', () => {
  const pipe = makePipe([
    [0, 2, 0],
    [2, 1.96, 0],
    [2, 1.87, 3],
  ])
  const path = editedPath(pipe, {
    nodeId: pipe.id,
    action: 'endpoint',
    pointIndex: 1,
    point: [4, 1.96, 0],
  })
  expect(path[1]![1]).toBeCloseTo(1.92)
  expect((path[1]![1] - path[2]![1]) / Math.hypot(2, 3)).toBeCloseTo(0.03)
})
test('vertical legs retain their height when grading a mixed route', () => {
  const pipe = makePipe([
    [0, 2, 0],
    [4, 2, 0],
    [4, 0, 0],
  ])
  const path = editedPath(pipe, { nodeId: pipe.id, action: 'grade', gradePercent: 2 })
  expect(path[1]![1]).toBeCloseTo(1.92)
  expect(path[2]![1]).toBeCloseTo(-0.08)
})
test('tilting a vertical stack is refused', () => {
  const pipe = makePipe([
    [0, 2, 0],
    [0, 0, 0],
  ])
  expect(() =>
    editedPath(pipe, { nodeId: pipe.id, action: 'endpoint', pointIndex: 1, point: [1, 0, 0] }),
  ).toThrow('vertical stack')
})
test('collapsed horizontal leg and invalid grade are refused without scene mutation', () => {
  const pipe = makePipe()
  const nodes = scene(pipe)
  const before = JSON.stringify(nodes)
  expect(() =>
    edit(nodes, { nodeId: pipe.id, action: 'endpoint', pointIndex: 1, point: [0, 2, 0] }, context),
  ).toThrow()
  expect(() =>
    edit(nodes, { nodeId: pipe.id, action: 'grade', gradePercent: NaN }, context),
  ).toThrow()
  expect(JSON.stringify(nodes)).toBe(before)
})
test('turning a connected collar is refused instead of silently breaking it', () => {
  const pipe = makePipe()
  const fitting = PipeFittingNode.parse({
    parentId: level.id,
    fittingType: 'elbow',
    position: [4.14, 1.92, 0],
    diameter: 2,
  })
  const ports = pipeFittingDefinition.ports!(fitting)
  const inlet = ports[0]!
  pipe.path[1] = [...inlet.position]
  expect(() =>
    edit(scene(pipe, fitting), { nodeId: pipe.id, action: 'grade', gradePercent: 5 }, context),
  ).toThrow('collar')
})
test('plan-view editing previews grade without writing the scene until commit', () => {
  const pipe = makePipe()
  const previous = useScene.getState().nodes
  useScene.setState({ nodes: scene(pipe) })
  try {
    const affordance = pipeSegmentDefinition.floorplanAffordances!['move-path-point']!
    const session = affordance.start({
      node: pipe,
      nodes: scene(pipe),
      payload: { pointIndex: 1 },
      initialPlanPoint: [4, 0],
    })
    session.apply({
      planPoint: [8, 0],
      modifiers: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
    })
    expect(useScene.getState().nodes[pipe.id]).toEqual(pipe)
    expect(session.canCommit()).toBe(true)
    session.commit!()
    const result = useScene.getState().nodes[pipe.id] as PipeSegmentNode
    expect(result.path[1]![1]).toBeCloseTo(1.84)
  } finally {
    useLiveNodeOverrides.getState().clear(pipe.id)
    useScene.setState({ nodes: previous })
  }
})

test('grade edits carry end caps and keep both collars coincident', () => {
  const pipe = makePipe([
    [0, 2, 0],
    [4, 2, 0],
  ])
  const cap = PipeFittingNode.parse({
    parentId: level.id,
    fittingType: 'end-cap',
    position: [4.025, 2, 0],
    diameter: 2,
  })
  cap.position[0] += 4 - pipeFittingDefinition.ports!(cap)[0]!.position[0]
  const result = edit(
    scene(pipe, cap),
    { nodeId: pipe.id, action: 'grade', gradePercent: 2 },
    context,
  )
  const path = (
    result.changes!.update!.find((entry) => entry.id === pipe.id)!.data as PipeSegmentNode
  ).path
  const capUpdate = result.changes!.update!.find((entry) => entry.id === cap.id)!
  const nextCap = { ...cap, ...capUpdate.data } as typeof cap
  const port = pipeFittingDefinition.ports!(nextCap)[0]!
  expect(port.position[0]).toBeCloseTo(path[1]![0])
  expect(port.position[1]).toBeCloseTo(path[1]![1])
})

test('grade tool works through MCP and undoes as one edit', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { SceneBridge } = await import('@pascal-app/mcp/bridge')
  const { createSceneOperations } = await import('@pascal-app/mcp/operations')
  const { registerOperationTool } = await import('@pascal-app/mcp/tools/shared-tools')
  const { builtinAgentTools } = await import('@pascal-app/nodes/agent-tools')
  const pipe = makePipe()
  const bridge = new SceneBridge()
  bridge.setScene(scene({ ...level, children: [pipe.id] }, pipe), [level.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'pipe-grade-test', version: '0.0.0' })
  registerOperationTool(server, createSceneOperations({ bridge }), {
    contract: builtinAgentTools.tools.find((tool) => tool.name === 'pipe_grade')!,
    operation: edit,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  const client = new Client({ name: 'pipe-grade-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const result = await client.callTool({
      name: 'pipe_grade',
      arguments: { nodeId: pipe.id, action: 'grade', gradePercent: 3 },
    })
    expect(result.isError).not.toBe(true)
    expect((bridge.getNodes()[pipe.id] as PipeSegmentNode).path[1]![1]).toBeCloseTo(1.88)
    bridge.undo()
    expect(bridge.getNodes()[pipe.id]?.path).toEqual(pipe.path)
  } finally {
    await client.close()
    await server.close()
  }
})
