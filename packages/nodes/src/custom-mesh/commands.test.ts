import { describe, expect, test } from 'bun:test'
import { createBoxCustomMeshTopology, inspectCustomMeshTopology } from '@pascal-app/core'
import { applyCustomMeshCommand } from './commands'

describe('applyCustomMeshCommand', () => {
  test('extrudes a face while retaining valid stable topology', () => {
    const topology = createBoxCustomMeshTopology()
    const result = applyCustomMeshCommand(topology, {
      type: 'extrude-face',
      faceId: 'f-top',
      distance: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(topology.vertices).toHaveLength(8)
    expect(result.topology.vertices).toHaveLength(12)
    expect(result.topology.edges).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(10)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
    const cap = result.topology.faces.find((face) => face.id === 'f-top')!
    const capVertices = cap.vertexIds.map(
      (id) => result.topology.vertices.find((vertex) => vertex.id === id)!,
    )
    expect(capVertices.every((vertex) => vertex.position[1] === 2.65)).toBe(true)
  })

  test('can extrude the resulting cap again without colliding IDs', () => {
    const first = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'extrude-face',
      faceId: 'f-top',
      distance: 0.25,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = applyCustomMeshCommand(first.topology, {
      type: 'extrude-face',
      faceId: 'f-top',
      distance: 0.25,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(new Set(second.topology.vertices.map((vertex) => vertex.id)).size).toBe(
      second.topology.vertices.length,
    )
    expect(new Set(second.topology.edges.map((edge) => edge.id)).size).toBe(
      second.topology.edges.length,
    )
    expect(new Set(second.topology.faces.map((face) => face.id)).size).toBe(
      second.topology.faces.length,
    )
    expect(inspectCustomMeshTopology(second.topology)).toEqual([])
  })

  test('reports an invalid face selection without changing topology', () => {
    const topology = createBoxCustomMeshTopology()
    expect(
      applyCustomMeshCommand(topology, {
        type: 'extrude-face',
        faceId: 'missing',
        distance: 0.25,
      }),
    ).toEqual({ ok: false, error: 'Face not found: missing' })
  })

  test('moves vertices selected directly or through edges and faces', () => {
    const topology = createBoxCustomMeshTopology()
    const vertexResult = applyCustomMeshCommand(topology, {
      type: 'translate-components',
      selection: { mode: 'vertex', ids: ['v6'] },
      delta: [0.5, 0.25, -0.25],
    })
    expect(vertexResult.ok).toBe(true)
    if (!vertexResult.ok) return
    expect(vertexResult.topology.vertices.find((vertex) => vertex.id === 'v6')?.position).toEqual([
      1.5, 2.65, 0.75,
    ])

    const edgeResult = applyCustomMeshCommand(topology, {
      type: 'translate-components',
      selection: { mode: 'edge', ids: ['e4'] },
      delta: [0, 0.5, 0],
    })
    expect(edgeResult.ok).toBe(true)
    if (!edgeResult.ok) return
    expect(edgeResult.topology.vertices.find((vertex) => vertex.id === 'v4')?.position[1]).toBe(2.9)
    expect(edgeResult.topology.vertices.find((vertex) => vertex.id === 'v5')?.position[1]).toBe(2.9)

    const faceResult = applyCustomMeshCommand(topology, {
      type: 'translate-components',
      selection: { mode: 'face', ids: ['f-top'] },
      delta: [0, 0.5, 0],
    })
    expect(faceResult.ok).toBe(true)
    if (!faceResult.ok) return
    expect(
      faceResult.topology.vertices
        .filter((vertex) => ['v4', 'v5', 'v6', 'v7'].includes(vertex.id))
        .every((vertex) => vertex.position[1] === 2.9),
    ).toBe(true)
    expect(inspectCustomMeshTopology(faceResult.topology)).toEqual([])
  })

  test('rotates and scales selected components around an explicit pivot', () => {
    const topology = createBoxCustomMeshTopology()
    const rotated = applyCustomMeshCommand(topology, {
      type: 'rotate-components',
      selection: { mode: 'vertex', ids: ['v6'] },
      pivot: [0, 0, 0],
      axis: [0, 1, 0],
      angle: Math.PI / 2,
    })
    expect(rotated.ok).toBe(true)
    if (!rotated.ok) return
    const rotatedPosition = rotated.topology.vertices.find((vertex) => vertex.id === 'v6')!.position
    expect(rotatedPosition[0]).toBeCloseTo(1)
    expect(rotatedPosition[1]).toBeCloseTo(2.4)
    expect(rotatedPosition[2]).toBeCloseTo(-1)

    const scaled = applyCustomMeshCommand(topology, {
      type: 'scale-components',
      selection: { mode: 'face', ids: ['f-top'] },
      pivot: [0, 2.4, 0],
      factors: [0.5, 1, 0.5],
    })
    expect(scaled.ok).toBe(true)
    if (!scaled.ok) return
    expect(scaled.topology.vertices.find((vertex) => vertex.id === 'v6')?.position).toEqual([
      0.5, 2.4, 0.5,
    ])
    expect(inspectCustomMeshTopology(scaled.topology)).toEqual([])
  })

  test('insets a face into a valid inner face and surrounding ring', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'inset-face',
      faceId: 'f-top',
      amount: 0.2,
      depth: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(12)
    expect(result.topology.edges).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(10)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })

  test('deletes selected faces, edges, or vertices without invalid references', () => {
    for (const selection of [
      { mode: 'face' as const, ids: ['f-top'] },
      { mode: 'edge' as const, ids: ['e4'] },
      { mode: 'vertex' as const, ids: ['v4'] },
    ]) {
      const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
        type: 'delete-components',
        selection,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.selection.ids).toEqual([])
      expect(inspectCustomMeshTopology(result.topology)).toEqual([])
    }
  })

  test('merges selected vertices at their center and collapses duplicate boundaries', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'merge-vertices',
      vertexIds: ['v4', 'v5'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(7)
    expect(result.topology.edges).toHaveLength(11)
    expect(result.selection).toEqual({ mode: 'vertex', ids: ['v4'] })
    expect(result.topology.vertices.find((vertex) => vertex.id === 'v4')?.position).toEqual([
      0, 2.4, -1,
    ])
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })

  test('dissolves a shared edge into one valid face loop', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'dissolve-edge',
      edgeId: 'e4',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.edges).toHaveLength(11)
    expect(result.topology.faces).toHaveLength(5)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(result.topology.faces.find((face) => face.id === 'f-top')?.vertexIds).toEqual([
      'v4',
      'v7',
      'v6',
      'v5',
      'v1',
      'v0',
    ])
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })

  test('cuts a connected quad ring and selects the inserted loop', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'loop-cut',
      edgeId: 'e8',
      factor: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(12)
    expect(result.topology.edges).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(10)
    expect(result.selection.mode).toBe('edge')
    expect(result.selection.ids).toHaveLength(4)
    const selectedEdges = result.topology.edges.filter((edge) =>
      result.selection.ids.includes(edge.id),
    )
    const vertices = new Map(
      result.topology.vertices.map((vertex) => [vertex.id, vertex.position] as const),
    )
    expect(selectedEdges).toHaveLength(4)
    expect(
      selectedEdges.every((edge) =>
        edge.vertexIds.every((vertexId) => Math.abs(vertices.get(vertexId)![1] - 0.6) < 1e-8),
      ),
    ).toBe(true)
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })

  test('stops a loop cut cleanly before a non-quad face', () => {
    const dissolved = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'dissolve-edge',
      edgeId: 'e4',
    })
    expect(dissolved.ok).toBe(true)
    if (!dissolved.ok) return

    const result = applyCustomMeshCommand(dissolved.topology, {
      type: 'loop-cut',
      edgeId: 'e0',
      factor: 0.5,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.selection.ids).toHaveLength(2)
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
    expect(result.topology.faces.find((face) => face.id === 'f-top')?.vertexIds.length).toBe(8)
  })

  test('creates multiple evenly spaced loop cuts in one valid transaction', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'loop-cut',
      edgeId: 'e8',
      factor: 0.5,
      cuts: 3,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(18)
    expect(result.selection.ids).toHaveLength(12)
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })

  test('bevels a manifold box edge with width, segments, profile, and overlap clamping', () => {
    const result = applyCustomMeshCommand(createBoxCustomMeshTopology(), {
      type: 'bevel-edge',
      edgeId: 'e0',
      width: 0.2,
      segments: 3,
      profile: 0.5,
      clampOverlap: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.selection.mode).toBe('edge')
    expect(result.selection.ids).toHaveLength(4)
    expect(result.topology.faces).toHaveLength(9)
    expect(inspectCustomMeshTopology(result.topology)).toEqual([])
  })
})
