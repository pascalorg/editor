import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ChimneyNode,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { roofPanelModel } from './panel-model'

describe('shared roof inspector', () => {
  test('finds accessories by hosted segment, not parent', () => {
    const segment = RoofSegmentNode.parse({})
    const roof = RoofNode.parse({ children: [segment.id] })
    const chimney = ChimneyNode.parse({ roofSegmentId: segment.id, parentId: roof.id })
    const unrelated = ChimneyNode.parse({})
    const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
      [roof, segment, chimney, unrelated].map((node) => [node.id, node]),
    )
    const rows = roofPanelModel.rows({ node: roof, nodes, update: () => {} })
    expect(rows.some((row) => row.id === chimney.id)).toBe(true)
    expect(rows.some((row) => row.id === unrelated.id)).toBe(false)
    expect(rows.some((row) => row.id === 'add-segment')).toBe(true)
  })
  test('keeps position axes and converts degrees to stored radians', () => {
    let node = RoofNode.parse({ position: [1, 2, 3] })
    const rows = roofPanelModel.rows({
      node,
      nodes: { [node.id]: node },
      update: (patch) => {
        node = { ...node, ...patch }
      },
    })
    const position = rows.find((row) => row.id === 'position-1')
    const rotation = rows.find((row) => row.id === 'rotation')
    if (position?.kind !== 'stepper' || rotation?.kind !== 'stepper')
      throw new Error('Missing transforms')
    position.onChange(4)
    rotation.onChange(90)
    expect(node.position).toEqual([1, 4, 3])
    expect(node.rotation).toBeCloseTo(Math.PI / 2)
  })
})
