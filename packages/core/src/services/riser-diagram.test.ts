import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { buildRiserDiagram, projectIso } from './riser-diagram'

type Point = [number, number, number]

let nextId = 0
function makeNode(type: string, fields: Record<string, unknown>): AnyNode {
  nextId += 1
  return { id: `${type}_${nextId}`, type, object: 'node', parentId: null, ...fields } as AnyNode
}
function sceneOf(...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('projectIso', () => {
  test('higher elevation maps to smaller screen Y', () => {
    const [, lowY] = projectIso(0, 0, 0)
    const [, highY] = projectIso(0, 2, 0)
    expect(highY).toBeLessThan(lowY)
  })
})

describe('buildRiserDiagram', () => {
  test('null when no DWV nodes', () => {
    const wall = makeNode('wall', {})
    expect(buildRiserDiagram(sceneOf(wall))).toBeNull()
  })

  test('classifies a vertical stack vs a sloped horizontal drain', () => {
    const stack = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [0, 3, 0],
      ] as Point[],
      diameter: 3,
      system: 'vent',
    })
    const drain = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [3, -0.06, 0],
      ] as Point[],
      diameter: 2,
      system: 'waste',
    })
    const diagram = buildRiserDiagram(sceneOf(stack, drain))!
    const stackLine = diagram.lines.find((l) => l.nodeId === stack.id)!
    const drainLine = diagram.lines.find((l) => l.nodeId === drain.id)!
    expect(stackLine.vertical).toBe(true)
    expect(drainLine.vertical).toBe(false)
  })

  test('emits a vent-termination marker for a vent run', () => {
    const vent = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [0, 3, 0],
      ] as Point[],
      diameter: 2,
      system: 'vent',
    })
    const diagram = buildRiserDiagram(sceneOf(vent))!
    expect(diagram.markers.some((m) => m.kind === 'vent-termination')).toBe(true)
  })

  test('labels traps', () => {
    const trap = makeNode('pipe-trap', {
      position: [1, 0, 0] as Point,
      diameter: 1.5,
    })
    const diagram = buildRiserDiagram(sceneOf(trap))!
    expect(diagram.markers.some((m) => m.kind === 'trap')).toBe(true)
  })
})
