import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CustomMeshNode,
  generateSceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { customMeshPaint } from './paint'

describe('custom mesh face paint', () => {
  let node: CustomMeshNode

  beforeEach(() => {
    node = CustomMeshNode.parse({ name: 'Paint target' })
    useScene.setState({
      nodes: { [node.id]: node },
      materials: {},
      dirtyNodes: new Set(),
      readOnly: false,
    })
    useScene.temporal.getState().clear()
  })

  afterEach(() => {
    useScene.setState({ nodes: {}, materials: {}, dirtyNodes: new Set(), readOnly: false })
    useScene.temporal.getState().clear()
  })

  test('paints one face and reuses the same object slot on another face', () => {
    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
    let painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe(
      'material-1',
    )
    expect(painted.topology.faces.find((face) => face.id === 'f-front')?.materialSlot).toBe('body')
    expect(painted.slots).toEqual({ 'material-1': 'library:metal-steel' })

    customMeshPaint.commit?.({
      node: painted,
      role: 'face_f-front',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
    painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology.faces.find((face) => face.id === 'f-front')?.materialSlot).toBe(
      'material-1',
    )
    expect(painted.slots).toEqual({ 'material-1': 'library:metal-steel' })
  })

  test('reuses a structurally matching scene material instead of creating one', () => {
    const materialId = generateSceneMaterialId()
    const material = { preset: 'custom' as const, properties: { color: '#c2410c' } }
    useScene.setState({
      materials: {
        [materialId]: { id: materialId, name: 'Shared red', material },
      },
    })

    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material,
      materialPreset: undefined,
    })

    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(Object.keys(useScene.getState().materials)).toEqual([materialId])
    expect(painted.slots).toEqual({ 'material-1': toSceneMaterialRef(materialId) })
  })

  test('commits the face and a new reusable scene material in one undo step', () => {
    const material = { preset: 'custom' as const, properties: { color: '#c2410c' } }

    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material,
      materialPreset: undefined,
    })

    expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[node.id]).toEqual(node)
    expect(useScene.getState().materials).toEqual({})
  })

  test('does not mutate a read-only scene or create an orphan material', () => {
    useScene.setState({ readOnly: true })
    useScene.temporal.getState().clear()

    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material: { preset: 'custom', properties: { color: '#c2410c' } },
      materialPreset: undefined,
    })

    expect(useScene.getState().nodes[node.id]).toEqual(node)
    expect(useScene.getState().materials).toEqual({})
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('does not create an orphan material for a semantic no-op', () => {
    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material: undefined,
      materialPreset: undefined,
    })

    expect(useScene.getState().nodes[node.id]).toEqual(node)
    expect(useScene.getState().materials).toEqual({})
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('reuses the body slot when painting with its material reference', () => {
    const topology = {
      ...node.topology,
      faces: node.topology.faces.map((face) =>
        face.id === 'f-top' ? { ...face, materialSlot: 'accent' } : face,
      ),
    }
    node = { ...node, topology, slots: { body: 'library:metal-steel', accent: 'library:wood' } }
    useScene.setState({ nodes: { [node.id]: node } })
    useScene.temporal.getState().clear()

    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })

    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe('body')
    expect(painted.slots).toEqual({ body: 'library:metal-steel', accent: 'library:wood' })
  })

  test('eraser returns only the painted face to body', () => {
    customMeshPaint.commit?.({
      node,
      role: 'face_f-top',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return

    customMeshPaint.commit?.({
      node: painted,
      role: 'face_f-top',
      material: undefined,
      materialPreset: undefined,
    })

    const erased = useScene.getState().nodes[node.id]
    expect(erased?.type).toBe('custom-mesh')
    if (erased?.type !== 'custom-mesh') return
    expect(erased.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe('body')
  })
})
