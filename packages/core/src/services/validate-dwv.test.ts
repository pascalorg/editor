import { describe, expect, test } from 'bun:test'
import type { AnyNodeDefinition, NodePort } from '../registry'
import { registerNode } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'
import { validateDwv } from './validate-dwv'

type Point = [number, number, number]

// The validator reads node fields directly + buildPortComponents (which
// consults def.ports), so register stub port-providers for the DWV kinds
// it groups by. Mirrors the system-graph test's approach.
function stubDef(kind: string, ports: (node: AnyNode) => NodePort[]): void {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: {},
    category: 'utility',
    defaults: () => ({}),
    capabilities: {},
    ports,
  } as unknown as AnyNodeDefinition)
}

stubDef('pipe-segment', (node) => {
  const path = (node as unknown as { path: Point[] }).path
  const diameter = (node as unknown as { diameter: number }).diameter
  const system = (node as unknown as { system: string }).system
  return [
    { id: 'start', position: path[0]!, direction: [-1, 0, 0], diameter, system },
    {
      id: 'end',
      position: path[path.length - 1]!,
      direction: [1, 0, 0],
      diameter,
      system,
    },
  ]
})
stubDef('pipe-trap', (node) => {
  const position = (node as unknown as { position: Point }).position
  return [{ id: 'inlet', position, direction: [0, 1, 0], diameter: 1.5, system: 'waste' }]
})

let nextId = 0
function makeNode(type: string, fields: Record<string, unknown>): AnyNode {
  nextId += 1
  return { id: `${type}_${nextId}`, type, object: 'node', parentId: null, ...fields } as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

/** A waste run from a→b. Drop the end Y to slope it. */
function waste(path: Point[], diameter = 2): AnyNode {
  return makeNode('pipe-segment', { path, diameter, system: 'waste' })
}

const QUARTER_PER_FOOT = 1 / 48

describe('validateDwv — slope', () => {
  test('flags a flat waste run', () => {
    const run = waste([
      [0, 0, 0],
      [3, 0, 0], // dead level
    ])
    const findings = validateDwv(sceneOf(run))
    expect(findings.some((f) => f.code === 'slope-too-flat')).toBe(true)
  })

  test('passes a run sloped at quarter-inch per foot', () => {
    const drop = 3 * QUARTER_PER_FOOT
    const run = waste([
      [0, 0, 0],
      [3, -drop, 0],
    ])
    const findings = validateDwv(sceneOf(run))
    expect(findings.some((f) => f.code === 'slope-too-flat')).toBe(false)
  })

  test('flags an over-steep run (siphoning risk)', () => {
    // 2" pipe, max slope = 2/12 ≈ 0.167; drop 2m over 1m horizontal.
    const run = waste([
      [0, 0, 0],
      [1, -2, 0],
    ])
    const findings = validateDwv(sceneOf(run))
    expect(findings.some((f) => f.code === 'slope-too-steep')).toBe(true)
  })

  test('ignores vents (level is fine)', () => {
    const vent = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [0, 3, 0],
      ] as Point[],
      diameter: 2,
      system: 'vent',
    })
    const findings = validateDwv(sceneOf(vent))
    expect(findings.length).toBe(0)
  })
})

describe('validateDwv — trap arm', () => {
  test('flags an over-long trap arm', () => {
    const trap = makeNode('pipe-trap', {
      position: [0, 0, 0] as Point,
      diameter: 1.5, // max arm 42in = 1.067m
      armLengthM: 2, // way over
    })
    const findings = validateDwv(sceneOf(trap))
    expect(findings.some((f) => f.code === 'trap-arm-too-long')).toBe(true)
  })

  test('passes a trap arm within the limit', () => {
    const trap = makeNode('pipe-trap', {
      position: [0, 0, 0] as Point,
      diameter: 2, // max arm 60in = 1.524m
      armLengthM: 1,
    })
    const findings = validateDwv(sceneOf(trap))
    expect(findings.some((f) => f.code === 'trap-arm-too-long')).toBe(false)
  })
})
