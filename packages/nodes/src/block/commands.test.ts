import { describe, expect, test } from 'bun:test'
import { createBoxBlockTopology, inspectBlockTopology } from '@pascal-app/core'
import { applyBlockCommand } from './commands'

describe('applyBlockCommand', () => {
  test('extrudes a face while retaining valid stable topology', () => {
    const topology = createBoxBlockTopology()
    const result = applyBlockCommand(topology, {
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(topology.vertices).toHaveLength(8)
    expect(result.topology.vertices).toHaveLength(12)
    expect(result.topology.edges).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(10)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
    const cap = result.topology.faces.find((face) => face.id === 'f-top')!
    const capVertices = cap.vertexIds.map(
      (id) => result.topology.vertices.find((vertex) => vertex.id === id)!,
    )
    expect(capVertices.every((vertex) => vertex.position[1] === 2.65)).toBe(true)
  })

  test('can extrude the resulting cap again without colliding IDs', () => {
    const first = applyBlockCommand(createBoxBlockTopology(), {
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: 0.25,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = applyBlockCommand(first.topology, {
      type: 'extrude-faces',
      faceIds: ['f-top'],
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
    expect(inspectBlockTopology(second.topology)).toEqual([])
  })

  test('inherits the source face material across an extruded cap and side faces', () => {
    const topology = createBoxBlockTopology()
    topology.faces = topology.faces.map((face) =>
      face.id === 'f-top' ? { ...face, materialSlot: 'accent' } : face,
    )
    const originalFaceIds = new Set(topology.faces.map((face) => face.id))
    const result = applyBlockCommand(topology, {
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inheritedFaces = result.topology.faces.filter(
      (face) => face.id === 'f-top' || !originalFaceIds.has(face.id),
    )
    expect(inheritedFaces).toHaveLength(5)
    expect(inheritedFaces.every((face) => face.materialSlot === 'accent')).toBe(true)
  })

  test('extrudes a connected face region without walls along its internal edges', () => {
    const base = createBoxBlockTopology()
    const first = applyBlockCommand(base, {
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: 0.25,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const originalFaceIds = new Set(base.faces.map((face) => face.id))
    const sideFace = first.topology.faces.find((face) => !originalFaceIds.has(face.id))!

    const result = applyBlockCommand(first.topology, {
      type: 'extrude-faces',
      faceIds: ['f-top', sideFace.id],
      distance: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.faces).toHaveLength(16)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top', sideFace.id] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('reports an invalid face selection without changing topology', () => {
    const topology = createBoxBlockTopology()
    expect(
      applyBlockCommand(topology, {
        type: 'extrude-faces',
        faceIds: ['missing'],
        distance: 0.25,
      }),
    ).toEqual({ ok: false, error: 'Face not found: missing' })
  })

  test('moves vertices selected directly or through edges and faces', () => {
    const topology = createBoxBlockTopology()
    const vertexResult = applyBlockCommand(topology, {
      type: 'translate-components',
      selection: { mode: 'vertex', ids: ['v6'] },
      delta: [0.5, 0.25, -0.25],
    })
    expect(vertexResult.ok).toBe(true)
    if (!vertexResult.ok) return
    expect(vertexResult.topology.vertices.find((vertex) => vertex.id === 'v6')?.position).toEqual([
      1.5, 2.65, 0.75,
    ])

    const edgeResult = applyBlockCommand(topology, {
      type: 'translate-components',
      selection: { mode: 'edge', ids: ['e4'] },
      delta: [0, 0.5, 0],
    })
    expect(edgeResult.ok).toBe(true)
    if (!edgeResult.ok) return
    expect(edgeResult.topology.vertices.find((vertex) => vertex.id === 'v4')?.position[1]).toBe(2.9)
    expect(edgeResult.topology.vertices.find((vertex) => vertex.id === 'v5')?.position[1]).toBe(2.9)

    const faceResult = applyBlockCommand(topology, {
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
    expect(inspectBlockTopology(faceResult.topology)).toEqual([])
  })

  test('rotates and scales selected components around an explicit pivot', () => {
    const topology = createBoxBlockTopology()
    const rotated = applyBlockCommand(topology, {
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

    const scaled = applyBlockCommand(topology, {
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
    expect(inspectBlockTopology(scaled.topology)).toEqual([])
  })

  test('insets a face into a valid inner face and surrounding ring', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'inset-faces',
      faceIds: ['f-top'],
      amount: 0.2,
      depth: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(12)
    expect(result.topology.edges).toHaveLength(20)
    expect(result.topology.faces).toHaveLength(10)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('inherits the source face material across an inset cap and ring', () => {
    const topology = createBoxBlockTopology()
    topology.faces = topology.faces.map((face) =>
      face.id === 'f-top' ? { ...face, materialSlot: 'accent' } : face,
    )
    const originalFaceIds = new Set(topology.faces.map((face) => face.id))
    const result = applyBlockCommand(topology, {
      type: 'inset-faces',
      faceIds: ['f-top'],
      amount: 0.2,
      depth: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inheritedFaces = result.topology.faces.filter(
      (face) => face.id === 'f-top' || !originalFaceIds.has(face.id),
    )
    expect(inheritedFaces).toHaveLength(5)
    expect(inheritedFaces.every((face) => face.materialSlot === 'accent')).toBe(true)
  })

  test('insets multiple selected faces in one command and keeps every new cap selected', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'inset-faces',
      faceIds: ['f-top', 'f-bottom'],
      amount: 0.2,
      depth: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(16)
    expect(result.topology.edges).toHaveLength(28)
    expect(result.topology.faces).toHaveLength(14)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top', 'f-bottom'] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('deletes selected faces, edges, or vertices without invalid references', () => {
    for (const selection of [
      { mode: 'face' as const, ids: ['f-top'] },
      { mode: 'edge' as const, ids: ['e4'] },
      { mode: 'vertex' as const, ids: ['v4'] },
    ]) {
      const result = applyBlockCommand(createBoxBlockTopology(), {
        type: 'delete-components',
        selection,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.selection.ids).toEqual([])
      expect(inspectBlockTopology(result.topology)).toEqual([])
    }
  })

  test('deletes multiple components according to the active component mode', () => {
    for (const selection of [
      { mode: 'face' as const, ids: ['f-top', 'f-bottom'] },
      { mode: 'edge' as const, ids: ['e0', 'e6'] },
      { mode: 'vertex' as const, ids: ['v0', 'v6'] },
    ]) {
      const result = applyBlockCommand(createBoxBlockTopology(), {
        type: 'delete-components',
        selection,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.selection).toEqual({ mode: selection.mode, ids: [] })
      expect(inspectBlockTopology(result.topology)).toEqual([])
      if (selection.mode === 'face') {
        expect(result.topology.faces.some((face) => selection.ids.includes(face.id))).toBe(false)
      } else if (selection.mode === 'edge') {
        expect(result.topology.edges.some((edge) => selection.ids.includes(edge.id))).toBe(false)
      } else {
        expect(result.topology.vertices.some((vertex) => selection.ids.includes(vertex.id))).toBe(
          false,
        )
      }
    }
  })

  test('merges selected vertices at their center and collapses duplicate boundaries', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'merge-vertices',
      vertexIds: ['v4', 'v5'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.vertices).toHaveLength(7)
    expect(result.topology.edges).toHaveLength(11)
    expect(result.selection).toEqual({ mode: 'vertex', ids: ['v5'] })
    expect(result.topology.vertices.find((vertex) => vertex.id === 'v5')?.position).toEqual([
      0, 2.4, -1,
    ])
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('merges multiple vertices while retaining the last-selected active vertex ID', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'merge-vertices',
      vertexIds: ['v4', 'v5', 'v6'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.selection).toEqual({ mode: 'vertex', ids: ['v6'] })
    expect(result.topology.vertices.some((vertex) => vertex.id === 'v6')).toBe(true)
    expect(result.topology.vertices.some((vertex) => vertex.id === 'v4')).toBe(false)
    expect(result.topology.vertices.some((vertex) => vertex.id === 'v5')).toBe(false)
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('dissolves a shared edge into one valid face loop', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'dissolve-edges',
      edgeIds: ['e4'],
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
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('keeps the first adjacent face material when dissolving a mixed-material edge', () => {
    const topology = createBoxBlockTopology()
    topology.faces = topology.faces.map((face) =>
      face.id === 'f-top'
        ? { ...face, materialSlot: 'top' }
        : face.id === 'f-front'
          ? { ...face, materialSlot: 'front' }
          : face,
    )
    const result = applyBlockCommand(topology, {
      type: 'dissolve-edges',
      edgeIds: ['e4'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe('top')
    expect(result.topology.faces.some((face) => face.id === 'f-front')).toBe(false)
  })

  test('dissolves multiple selected edges in one valid transaction', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'dissolve-edges',
      edgeIds: ['e4', 'e6'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.edges).toHaveLength(10)
    expect(result.topology.faces).toHaveLength(4)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('dissolves the internal boundaries of a selected face region', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'dissolve-faces',
      faceIds: ['f-top', 'f-front', 'f-back'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.edges).toHaveLength(10)
    expect(result.topology.faces).toHaveLength(4)
    expect(result.selection).toEqual({ mode: 'face', ids: ['f-top'] })
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('cuts a connected quad ring and selects the inserted loop', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
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
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('preserves each source face material when a loop cut splits the ring', () => {
    const topology = createBoxBlockTopology()
    topology.faces = topology.faces.map((face) => ({ ...face, materialSlot: face.id }))
    const result = applyBlockCommand(topology, {
      type: 'loop-cut',
      edgeId: 'e8',
      factor: 0.25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const counts = Object.fromEntries(
      topology.faces.map((face) => [
        face.id,
        result.topology.faces.filter((resultFace) => resultFace.materialSlot === face.id).length,
      ]),
    )
    expect(counts).toEqual({
      'f-bottom': 1,
      'f-top': 1,
      'f-front': 2,
      'f-right': 2,
      'f-back': 2,
      'f-left': 2,
    })
  })

  test('stops a loop cut cleanly before a non-quad face', () => {
    const dissolved = applyBlockCommand(createBoxBlockTopology(), {
      type: 'dissolve-edges',
      edgeIds: ['e4'],
    })
    expect(dissolved.ok).toBe(true)
    if (!dissolved.ok) return

    const result = applyBlockCommand(dissolved.topology, {
      type: 'loop-cut',
      edgeId: 'e0',
      factor: 0.5,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.selection.ids).toHaveLength(2)
    expect(inspectBlockTopology(result.topology)).toEqual([])
    expect(result.topology.faces.find((face) => face.id === 'f-top')?.vertexIds.length).toBe(8)
  })

  test('creates multiple evenly spaced loop cuts in one valid transaction', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
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
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('keeps multiple loop cuts centered until multi-cut sliding is supported', () => {
    const centered = applyBlockCommand(createBoxBlockTopology(), {
      type: 'loop-cut',
      edgeId: 'e8',
      factor: 0.5,
      cuts: 3,
    })
    const attemptedSlide = applyBlockCommand(createBoxBlockTopology(), {
      type: 'loop-cut',
      edgeId: 'e8',
      factor: 0.8,
      cuts: 3,
    })

    expect(centered.ok).toBe(true)
    expect(attemptedSlide.ok).toBe(true)
    if (!(centered.ok && attemptedSlide.ok)) return
    expect(attemptedSlide.topology).toEqual(centered.topology)
  })

  test('bevels a manifold box edge with width, segments, profile, and overlap clamping', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'bevel-edges',
      edgeIds: ['e0'],
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
    const curvedVertex = result.topology.vertices.find((vertex) => vertex.id === 'v10')!
    const arcCenter = [-1, 0.2, -0.8]
    expect(
      Math.hypot(
        curvedVertex.position[0] - arcCenter[0]!,
        curvedVertex.position[1] - arcCenter[1]!,
        curvedVertex.position[2] - arcCenter[2]!,
      ),
    ).toBeCloseTo(0.2, 6)
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('uses the first adjacent face material for new bevel bands in stable topology order', () => {
    const topology = createBoxBlockTopology()
    topology.faces = topology.faces.map((face) =>
      face.id === 'f-bottom'
        ? { ...face, materialSlot: 'bottom' }
        : face.id === 'f-front'
          ? { ...face, materialSlot: 'front' }
          : face,
    )
    const originalFaceIds = new Set(topology.faces.map((face) => face.id))
    const result = applyBlockCommand(topology, {
      type: 'bevel-edges',
      edgeIds: ['e0'],
      width: 0.2,
      segments: 3,
      profile: 0.5,
      clampOverlap: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const bevelBands = result.topology.faces.filter((face) => !originalFaceIds.has(face.id))
    expect(bevelBands).toHaveLength(3)
    expect(bevelBands.every((face) => face.materialSlot === 'bottom')).toBe(true)
    expect(result.topology.faces.find((face) => face.id === 'f-front')?.materialSlot).toBe('front')
  })

  test('bevels multiple independent selected edges in one command', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'bevel-edges',
      edgeIds: ['e0', 'e6'],
      width: 0.2,
      segments: 3,
      profile: 0.5,
      clampOverlap: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.faces).toHaveLength(12)
    expect(result.selection.mode).toBe('edge')
    expect(result.selection.ids).toHaveLength(8)
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })

  test('bevels adjacent selected edges after remapping their changed corner endpoints', () => {
    const result = applyBlockCommand(createBoxBlockTopology(), {
      type: 'bevel-edges',
      edgeIds: ['e0', 'e1'],
      width: 0.2,
      segments: 3,
      profile: 0.5,
      clampOverlap: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.faces).toHaveLength(12)
    expect(result.selection.mode).toBe('edge')
    expect(result.selection.ids.length).toBeGreaterThan(0)
    expect(inspectBlockTopology(result.topology)).toEqual([])
  })
})
