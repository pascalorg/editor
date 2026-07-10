import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  useScene,
} from '@pascal-app/core'
import { commitFreshPlacementSubtree, createFreshPlacementSubtree } from './fresh-planar-placement'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (time: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const LEVEL_ID = 'level_test' as AnyNodeId
const SHELF_ID = 'shelf_draft' as AnyNodeId
const CABINET_RUN_ID = 'cabinet_original-run' as AnyNodeId
const CABINET_LEFT_ID = 'cabinet-module_original-left' as AnyNodeId
const CABINET_RIGHT_ID = 'cabinet-module_original-right' as AnyNodeId
const CABINET_CHILD_RUN_ID = 'cabinet_child-run' as AnyNodeId
const CABINET_CHILD_MODULE_ID = 'cabinet-module_child-module' as AnyNodeId

function level(children: AnyNodeId[]): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children,
    level: 0,
  } as AnyNode
}

function shelf(): AnyNode {
  return {
    id: SHELF_ID,
    type: 'shelf',
    object: 'node',
    parentId: LEVEL_ID,
    visible: false,
    metadata: { isNew: true, label: 'draft' },
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1.2,
    depth: 0.3,
    thickness: 0.04,
    height: 0.9,
    style: 'wall-shelf',
    rows: 1,
    columns: 1,
    withBack: false,
    withSides: true,
    withBottom: false,
    bracketStyle: 'minimal',
  } as AnyNode
}

