import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BuildingNode,
  beginSceneHistoryPauseSession,
  CabinetModuleNode,
  CabinetNode,
  findLevelAncestorId,
  getSceneHistoryPauseDepth,
  type LevelNode,
  nodeRegistry,
  pauseSceneHistory,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  resumeSceneHistory,
  type SceneCommit,
  subscribeSceneCommits,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { z } from 'zod'
import {
  commitFreshPlacementSubtree,
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
  prepareFreshPlacementRootDuplicate,
} from './fresh-planar-placement'

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

function registerCabinetClonePrepTestKind() {
  if (nodeRegistry.has('cabinet')) return

  registerNode({
    kind: 'cabinet',
    schemaVersion: 1,
    schema: z.any() as never,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      duplicable: {
        subtree: true,
        prepareSubtreeClone: ({ root, descendants, rootId, nodes }) => {
          const parent = root.parentId ? nodes[root.parentId as AnyNodeId] : null
          if (root.type !== 'cabinet' || parent?.type !== 'cabinet') {
            return { root, descendants }
          }
          const parentPosition = (parent as { position: [number, number, number] }).position
          const parentRotation = (parent as { rotation: number }).rotation
          const childPosition = (root as { position: [number, number, number] }).position
          const childRotation = (root as { rotation: number }).rotation
          const cos = Math.cos(parentRotation)
          const sin = Math.sin(parentRotation)
          const {
            cabinetCornerDerivedRun: _derived,
            nodeSelectionProxyId: _proxy,
            ...metadata
          } = (root.metadata ?? {}) as Record<string, unknown>
          return {
            root: {
              ...root,
              parentId: findLevelAncestorId(rootId, nodes),
              position: [
                parentPosition[0] + childPosition[0] * cos + childPosition[2] * sin,
                parentPosition[1] + childPosition[1],
                parentPosition[2] - childPosition[0] * sin + childPosition[2] * cos,
              ],
              rotation: parentRotation + childRotation,
              metadata,
            } as AnyNode,
            descendants,
            parentId: findLevelAncestorId(rootId, nodes),
          }
        },
      },
    },
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

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
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.temporal.getState().pause()

    const committedId = commitFreshPlacementSubtree(SHELF_ID, {
      position: [2, 0, 3],
      visible: true,
    } as Partial<AnyNode>)
    unsubscribe()

    // A legacy caller's raw pause is kept after the one recorded step.
    expect(useScene.temporal.getState().isTracking).toBe(false)
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
    expect(commits).toHaveLength(1)
    expect(commits[0]?.origin).toBe('local')
    expect(commits[0]?.before.nodes[SHELF_ID]).toBeUndefined()
    expect(commits[0]?.before.nodes[finalId]).toBeUndefined()
    expect(commits[0]?.current.nodes[SHELF_ID]).toBeUndefined()
    expect(commits[0]?.current.nodes[finalId]).toEqual(committed)

    useScene.temporal.getState().resume()
    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[finalId]).toBeUndefined()
    expect(useScene.getState().nodes[SHELF_ID]).toBeUndefined()
    expect((useScene.getState().nodes[LEVEL_ID] as { children: AnyNodeId[] }).children).toEqual([])
  })

  // A roof lives on the level above the walls that carry it: one dropped onto them (a duplicate
  // in hand) goes there in the placement's one step.
  test('a roof dropped onto the walls that carry it lands on a new Roof level, in the one step', () => {
    const corners: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({ parentId: LEVEL_ID, start, end: corners[(i + 1) % 4], height: 2.5 }),
    )
    const segment = RoofSegmentNode.parse({ width: 8, depth: 6, wallHeight: 0 })
    const draft = RoofNode.parse({
      parentId: LEVEL_ID,
      visible: false,
      metadata: { isNew: true },
      children: [segment.id],
    })
    const building = BuildingNode.parse({ children: [LEVEL_ID] })
    useScene.setState({
      nodes: {
        [building.id]: building,
        [LEVEL_ID]: {
          ...level([...walls.map((wall) => wall.id), draft.id]),
          parentId: building.id,
          height: 2.5,
        },
        ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
        [draft.id]: draft,
        [segment.id]: { ...segment, parentId: draft.id },
      },
      rootNodeIds: [building.id],
      collections: {},
      dirtyNodes: new Set(),
    } as never)
    useScene.temporal.getState().clear()

    const committedId = commitFreshPlacementSubtree(draft.id, {
      position: [4, 2.5, 3],
      visible: true,
    } as Partial<AnyNode>)!
    const nodes = useScene.getState().nodes
    const roofLevel = nodes[nodes[committedId]!.parentId as AnyNodeId] as LevelNode
    expect(roofLevel).toMatchObject({ type: 'level', metadata: { role: 'roof' } })
    expect(roofLevel.children as string[]).toEqual([committedId])
    expect((nodes[LEVEL_ID] as LevelNode).children as string[]).not.toContain(committedId)
    expect(useScene.getState().rootNodeIds).toEqual([building.id])

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[committedId]).toBeUndefined()
    expect(useScene.getState().nodes[roofLevel.id]).toBeUndefined()
  })

  test('a window joined at a corner while in hand stays joined: its partner names the committed window', () => {
    const wall = WallNode.parse({ id: 'wall_a', parentId: LEVEL_ID, start: [4, 0], end: [0, 0] })
    const other = WallNode.parse({ id: 'wall_b', parentId: LEVEL_ID, start: [0, 0], end: [0, 3] })
    const draft = WindowNode.parse({
      id: 'window_draft',
      parentId: wall.id,
      wallId: wall.id,
      position: [3.5, 1.5, 0],
      width: 1,
      visible: false,
      metadata: { isNew: true },
      corner: { end: 'end', partnerId: 'window_partner', post: 'none' },
    })
    const partner = WindowNode.parse({
      id: 'window_partner',
      parentId: other.id,
      wallId: other.id,
      position: [0.5, 1.5, 0],
      width: 1,
      corner: { end: 'start', partnerId: draft.id, post: 'none' },
    })
    useScene.setState({
      nodes: {
        [LEVEL_ID]: level([wall.id as AnyNodeId, other.id as AnyNodeId]),
        [wall.id]: { ...wall, children: [draft.id] } as AnyNode,
        [other.id]: { ...other, children: [partner.id] } as AnyNode,
        [draft.id]: draft as AnyNode,
        [partner.id]: partner as AnyNode,
      },
      rootNodeIds: [LEVEL_ID],
      collections: {},
      dirtyNodes: new Set(),
    } as never)

    const committedId = commitFreshPlacementSubtree(draft.id as AnyNodeId, { visible: true })

    const nodes = useScene.getState().nodes as Record<string, AnyNode>
    expect(committedId).toBeTruthy()
    expect((nodes[committedId!] as WindowNode).corner?.partnerId).toBe(partner.id)
    expect((nodes[partner.id] as WindowNode).corner?.partnerId).toBe(committedId!)
  })

  test("never records inside another owner's pause", () => {
    pauseSceneHistory(useScene)
    try {
      const committedId = commitFreshPlacementSubtree(SHELF_ID, {
        position: [2, 0, 3],
        visible: true,
      } as Partial<AnyNode>)
      expect(committedId).toBeTruthy()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(getSceneHistoryPauseDepth()).toBe(1)
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test("lifts the moving node's gesture session for its one step and keeps it after", () => {
    const overlay = beginSceneHistoryPauseSession(useScene, { gesture: SHELF_ID })
    const committedId = commitFreshPlacementSubtree(SHELF_ID, {
      position: [2, 0, 3],
      visible: true,
    } as Partial<AnyNode>)
    expect(committedId).toBeTruthy()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.temporal.getState().isTracking).toBe(false)
    overlay.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('uses the subtree contract for childless variants and never aliases root-only children', () => {
    registerCabinetClonePrepTestKind()
    const childlessCabinet = {
      ...shelf(),
      type: 'cabinet',
      children: [],
      metadata: { isTransient: true, label: 'source' },
    } as AnyNode
    expect(duplicatesAsFreshSubtree(childlessCabinet)).toBe(true)

    const source = {
      ...shelf(),
      children: ['item_original' as AnyNodeId],
      metadata: { isTransient: true, label: 'source' },
    } as AnyNode
    const duplicate = prepareFreshPlacementRootDuplicate(source) as AnyNode & {
      children: AnyNodeId[]
      id?: AnyNodeId
      metadata?: Record<string, unknown>
    }

    expect(duplicate.id).toBeUndefined()
    expect(duplicate.children).toEqual([])
    expect(duplicate.metadata).toEqual({ isNew: true, label: 'source' })
    expect((source as AnyNode & { children: AnyNodeId[] }).children).toEqual(['item_original'])
  })

  // A copy of one side of a corner window kept naming the original's partner, which never named it
  // back: a link that made the copy refuse to join another window.
  test('a copy of one side of a corner window is a plain window', () => {
    const side = WindowNode.parse({
      corner: { end: 'end', partnerId: 'window_partner', post: 'none' },
    })
    expect((prepareFreshPlacementRootDuplicate(side) as WindowNode).corner).toBeUndefined()
    expect(side.corner?.partnerId).toBe('window_partner')
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
    registerCabinetClonePrepTestKind()
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
