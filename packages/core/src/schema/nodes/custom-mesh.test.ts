import { describe, expect, test } from 'bun:test'
import {
  CustomMeshNode,
  CustomMeshTopology,
  createBoxCustomMeshTopology,
  inspectCustomMeshTopology,
} from './custom-mesh'

describe('CustomMeshNode', () => {
  test('creates a valid topology-backed box by default', () => {
    const node = CustomMeshNode.parse({ name: 'Editable box' })

    expect(node.topology.vertices).toHaveLength(8)
    expect(node.topology.edges).toHaveLength(12)
    expect(node.topology.faces).toHaveLength(6)
    expect(inspectCustomMeshTopology(node.topology)).toEqual([])
  })

  test('retains its pinned placement support', () => {
    const node = CustomMeshNode.parse({
      name: 'Supported platform',
      supportSlabId: 'ground',
    })

    expect(node.supportSlabId).toBe('ground')
  })

  test('rejects a face loop without a persisted boundary edge', () => {
    const topology = createBoxCustomMeshTopology()
    topology.edges = topology.edges.filter((edge) => edge.id !== 'e4')

    expect(CustomMeshTopology.safeParse(topology).success).toBe(false)
  })
})
