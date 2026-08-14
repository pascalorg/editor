import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CustomMeshNode,
  generateSceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { customMeshPaint } from './paint'

describe('custom mesh slot paint', () => {
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

  test('paints the Body slot across the untouched mesh', () => {
    customMeshPaint.commit?.({
      node,
      role: 'body',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
    let painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology).toEqual(node.topology)
    expect(painted.topology.faces.every((face) => face.materialSlot === 'body')).toBe(true)
    expect(painted.slots).toEqual({ body: 'library:metal-steel' })
  })

  test('painting a named slot updates every assigned face without changing assignments', () => {
    node = {
      ...node,
      slotNames: { ...node.slotNames, trim: 'Trim' },
      slots: { trim: 'library:wood' },
      topology: {
        ...node.topology,
        faces: node.topology.faces.map((face, index) =>
          index < 2 ? { ...face, materialSlot: 'trim' } : face,
        ),
      },
    }
    useScene.setState({ nodes: { [node.id]: node } })

    customMeshPaint.commit?.({
      node,
      role: 'trim',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology).toEqual(node.topology)
    expect(painted.slots).toEqual({ trim: 'library:metal-steel' })
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
      role: 'body',
      material,
      materialPreset: undefined,
    })

    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(Object.keys(useScene.getState().materials)).toEqual([materialId])
    expect(painted.slots).toEqual({
      body: toSceneMaterialRef(materialId),
    })
  })

  test('commits the slot and a new reusable scene material in one undo step', () => {
    const material = { preset: 'custom' as const, properties: { color: '#c2410c' } }

    customMeshPaint.commit?.({
      node,
      role: 'body',
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
      role: 'body',
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
      role: 'body',
      material: undefined,
      materialPreset: undefined,
    })

    expect(useScene.getState().nodes[node.id]).toEqual(node)
    expect(useScene.getState().materials).toEqual({})
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('painting a named slot does not collapse it into Body when materials match', () => {
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
      role: 'accent',
      material: undefined,
      materialPreset: 'library:metal-steel',
    })

    const painted = useScene.getState().nodes[node.id]
    expect(painted?.type).toBe('custom-mesh')
    if (painted?.type !== 'custom-mesh') return
    expect(painted.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe('accent')
    expect(painted.slots).toEqual({
      body: 'library:metal-steel',
      accent: 'library:metal-steel',
    })
  })

  test('eraser clears a named slot binding without changing face assignments', () => {
    const topology = {
      ...node.topology,
      faces: node.topology.faces.map((face) =>
        face.id === 'f-top' ? { ...face, materialSlot: 'accent' } : face,
      ),
    }
    node = {
      ...node,
      topology,
      slotNames: { ...node.slotNames, accent: 'Accent' },
      slots: { accent: 'library:metal-steel' },
    }
    useScene.setState({ nodes: { [node.id]: node } })

    customMeshPaint.commit?.({
      node,
      role: 'accent',
      material: undefined,
      materialPreset: undefined,
    })

    const erased = useScene.getState().nodes[node.id]
    expect(erased?.type).toBe('custom-mesh')
    if (erased?.type !== 'custom-mesh') return
    expect(erased.topology.faces.find((face) => face.id === 'f-top')?.materialSlot).toBe('accent')
    expect(erased.slots).toBeUndefined()
  })
})
