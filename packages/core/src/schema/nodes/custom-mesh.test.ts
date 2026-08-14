import { describe, expect, test } from 'bun:test'
import { AnyNode } from '../types'
import {
  CustomMeshNode,
  CustomMeshTopology,
  createBoxCustomMeshTopology,
  getCustomMeshFaceFrame,
  inspectCustomMeshTopology,
} from './custom-mesh'

describe('CustomMeshNode', () => {
  test('creates a valid topology-backed box by default', () => {
    const node = CustomMeshNode.parse({ name: 'Editable box' })

    expect(node.topology.vertices).toHaveLength(8)
    expect(node.topology.edges).toHaveLength(12)
    expect(node.topology.faces).toHaveLength(6)
    expect(node.children).toEqual([])
    expect(node.slots).toEqual({})
    expect(node.slotNames).toEqual({ body: 'Body' })
    expect(inspectCustomMeshTopology(node.topology)).toEqual([])
  })

  test('retains its pinned placement support', () => {
    const node = CustomMeshNode.parse({
      name: 'Supported platform',
      supportSlabId: 'ground',
    })

    expect(node.supportSlabId).toBe('ground')
  })

  test('preserves hosted items when a topology edit reparses the node', () => {
    const current = {
      ...CustomMeshNode.parse({ name: 'Platform' }),
      children: ['item_hosted'],
    }
    const topology = createBoxCustomMeshTopology()
    topology.vertices[4]!.position[1] = 3

    const updated = AnyNode.parse({ ...current, topology })

    expect(updated.type).toBe('custom-mesh')
    expect('children' in updated ? updated.children : undefined).toEqual(['item_hosted'])
  })

  test('keeps legacy material slots without stamping a body override', () => {
    const node = CustomMeshNode.parse({
      name: 'Legacy painted mesh',
      slots: { accent: 'library:metal-steel' },
    })

    expect(node.slots).toEqual({
      accent: 'library:metal-steel',
    })
    expect(node.slotNames).toEqual({ body: 'Body' })
  })

  test('rejects a face loop without a persisted boundary edge', () => {
    const topology = createBoxCustomMeshTopology()
    topology.edges = topology.edges.filter((edge) => edge.id !== 'e4')

    expect(CustomMeshTopology.safeParse(topology).success).toBe(false)
  })

  test('builds a right-handed frame from a vertical face normal', () => {
    const topology = createBoxCustomMeshTopology()
    const frame = getCustomMeshFaceFrame(topology, 'f-front')

    expect(frame).not.toBeNull()
    expect(frame!.normal[1]).toBeCloseTo(0)
    expect(frame!.yAxis[1]).toBeCloseTo(1)
    expect(
      frame!.xAxis[0] * frame!.normal[0] +
        frame!.xAxis[1] * frame!.normal[1] +
        frame!.xAxis[2] * frame!.normal[2],
    ).toBeCloseTo(0)
  })

  test('uses the edited plane normal for a sloped face', () => {
    const topology = createBoxCustomMeshTopology()
    topology.vertices = topology.vertices.map((vertex) =>
      vertex.id === 'v6' || vertex.id === 'v7'
        ? { ...vertex, position: [vertex.position[0], 3, vertex.position[2]] }
        : vertex,
    )

    const frame = getCustomMeshFaceFrame(topology, 'f-top')
    expect(frame).not.toBeNull()
    expect(Math.abs(frame!.normal[1])).toBeLessThan(1)
    expect(Math.abs(frame!.normal[2])).toBeGreaterThan(0)
  })
})
