import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  PipeSegmentNode,
  registerNode,
  WallNode,
} from '@pascal-app/core'
import { pipeSegmentDefinition } from '../pipe-segment/definition'
import { checkDistributionSystems } from './system-checks'

registerNode(pipeSegmentDefinition)
const scene = (...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(nodes.map((node) => [node.id, node]))

test('checks expose open ends, disconnected branches and drainage findings', () => {
  const a = PipeSegmentNode.parse({
    path: [
      [0, 1, 0],
      [3, 1, 0],
    ],
  })
  const b = PipeSegmentNode.parse({
    path: [
      [10, 1, 0],
      [13, 1, 0],
    ],
  })
  const findings = checkDistributionSystems(scene(a, b))
  expect(findings.filter((finding) => finding.code === 'open-end')).toHaveLength(4)
  expect(findings.some((finding) => finding.code === 'disconnected-branch')).toBe(true)
  expect(findings.some((finding) => finding.code === 'slope-too-flat')).toBe(true)
})
test('coincident different systems are visible as incompatible', () => {
  const a = PipeSegmentNode.parse({
    path: [
      [0, 1, 0],
      [3, 1, 0],
    ],
  })
  const b = PipeSegmentNode.parse({
    system: 'vent',
    path: [
      [3, 1, 0],
      [5, 1, 0],
    ],
  })
  expect(
    checkDistributionSystems(scene(a, b)).some((finding) => finding.code === 'connection-mismatch'),
  ).toBe(true)
})
test('cross-floor joints use world elevation', () => {
  const lower = LevelNode.parse({ level: 0, height: 3 })
  const upper = LevelNode.parse({ level: 1, height: 3 })
  const a = PipeSegmentNode.parse({
    parentId: lower.id,
    path: [
      [0, 0, 0],
      [0, 3, 0],
    ],
  })
  const b = PipeSegmentNode.parse({
    parentId: upper.id,
    path: [
      [0, 0, 0],
      [0, 2, 0],
    ],
  })
  const findings = checkDistributionSystems(scene(lower, upper, a, b))
  expect(findings.filter((finding) => finding.code === 'open-end')).toHaveLength(2)
  expect(findings.some((finding) => finding.code === 'disconnected-branch')).toBe(false)
})
test('intersections include affected node ids and ignore separated heights', () => {
  const a = PipeSegmentNode.parse({
    path: [
      [0, 1, 0],
      [3, 1, 0],
    ],
  })
  const b = PipeSegmentNode.parse({
    path: [
      [1, 1, -1],
      [1, 1, 1],
    ],
  })
  const wall = WallNode.parse({ start: [2, -1], end: [2, 1], height: 3 })
  const findings = checkDistributionSystems(scene(a, b, wall))
  expect(
    findings.some(
      (finding) => finding.code === 'possible-intersection' && finding.nodeIds.includes(b.id),
    ),
  ).toBe(true)
  expect(
    findings.some(
      (finding) => finding.code === 'possible-intersection' && finding.nodeIds.includes(wall.id),
    ),
  ).toBe(true)
  const elevated = {
    ...b,
    path: [
      [1, 5, -1],
      [1, 5, 1],
    ] as [number, number, number][],
  }
  expect(
    checkDistributionSystems(scene(a, elevated)).some(
      (finding) => finding.code === 'possible-intersection',
    ),
  ).toBe(false)
})