function seedCabinetRun() {
  const run = CabinetNode.parse({
    id: CABINET_RUN_ID,
    parentId: LEVEL_ID,
    position: [0, 0, 0],
    rotation: 0,
    children: [CABINET_LEFT_ID, CABINET_RIGHT_ID],
    showPlinth: true,
    withCountertop: true,
  })
  const left = CabinetModuleNode.parse({
    id: CABINET_LEFT_ID,
    parentId: CABINET_RUN_ID,
    position: [-0.45, 0.1, 0],
    width: 0.9,
  })
  const right = CabinetModuleNode.parse({
    id: CABINET_RIGHT_ID,
    parentId: CABINET_RUN_ID,
    position: [0.45, 0.1, 0],
    width: 0.9,
  })

  useScene.setState({
    nodes: {
      [LEVEL_ID]: level([CABINET_RUN_ID]),
      [CABINET_RUN_ID]: run as AnyNode,
      [CABINET_LEFT_ID]: left as AnyNode,
      [CABINET_RIGHT_ID]: right as AnyNode,
    },
    rootNodeIds: [LEVEL_ID],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
}

describe('commitFreshPlacementSubtree', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {
        [LEVEL_ID]: level([SHELF_ID]),
        [SHELF_ID]: shelf(),
      },
      rootNodeIds: [LEVEL_ID],
      collections: {},
      dirtyNodes: new Set(),
    } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('commits a fresh draft as one undoable clean subtree', () => {
    useScene.temporal.getState().pause()

    const committedId = commitFreshPlacementSubtree(SHELF_ID, {
      position: [2, 0, 3],
      visible: true,
    } as Partial<AnyNode>)

    expect(committedId).toBeTruthy()
    expect(committedId).not.toBe(SHELF_ID)
    const finalId = committedId as AnyNodeId
    expect(useScene.getState().nodes[SHELF_ID]).toBeUndefined()

    const committed = useScene.getState().nodes[finalId] as
      | (AnyNode & { position: [number, number, number]; metadata?: Record<string, unknown> })
      | undefined
    expect(committed?.position).toEqual([2, 0, 3])
    expect(committed?.visible).toBe(true)
    expect(committed?.metadata?.isNew).toBeUndefined()
    expect(committed?.metadata?.label).toBe('draft')
    expect((useScene.getState().nodes[LEVEL_ID] as { children: AnyNodeId[] }).children).toEqual([
      finalId,
    ])

    useScene.temporal.getState().resume()
    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[finalId]).toBeUndefined()
    expect(useScene.getState().nodes[SHELF_ID]).toBeUndefined()
    expect((useScene.getState().nodes[LEVEL_ID] as { children: AnyNodeId[] }).children).toEqual([])
  })

  test('commits a duplicated cabinet draft without deleting the original modules', () => {
    seedCabinetRun()
    useScene.temporal.getState().clear()
    useScene.temporal.getState().pause()

    const draftId = createFreshPlacementSubtree(CABINET_RUN_ID)
    expect(draftId).toBeTruthy()
    expect(draftId).not.toBe(CABINET_RUN_ID)

    const draft = useScene.getState().nodes[draftId as AnyNodeId] as
      | (AnyNode & { children: AnyNodeId[]; metadata?: Record<string, unknown> })
      | undefined
    expect(draft?.metadata?.isNew).toBe(true)
    expect(draft?.children).toHaveLength(2)
    expect(draft?.children).not.toContain(CABINET_LEFT_ID)
    expect(draft?.children).not.toContain(CABINET_RIGHT_ID)

    const finalId = commitFreshPlacementSubtree(
      draftId as AnyNodeId,
      {
        position: [2, 0, 3],
        visible: true,
      } as Partial<AnyNode>,
    )
    expect(finalId).toBeTruthy()

    const nodes = useScene.getState().nodes
    expect(nodes[CABINET_RUN_ID]).toBeDefined()
    expect(nodes[CABINET_LEFT_ID]).toBeDefined()
    expect(nodes[CABINET_RIGHT_ID]).toBeDefined()

    const finalRun = nodes[finalId as AnyNodeId] as
      | (AnyNode & { children: AnyNodeId[]; metadata?: Record<string, unknown> })
      | undefined
    expect(finalRun?.children).toHaveLength(2)
    expect(finalRun?.metadata?.isNew).toBeUndefined()
    for (const childId of finalRun?.children ?? []) {
      const child = nodes[childId]
      expect(child?.type).toBe('cabinet-module')
      expect(child?.parentId).toBe(finalId)
    }
  })

  test('flattens duplicated nested cabinet runs into level coordinates before dragging', () => {
    const parentRun = {
      id: CABINET_RUN_ID,
      type: 'cabinet',
      object: 'node',
      visible: true,
      metadata: {},
      parentId: LEVEL_ID,
      position: [4, 0, 5],
      rotation: Math.PI / 2,
      children: [CABINET_LEFT_ID, CABINET_CHILD_RUN_ID],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
      boardThickness: 0.018,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      countertopBackOverhang: 0,
      withFinishedBack: false,
      withWaterfall: false,
      frontThickness: 0.018,
      frontGap: 0.003,
      frontStyle: 'slab',
      handleStyle: 'bar',
      handlePosition: 'auto',
      frontOverlay: 'full',
      withBottomPanel: true,
      showPlinth: true,
      withCountertop: true,
      operationState: 0,
      runTier: 'base',
    } as AnyNode
    const parentModule = CabinetModuleNode.parse({
      id: CABINET_LEFT_ID,
      parentId: CABINET_RUN_ID,
      position: [0.5, 0.1, 0],
      width: 1,
    })
    const childRun = CabinetNode.parse({
      id: CABINET_CHILD_RUN_ID,
      parentId: CABINET_RUN_ID,
      position: [1, 0, 0.25],
      rotation: Math.PI / 2,
      children: [CABINET_CHILD_MODULE_ID],
      metadata: {
        cabinetCornerDerivedRun: { role: 'base-leg', side: 'right', sourceRunId: CABINET_RUN_ID },
        nodeSelectionProxyId: CABINET_RUN_ID,
      },
    })
    const childModule = CabinetModuleNode.parse({
      id: CABINET_CHILD_MODULE_ID,
      parentId: CABINET_CHILD_RUN_ID,
      position: [0, 0.1, 0],
      width: 0.9,
    })
    useScene.setState({
      nodes: {
        [LEVEL_ID]: level([CABINET_RUN_ID]),
        [CABINET_RUN_ID]: parentRun as AnyNode,
        [CABINET_LEFT_ID]: parentModule as AnyNode,
        [CABINET_CHILD_RUN_ID]: childRun as AnyNode,
        [CABINET_CHILD_MODULE_ID]: childModule as AnyNode,
      },
      rootNodeIds: [LEVEL_ID],
      collections: {},
      dirtyNodes: new Set(),
    } as never)

    const draftId = createFreshPlacementSubtree(CABINET_CHILD_RUN_ID)
    const draft = useScene.getState().nodes[draftId as AnyNodeId] as
      | (AnyNode & {
          children: AnyNodeId[]
          metadata?: Record<string, unknown>
          position: [number, number, number]
          rotation: number
        })
      | undefined

    expect(draft).toBeDefined()
    expect(draft?.parentId).toBe(LEVEL_ID)
    expect(draft?.position[0]).toBeCloseTo(4.25)
    expect(draft?.position[2]).toBeCloseTo(4)
    expect(draft?.rotation).toBeCloseTo(Math.PI)
    expect(draft?.metadata?.isNew).toBe(true)
    expect(draft?.metadata?.cabinetCornerDerivedRun).toBeUndefined()
    expect(draft?.metadata?.nodeSelectionProxyId).toBeUndefined()
    expect(draft?.children).toHaveLength(1)
    expect(draft?.children).not.toContain(CABINET_CHILD_MODULE_ID)
  })
})
