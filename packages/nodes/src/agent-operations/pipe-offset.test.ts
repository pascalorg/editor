import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  LevelNode,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  registerNode,
} from '@pascal-app/core'
import { pipeFittingDefinition, pipeSegmentDefinition } from '@pascal-app/nodes'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
})
afterEach(() => restore())
const level = LevelNode.parse({})
const makePipe = (grade = 0.02) =>
  PipeSegmentNode.parse({
    parentId: level.id,
    path: [
      [0, 2, 0],
      [6, 2 - 10 * grade, 8],
    ],
    diameter: 4,
    pipeMaterial: 'cast-iron',
    autoHangers: true,
  })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((node) => [node.id, node]))
const edit = builtinAgentOperations.pipe_offset
const context = { activeLevelId: level.id }
const request = (pipe: PipeSegmentNode, offset = 0.5) => ({
  nodeId: pipe.id,
  from: 2,
  to: 8,
  offset,
})
function nextScene(before: Record<string, AnyNode>, outcome: ReturnType<typeof edit>) {
  const next = { ...before }
  for (const entry of outcome.changes?.update ?? [])
    next[entry.id] = { ...next[entry.id], ...entry.data } as AnyNode
  for (const entry of outcome.changes?.create ?? []) next[entry.node.id] = entry.node
  return next
}
const gradeOf = (run: PipeSegmentNode) =>
  (run.path[0]![1] - run.path[1]![1]) /
  Math.hypot(run.path[1]![0] - run.path[0]![0], run.path[1]![2] - run.path[0]![2])

for (const grade of [0, 0.02, -0.02])
  for (const offset of [0.5, -0.5]) {
    test(`offset ${offset} preserves grade ${grade} and joins every fitting collar`, () => {
      const pipe = makePipe(grade),
        before = scene(pipe),
        snapshot = JSON.stringify(before)
      const outcome = edit(before, request(pipe, offset), context)
      expect(JSON.stringify(before)).toBe(snapshot)
      const next = nextScene(before, outcome)
      const runs = Object.values(next).filter(
        (node): node is PipeSegmentNode => node.type === 'pipe-segment',
      )
      const fittings = Object.values(next).filter(
        (node): node is PipeFittingNode => node.type === 'pipe-fitting',
      )
      expect(runs).toHaveLength(5)
      expect(fittings).toHaveLength(4)
      expect(runs[0]!.path[0]).toEqual(pipe.path[0])
      expect(runs.at(-1)!.path.at(-1)).toEqual(pipe.path[1])
      for (const index of [0, 2, 4]) expect(gradeOf(runs[index]!)).toBeCloseTo(grade, 10)
      for (const run of runs) {
        expect(run.diameter).toBe(4)
        expect(run.pipeMaterial).toBe('cast-iron')
        expect(run.autoHangers).toBe(true)
      }
      const runPorts = runs.flatMap((run) => pipeSegmentDefinition.ports!(run))
      for (const fitting of fittings) {
        expect(fitting.parentId).toBe(level.id)
        for (const port of pipeFittingDefinition.ports!(fitting)) {
          const mates = runPorts.filter(
            (other) => Math.hypot(...port.position.map((v, i) => v - other.position[i]!)) < 1e-8,
          )
          expect(mates).toHaveLength(1)
          expect(
            port.direction.reduce((sum, v, i) => sum + v * mates[0]!.direction[i]!, 0),
          ).toBeCloseTo(-1, 10)
        }
      }
      const center = runs[2]!.path[0]!
      const distance = Math.hypot(center[0], center[2])
      expect(center[1] - (2 - distance * grade)).toBeCloseTo(offset, 10)
      expect(outcome.result.uphill).toBe(true)
    })
  }
test('fixed caps keep their geometry and the far cap follows ownership to the new tail', () => {
  const pipe = makePipe()
  const cap = PipeFittingNode.parse({
    parentId: level.id,
    fittingType: 'end-cap',
    position: [6, 1.8, 8],
    metadata: { automaticRunEndCapOwnerId: pipe.id, automaticRunEndCapEndpoint: 'end' },
  })
  const before = scene(pipe, cap),
    outcome = edit(before, request(pipe), context),
    next = nextScene(before, outcome)
  const nextCap = next[cap.id] as PipeFittingNode
  expect(nextCap.position).toEqual(cap.position)
  expect(nextCap.rotation).toEqual(cap.rotation)
  const tail = next[nextCap.metadata.automaticRunEndCapOwnerId as string] as PipeSegmentNode
  expect(tail.id).not.toBe(pipe.id)
  expect(tail.path.at(-1)).toEqual(pipe.path.at(-1))
  expect(
    pipeSegmentDefinition.parametrics!.onDeleteCascade!(tail, next, new Set(), new Set([tail.id])),
  ).toContain(cap.id)
})
test('invalid, vertical, polyline and cramped offsets refuse without edits', () => {
  const pipe = makePipe(),
    before = scene(pipe),
    snapshot = JSON.stringify(before)
  for (const patch of [
    { offset: 0 },
    { offset: NaN },
    { from: -1 },
    { to: 11 },
    { from: 7 },
    { offset: 0.01 },
    { from: 0.01 },
    { from: 8, to: 2 },
  ]) {
    expect(() => edit(before, { ...request(pipe), ...patch }, context)).toThrow()
    expect(JSON.stringify(before)).toBe(snapshot)
  }
  for (const path of [
    [
      [0, 0, 0],
      [0, 3, 0],
    ],
    [
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
    ],
  ]) {
    const other = PipeSegmentNode.parse({ path })
    expect(() => edit(scene(other), request(other), context)).toThrow()
  }
})
test('custom hanger positions are not silently discarded by a split', () => {
  const pipe = { ...makePipe(), hangerOverrides: { '0': { fraction: 0.5 } } }
  expect(() => edit(scene(pipe), request(pipe), context)).toThrow('hanger')
})
test('vent offsets do not report a waste-flow warning', () => {
  const pipe = { ...makePipe(), system: 'vent' as const }
  expect(edit(scene(pipe), request(pipe), context).result.uphill).toBe(false)
})

test('offset tool works through MCP and undoes as one edit', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { SceneBridge } = await import('@pascal-app/mcp/bridge')
  const { createSceneOperations } = await import('@pascal-app/mcp/operations')
  const { registerOperationTool } = await import('@pascal-app/mcp/tools/shared-tools')
  const { builtinAgentTools } = await import('@pascal-app/nodes/agent-tools')
  const run = makePipe()
  const bridge = new SceneBridge()
  bridge.setScene(scene({ ...level, children: [run.id] }, run), [level.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'pipe-offset-test', version: '0.0.0' })
  registerOperationTool(server, createSceneOperations({ bridge }), {
    contract: builtinAgentTools.tools.find((tool) => tool.name === 'pipe_offset')!,
    operation: edit,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  const client = new Client({ name: 'pipe-offset-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const result = await client.callTool({
      name: 'pipe_offset',
      arguments: request(run),
    })
    expect(result.isError).not.toBe(true)
    expect((bridge.getNodes()[run.id] as PipeSegmentNode).path[0]).toEqual(run.path[0])
    expect(
      Object.values(bridge.getNodes()).filter((node) => node.type === 'pipe-fitting'),
    ).toHaveLength(4)
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
