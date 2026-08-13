import { describe, expect, test } from 'bun:test'
import {
  CUSTOM_MESH_BODY_MATERIAL_REF,
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
    expect(node.slots).toEqual({ body: CUSTOM_MESH_BODY_MATERIAL_REF })
    expect(inspectCustomMeshTopology(node.topology)).toEqual([])
  })

  test('retains its pinned placement support', () => {
    const node = CustomMeshNode.parse({
      name: 'Supported platform',
      supportSlabId: 'ground',
    })

    expect(node.supportSlabId).toBe('ground')
  })

  test('repairs legacy slot maps that predate the reusable body binding', () => {
    const node = CustomMeshNode.parse({
      name: 'Legacy painted mesh',
      slots: { accent: 'library:metal-steel' },
    })

    expect(node.slots).toEqual({
      body: CUSTOM_MESH_BODY_MATERIAL_REF,
      accent: 'library:metal-steel',
    })
  })

  test('rejects a face loop without a persisted boundary edge', () => {
    const topology = createBoxCustomMeshTopology()
    topology.edges = topology.edges.filter((edge) => edge.id !== 'e4')

    expect(CustomMeshTopology.safeParse(topology).success).toBe(false)
  })
})
