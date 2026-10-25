import { afterAll, expect, test } from 'bun:test'
import {
  DuctSegmentNode,
  DuctTerminalNode,
  LevelNode,
  type NodePort,
  nodeRegistry,
  portConnection,
  registerNode,
  snapPlanarPortPosition,
} from '@pascal-app/core'
import {
  ductSegmentDefinition,
  ductTerminalDefinition,
  resolveTerminalPortPlacement,
  terminalProfileForPort,
} from '../index'

const node = DuctTerminalNode.parse({ collarDiameter: 8 })
const target: NodePort = {
  id: 'end',
  position: [0.2, 0, 0],
  direction: [0, 1, 0],
  diameter: 8,
  system: 'supply',
}

test('terminal placement prefers a compatible port over a nearer wrong system or size', () => {
  const near = { ...target, position: [0, 0, 0] as const }
  const placed = resolveTerminalPortPlacement(node, [0, 0, 0], 0, [
    { ...near, system: 'return' },
    { ...near, diameter: 6 },
    target,
  ])!
  const collar = ductTerminalDefinition.ports!({ ...node, ...placed, rotation: placed.yaw })[0]!
  expect(portConnection(collar, target).status).toBe('match')
  expect(placed.position[0]).toBe(0.2)
})

test('terminal snaps on supported floor, wall and ceiling axes but rejects diagonal ports', () => {
  for (const direction of [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ] as const) {
    const port = { ...target, direction }
    const placed = resolveTerminalPortPlacement(node, [0, 0, 0], 0, [port])!
    expect(placed).not.toBeNull()
    const collar = ductTerminalDefinition.ports!({ ...node, ...placed, rotation: placed.yaw })[0]!
    expect(portConnection(collar, port).status).toBe('match')
  }
  expect(
    resolveTerminalPortPlacement(node, [0, 0, 0], 0, [{ ...target, direction: [1, 1, 0] }]),
  ).toBeNull()
})

test('explicit matching changes terminal system and profile without mutating the input', () => {
  const port = { ...target, system: 'return', shape: 'rect' as const, width: 12, height: 8 }
  expect(resolveTerminalPortPlacement(node, [0, 0, 0], 0, [port])).toBeNull()
  const patch = terminalProfileForPort(node, port)!
  const matched = DuctTerminalNode.parse({ ...node, ...patch })
  expect(matched.terminalType).toBe('return-grille')
  expect(matched.collarWidth).toBe(12)
  expect(matched.collarHeight).toBe(8)
  expect(node.terminalType).toBe('supply-register')
  expect(resolveTerminalPortPlacement(matched, [0, 0, 0], 0, [port])).not.toBeNull()
  expect(terminalProfileForPort(node, { ...port, width: undefined })).toBeNull()
  expect(terminalProfileForPort(node, { ...port, system: 'waste' })).toBeNull()
})

const restoreRegistry = nodeRegistry._snapshot()
afterAll(restoreRegistry)
registerNode(ductTerminalDefinition)
registerNode(ductSegmentDefinition)

test('planar movement snaps only to compatible ports at the same height and level', () => {
  const level = LevelNode.parse({ level: 0 })
  const upper = LevelNode.parse({ level: 1 })
  const terminal = DuctTerminalNode.parse({
    parentId: level.id,
    collarDiameter: 8,
    position: [0, 0.12, 0],
  })
  const run = DuctSegmentNode.parse({
    parentId: level.id,
    diameter: 8,
    path: [
      [0.3, -1, 0],
      [0.3, 0, 0],
    ],
  })
  const nodes = { [level.id]: level, [upper.id]: upper, [terminal.id]: terminal, [run.id]: run }
  const snap = (candidate = run) =>
    snapPlanarPortPosition(
      terminal,
      [0.1, 0],
      { ...nodes, [run.id]: candidate },
      { systems: ['supply', 'return'] },
    )
  expect(snap()).toEqual([0.3, 0])
  expect(snap({ ...run, system: 'return' })).toBeNull()
  expect(snap({ ...run, diameter: 6 })).toBeNull()
  expect(snap({ ...run, parentId: upper.id })).toBeNull()
  expect(
    snap({
      ...run,
      path: [
        [0.3, 1, 0],
        [0.3, 2, 0],
      ],
    }),
  ).toBeNull()
  expect(
    snap({
      ...run,
      path: [
        [0.3, 1, 0],
        [0.3, 0, 0],
      ],
    }),
  ).toBeNull()
})
