import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  type HandleDescriptor,
  type RoofNode,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentSchema,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { roofDefinition } from './definition'

function roof(overrides: Partial<RoofNode> = {}): RoofNode {
  return {
    object: 'node',
    id: 'roof_test',
    type: 'roof',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [],
    ...overrides,
  } as RoofNode
}

function handles(node: RoofNode = roof()): HandleDescriptor<RoofNode>[] {
  const descriptors = roofDefinition.handles
  return (
    typeof descriptors === 'function' ? descriptors(node, undefined as never) : descriptors
  ) as HandleDescriptor<RoofNode>[]
}

describe('roof handles', () => {
  test('an explicit Y move detaches while XZ moves and epsilon drift retain following', () => {
    const node = roof({ support: { kind: 'walls' }, position: [2, 1, 1] })
    const handle = handles(node).find((entry) => entry.kind === 'translate')!
    if (handle.kind !== 'translate') throw new Error('Missing roof translate handle')
    expect(handle.apply(node, [8, 2, 3], undefined as never)).toEqual({
      position: [8, 2, 3],
      support: { kind: 'level' },
    })
    expect(handle.apply(node, [8, 1, 3], undefined as never)).toEqual({ position: [8, 1, 3] })
    expect(handle.apply(node, [8, 1.00001, 3], undefined as never)).toEqual({
      position: [8, 1.00001, 3],
    })
    expect(
      handle.apply(roof({ support: { kind: 'level' } }), [0, 2, 0], undefined as never),
    ).toEqual({ position: [0, 2, 0] })
    const attached = roof({
      support: { kind: 'roof', roofSegmentId: 'rseg_host', localPosition: [0, 0], curbHeight: 0.5 },
    })
    expect(handle.apply(attached, [0, 2, 0], undefined as never)).toEqual({ position: [0, 2, 0] })
  })

  test('hides direct move handle for managed lean-to roofs', () => {
    expect(handles(roof()).length).toBeGreaterThan(0)
    expect(
      handles(
        roof({
          metadata: {
            managedByLeanTo: 'lean_to_test',
            leanToRole: 'roof',
          },
        }),
      ),
    ).toEqual([])
  })
})

describe('roof tool registration', () => {
  test('loads the registry placement component', async () => {
    const module = await roofDefinition.tool?.()
    expect(typeof module?.default).toBe('function')
  })

  test('owns placement and switches its contextual hints by roof kind', () => {
    expect(roofDefinition.tool).toBeDefined()
    const placementHint = roofDefinition.toolHints?.find((hint) => hint.key === 'P')
    const rotationHint = roofDefinition.toolHints?.find((hint) => hint.key === 'R')

    const previousDefaults = useEditor.getState().toolDefaults
    let changes = 0
    const unsubscribe = placementHint?.visible?.subscribe(() => changes++)
    try {
      useEditor.getState().setToolDefaults('roof', { roofType: 'gable' })
      expect(placementHint?.visible?.value()).toBe(false)
      expect(rotationHint?.visible?.value()).toBe(true)

      // Armed with a cone and no tool mounted yet, as in a 2D-only session.
      useEditor.getState().setToolDefaults('roof', { roofType: 'conical' })
      expect(placementHint?.visible?.value()).toBe(true)
      expect(rotationHint?.visible?.value()).toBe(false)
      expect(changes).toBe(1)
    } finally {
      unsubscribe?.()
      useEditor.setState({ toolDefaults: previousDefaults })
    }
  })
})

describe('roof assembly host', () => {
  test('stacks one contiguous layer run inward from the covering, summed', () => {
    const host = roofDefinition.capabilities?.assembly
    expect(roofDefinition.schemaVersion).toBe(4)
    expect(host).toMatchObject({ reference: 'covering', measure: 'normal' })
    expect(host?.backing).toBeUndefined()
    expect(host?.body(roof())).toBeNull()
  })
})

describe('roof paint: gables on the merged shell', () => {
  const paint = roofDefinition.capabilities!.paint!
  const red = { preset: 'custom', properties: { color: '#aa2222' } } as const
  let previousRaf: typeof requestAnimationFrame
  let previousCancelRaf: typeof cancelAnimationFrame

  beforeEach(() => {
    previousRaf = globalThis.requestAnimationFrame
    previousCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
  })

  afterEach(() => {
    useScene.getState().unloadScene()
    useScene.temporal.getState().clear()
    globalThis.requestAnimationFrame = previousRaf
    globalThis.cancelAnimationFrame = previousCancelRaf
  })

  function seed() {
    const left = RoofSegmentSchema.parse({
      id: 'rseg_left',
      type: 'roof-segment',
      parentId: 'roof_test',
      roofType: 'gable',
      gableLeftMaterialPreset: 'library:brick',
    })
    const right = RoofSegmentSchema.parse({
      id: 'rseg_right',
      type: 'roof-segment',
      parentId: 'roof_test',
      roofType: 'gable',
    })
    const node = roof({ children: [left.id, right.id] as RoofNode['children'] })
    useScene.setState({
      nodes: Object.fromEntries(
        [node, left, right].map((entry) => [entry.id, entry as AnyNode]),
      ) as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [node.id as AnyNodeId],
      readOnly: false,
    } as never)
    return node
  }
  const segmentOf = (id: string) => useScene.getState().nodes[id as AnyNodeId] as RoofSegmentNode

  test('a gable offers itself or every gable of the roof', () => {
    const scopes = paint.scopes?.(roof(), 'gable-right:rseg_right')
    expect(scopes?.scopes).toEqual(['single', 'matching'])
    expect(scopes?.labels).toEqual({ matching: 'All gables' })
    expect(paint.roleLabel?.(roof(), 'gable-right:rseg_right')).toBe('Right gable')
    expect(paint.roleLabel?.(roof(), 'heel')).toBe('Heel band')
    // the roof's own surfaces keep the derived single scope
    expect(paint.scopes?.(roof(), 'edge')).toBeNull()
  })

  test('one gable paints only its segment', () => {
    const node = seed()
    const role = paint.scopes?.(node, 'gable-right:rseg_right')?.roleFor?.('single')
    paint.commit?.({ node, role: role!, material: red, materialPreset: undefined })
    expect(segmentOf('rseg_right').gableRightMaterial).toMatchObject(red)
    expect(segmentOf('rseg_left').gableLeftMaterialPreset).toBe('library:brick')
    const after = useScene.getState().nodes[node.id as AnyNodeId] as RoofNode
    expect(getEffectiveRoofSurfaceMaterial(after, 'edge')).toEqual(
      getEffectiveRoofSurfaceMaterial(node, 'edge'),
    )
  })

  test('every gable paints the roof edge and clears each segment gable', () => {
    const node = seed()
    const role = paint.scopes?.(node, 'gable-right:rseg_right')?.roleFor?.('matching')
    paint.commit?.({ node, role: role!, material: red, materialPreset: undefined })
    const after = useScene.getState().nodes[node.id as AnyNodeId] as RoofNode
    expect(getEffectiveRoofSurfaceMaterial(after, 'edge').material).toMatchObject(red)
    expect(segmentOf('rseg_left').gableLeftMaterialPreset).toBeUndefined()
    expect(segmentOf('rseg_right').gableRightMaterial).toBeUndefined()
  })
})
