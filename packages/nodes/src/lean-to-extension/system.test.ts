import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  LeanToExtensionNode,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  type SceneCommit,
  SlabNode,
  subscribeSceneCommits,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { columnDefinition } from '../column'
import {
  createLeanToAssembly,
  leanToCornerPostIndex,
  managedLeanToPostIndex,
  managedLeanToPostSide,
} from './assembly'
import { resolveConicalLeanToPlacement } from './conical-host'
import { resolveLeanToFreestandingRunPlacement, resolveLeanToSlabEdgePlacement } from './placement'
import { initializeLeanToExtensionSync } from './system'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

let stopSync = () => {}

describe('lean-to scene commit boundary', () => {
  beforeAll(() => {
    if (!nodeRegistry.has(columnDefinition.kind)) {
      registerNode(columnDefinition as unknown as AnyNodeDefinition)
    }
  })

  beforeEach(() => {
    const level = LevelNode.parse({ id: 'level_lean_commit', level: 0 })
    const wall = WallNode.parse({
      id: 'wall_lean_commit',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_commit',
      parentId: wall.id,
      autoSpan: false,
      position: [3, 0, 0.05],
    })
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [
        level,
        { ...wall, children: [assembly.extension.id] },
        assembly.extension,
        ...assembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))
  })

  afterEach(() => stopSync())

  test('includes a projection edit and managed roof resize in one commit', () => {
    const commits: SceneCommit[] = []
    const stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
    const leanTo = Object.values(useScene.getState().nodes).find(
      (node): node is LeanToExtensionNode => node.type === 'lean-to-extension',
    )!
    const roof = useScene.getState().nodes[leanTo.children[0] as AnyNodeId]!
    const segmentId = roof.type === 'roof' ? (roof.children[0] as AnyNodeId) : ('' as AnyNodeId)

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { projection: 4 })

    expect(commits).toHaveLength(1)
    expect(commits[0]?.current.nodes[segmentId]?.type).toBe('roof-segment')
    expect((commits[0]?.current.nodes[segmentId] as { depth: number }).depth).toBeCloseTo(4.27)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    stopCommits()
  })

  test('preserves managed post rotation while parent edits still update its height', () => {
    const leanTo = Object.values(useScene.getState().nodes).find(
      (node): node is LeanToExtensionNode => node.type === 'lean-to-extension',
    )!
    const post = leanTo.children
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .find((node): node is Extract<AnyNode, { type: 'column' }> => node?.type === 'column')!

    useScene.getState().updateNode(post.id as AnyNodeId, {
      rotation: Math.PI,
      supportStyle: 'k-brace',
    })
    const rotatedPost = useScene.getState().nodes[post.id as AnyNodeId] as typeof post
    expect(rotatedPost.rotation).toBe(Math.PI)
    expect(rotatedPost.supportStyle).toBe('k-brace')
    const heightBeforeParentEdit = rotatedPost.height

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { projection: 4 })

    const postAfterParentEdit = useScene.getState().nodes[post.id as AnyNodeId] as typeof post
    expect(postAfterParentEdit.rotation).toBe(Math.PI)
    expect(postAfterParentEdit.supportStyle).toBe('k-brace')
    expect(postAfterParentEdit.height).not.toBe(heightBeforeParentEdit)
  })

  test('tracks the conical host diameter and cylindrical wall height', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_conical_sync', level: 0 })
    const roof = RoofNode.parse({
      id: 'roof_conical_sync',
      parentId: level.id,
      children: ['rseg_conical_sync'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_conical_sync',
      parentId: roof.id,
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 3,
      children: ['leanto_conical_sync'],
    })
    const leanTo = resolveConicalLeanToPlacement(segment, {
      id: 'leanto_conical_sync',
      projection: 3,
    })!
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [roof.id] },
        roof,
        segment,
        assembly.extension,
        ...assembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    useScene.getState().updateNode(segment.id as AnyNodeId, {
      width: 10,
      depth: 10,
      wallHeight: 3.5,
    })

    const synced = useScene.getState().nodes[leanTo.id as AnyNodeId]
    expect(synced?.type).toBe('lean-to-extension')
    if (synced?.type !== 'lean-to-extension') return
    expect(synced.projection).toBe(3)
    expect(synced.span).toBeCloseTo(10 * Math.PI)
    expect(synced.position).toEqual([0, 0, 5])
    expect(synced.spanArcCenterZ).toBe(-5)
    expect(synced.spanArcRadius).toBe(5)
    expect(synced.highEdgeHeight).toBe(3.5)
    const posts = synced.children
      .map((id) => useScene.getState().nodes[id as AnyNodeId])
      .filter((node) => node?.type === 'column')
    expect(posts).toHaveLength(11)
  })

  test('preserves the resolved free wall span across commit synchronization', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_shared_wall', level: 0 })
    const wall = WallNode.parse({
      id: 'wall_shared_span',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const existing = LeanToExtensionNode.parse({
      id: 'leanto_existing_span',
      parentId: wall.id,
      autoSpan: false,
      position: [1, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const candidate = LeanToExtensionNode.parse({
      id: 'leanto_remaining_span',
      parentId: wall.id,
      autoSpan: true,
      position: [4, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const existingAssembly = createLeanToAssembly(existing)
    const candidateAssembly = createLeanToAssembly(candidate)
    const nodes = Object.fromEntries(
      [
        level,
        { ...wall, children: [existing.id, candidate.id] },
        existingAssembly.extension,
        ...existingAssembly.children,
        candidateAssembly.extension,
        ...candidateAssembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    useScene.getState().updateNode(candidate.id as AnyNodeId, { projection: 3 })

    const committed = useScene.getState().nodes[candidate.id as AnyNodeId]
    expect(committed?.type).toBe('lean-to-extension')
    if (committed?.type !== 'lean-to-extension') return
    expect(committed.position[0]).toBeCloseTo(4, 6)
    expect(committed.span).toBeCloseTo(4, 6)
  })

  test('synchronizes a complete corner joint after two extensions become neighbors', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_corner_sync', level: 0 })
    const wallA = WallNode.parse({
      id: 'wall_corner_sync_a',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_corner_sync_b',
      parentId: level.id,
      start: [4, 0],
      end: [4, -4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_corner_sync_a',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_corner_sync_b',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const assemblyA = createLeanToAssembly(leanToA)
    const assemblyB = createLeanToAssembly(leanToB)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [wallA.id, wallB.id] },
        { ...wallA, children: [leanToA.id] },
        { ...wallB, children: [leanToB.id] },
        assemblyA.extension,
        ...assemblyA.children,
        assemblyB.extension,
        ...assemblyB.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const syncedA = syncedNodes[leanToA.id as AnyNodeId]
    const syncedB = syncedNodes[leanToB.id as AnyNodeId]
    expect(syncedA?.type).toBe('lean-to-extension')
    expect(syncedB?.type).toBe('lean-to-extension')
    if (syncedA?.type !== 'lean-to-extension' || syncedB?.type !== 'lean-to-extension') return
    expect(syncedA.rightEndCondition).toBe('joined')
    expect(syncedB.leftEndCondition).toBe('joined')
    expect(syncedA.metadata).toMatchObject({
      leanToCornerJoints: { right: { gutterMitre: Math.PI / 4 } },
    })
    expect(syncedB.metadata).toMatchObject({
      leanToCornerJoints: { left: { gutterMitre: Math.PI / 4 } },
    })

    const roofA = syncedA.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .find((node) => node?.type === 'roof')
    const segmentA =
      roofA?.type === 'roof'
        ? roofA.children
            .map((id) => syncedNodes[id as AnyNodeId])
            .find((node) => node?.type === 'roof-segment')
        : undefined
    const gutterA =
      segmentA?.type === 'roof-segment'
        ? segmentA.children
            .map((id) => syncedNodes[id as AnyNodeId])
            .find((node) => node?.type === 'gutter')
        : undefined
    expect(segmentA).toMatchObject({ shedOpenEndSides: ['right'] })
    expect(gutterA?.metadata).toMatchObject({
      leanToGutterMitres: { left: 0, right: Math.PI / 4 },
    })

    const cornerPosts = [...syncedA.children, ...syncedB.children]
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter((node) => {
        if (node?.type !== 'column') return false
        const index = managedLeanToPostIndex(node)
        return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
      })
    expect(cornerPosts).toHaveLength(1)
  })

  test('synchronizes both sides of a continuous freestanding canopy corner', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_free_run_sync', level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(level.id, [0, 0], [4, 0])!
    const second = resolveLeanToFreestandingRunPlacement(level.id, [4, 0], [4, 4])!
    const firstAssembly = createLeanToAssembly(first)
    const secondAssembly = createLeanToAssembly(second)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [first.id, second.id] },
        firstAssembly.extension,
        ...firstAssembly.children,
        secondAssembly.extension,
        ...secondAssembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const syncedFirst = syncedNodes[first.id as AnyNodeId]
    const syncedSecond = syncedNodes[second.id as AnyNodeId]
    expect(syncedFirst).toMatchObject({
      type: 'lean-to-extension',
      rightEndCondition: 'joined',
      metadata: { leanToCornerJoints: { right: { gutterMitre: -Math.PI / 4 } } },
    })
    expect(syncedSecond).toMatchObject({
      type: 'lean-to-extension',
      leftEndCondition: 'joined',
      metadata: { leanToCornerJoints: { left: { gutterMitre: -Math.PI / 4 } } },
    })
    const cornerPosts = [syncedFirst, syncedSecond]
      .flatMap((node) => node?.children ?? [])
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter(
        (node) =>
          node?.type === 'column' &&
          (managedLeanToPostIndex(node) === leanToCornerPostIndex('left') ||
            managedLeanToPostIndex(node) === leanToCornerPostIndex('right')),
      )
    expect(cornerPosts).toHaveLength(1)
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('synchronizes continuous %s roof and gutter miters after both runs exist', (canopyForm) => {
    stopSync()
    const level = LevelNode.parse({ id: `level_${canopyForm}_run_sync`, level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(
      level.id,
      [0, 0],
      [4, 0],
      false,
      canopyForm,
    )!
    const second = resolveLeanToFreestandingRunPlacement(
      level.id,
      [4, 0],
      [4, 4],
      false,
      canopyForm,
    )!
    const firstAssembly = createLeanToAssembly(first)
    const secondAssembly = createLeanToAssembly(second)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [first.id, second.id] },
        firstAssembly.extension,
        ...firstAssembly.children,
        secondAssembly.extension,
        ...secondAssembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const syncedFirst = syncedNodes[first.id as AnyNodeId]
    expect(syncedFirst).toMatchObject({
      type: 'lean-to-extension',
      rightEndCondition: 'joined',
      metadata: { leanToFreestandingCanopyJoints: { right: {} } },
    })
    const jointMetadata = syncedFirst?.metadata as
      | { leanToFreestandingCanopyJoints?: { right?: { gutterMitre?: number } } }
      | undefined
    expect(jointMetadata?.leanToFreestandingCanopyJoints?.right?.gutterMitre).toBeCloseTo(
      -Math.PI / 4,
      12,
    )
    if (syncedFirst?.type !== 'lean-to-extension') return
    const roof = syncedFirst.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .find((node) => node?.type === 'roof')
    const segments =
      roof?.type === 'roof'
        ? roof.children
            .map((id) => syncedNodes[id as AnyNodeId])
            .filter((node) => node?.type === 'roof-segment')
        : []
    const primary = segments.find(
      (segment) =>
        (segment.metadata as Record<string, unknown> | undefined)?.leanToRoofPlane !== 'opposite',
    )
    expect(primary?.trim.right + primary?.trim.left).toBeCloseTo(first.rightOverhang)
    expect(
      canopyForm === 'gable' ? primary?.trim.frontRightX : primary?.trim.backLeftX,
    ).toBeCloseTo(first.projection + first.lowOverhang)
    const gutter = primary?.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .find(
        (node) =>
          node?.type === 'gutter' &&
          (node.metadata as Record<string, unknown> | undefined)?.leanToDrainageSide !== 'opposite',
      )
    expect(gutter?.endCapLeft && gutter?.endCapRight).toBe(false)
    const gutterMetadata = gutter?.metadata as
      | { leanToGutterMitres?: { left?: number } }
      | undefined
    expect(gutterMetadata?.leanToGutterMitres?.left).toBeCloseTo(
      canopyForm === 'butterfly' ? -Math.PI / 4 : 0,
      12,
    )
  })

  test('synchronizes an edge-snapped straight run with open gutters and one joint pillar', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_linear_sync', level: 0 })
    const wall = WallNode.parse({
      id: 'wall_linear_sync',
      parentId: level.id,
      start: [0, 0],
      end: [12, 0],
    })
    const left = LeanToExtensionNode.parse({
      id: 'leanto_linear_sync_left',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 4,
    })
    const right = LeanToExtensionNode.parse({
      id: 'leanto_linear_sync_right',
      parentId: wall.id,
      position: [6.3, 0, 0.05],
      span: 4,
    })
    const leftAssembly = createLeanToAssembly(left)
    const rightAssembly = createLeanToAssembly(right)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [wall.id] },
        { ...wall, children: [left.id, right.id] },
        leftAssembly.extension,
        ...leftAssembly.children,
        rightAssembly.extension,
        ...rightAssembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const synced = useScene.getState().nodes
    const extensions = [left.id, right.id].map((id) => synced[id as AnyNodeId])
    expect(extensions.every((node) => node?.type === 'lean-to-extension')).toBe(true)
    const posts = extensions.flatMap((node) =>
      node?.type === 'lean-to-extension'
        ? node.children
            .map((id) => synced[id as AnyNodeId])
            .filter((child) => child?.type === 'column')
        : [],
    )
    const jointPosts = posts.filter((post) => {
      if (post?.type !== 'column') return false
      const index = managedLeanToPostIndex(post)
      return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
    })
    expect(jointPosts).toHaveLength(1)

    const gutters = extensions.map((node) => {
      if (node?.type !== 'lean-to-extension') return undefined
      const roof = node.children
        .map((id) => synced[id as AnyNodeId])
        .find((child) => child?.type === 'roof')
      if (roof?.type !== 'roof') return undefined
      const segment = roof.children
        .map((id) => synced[id as AnyNodeId])
        .find((child) => child?.type === 'roof-segment')
      return segment?.type === 'roof-segment'
        ? segment.children
            .map((id) => synced[id as AnyNodeId])
            .find((child) => child?.type === 'gutter')
        : undefined
    })
    expect(gutters[0]?.type === 'gutter' && gutters[0].endCapRight).toBe(false)
    expect(gutters[1]?.type === 'gutter' && gutters[1].endCapLeft).toBe(false)
  })

  test('removes regular posts outside a synchronized internal L valley', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_inner_post_sync', level: 0 })
    const wallA = WallNode.parse({
      id: 'wall_inner_post_sync_a',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_inner_post_sync_b',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_inner_post_sync_a',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_inner_post_sync_b',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
    })
    const assemblyA = createLeanToAssembly(leanToA)
    const assemblyB = createLeanToAssembly(leanToB)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [wallA.id, wallB.id] },
        { ...wallA, children: [leanToA.id] },
        { ...wallB, children: [leanToB.id] },
        assemblyA.extension,
        ...assemblyA.children,
        assemblyB.extension,
        ...assemblyB.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const regularIndexesA = (syncedNodes[leanToA.id as AnyNodeId]?.children ?? [])
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter((node) => node?.type === 'column')
      .map((post) => managedLeanToPostIndex(post))
    const regularIndexesB = (syncedNodes[leanToB.id as AnyNodeId]?.children ?? [])
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter((node) => node?.type === 'column')
      .map((post) => managedLeanToPostIndex(post))

    expect(regularIndexesA).not.toContain(2)
    expect(regularIndexesB).not.toContain(0)
  })

  test('tracks an upper slab edge while retaining one front row of posts', () => {
    stopSync()
    const building = BuildingNode.parse({ id: 'building_slab_host_sync' })
    const ground = LevelNode.parse({
      id: 'level_slab_host_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const first = LevelNode.parse({
      id: 'level_slab_host_first',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const slab = SlabNode.parse({
      id: 'slab_host_sync',
      parentId: first.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      elevation: 0.05,
      thickness: 0.2,
    })
    const hostNodes = {
      [building.id]: building,
      [ground.id]: ground,
      [first.id]: first,
      [slab.id]: slab,
    } as Record<AnyNodeId, AnyNode>
    const leanTo = resolveLeanToSlabEdgePlacement({
      activeLevelId: ground.id,
      edgeIndex: 0,
      edgeT: 0.5,
      nodes: hostNodes,
      slab,
    })!
    const assembly = createLeanToAssembly(leanTo, undefined, hostNodes)
    const nodes = Object.fromEntries(
      [
        { ...building, children: [ground.id, first.id] },
        { ...ground, children: [leanTo.id] },
        { ...first, children: [slab.id] },
        slab,
        assembly.extension,
        ...assembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [building.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    useScene.getState().updateNode(slab.id as AnyNodeId, {
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      elevation: 0.15,
    })

    const synced = useScene.getState().nodes[leanTo.id as AnyNodeId]
    expect(synced?.type).toBe('lean-to-extension')
    if (synced?.type !== 'lean-to-extension') return
    expect(synced.position).toEqual([4, 0, 0])
    expect(synced.span).toBeCloseTo(7.9, 6)
    expect(synced.highEdgeHeight).toBeCloseTo(2.95, 6)
    const posts = synced.children
      .map((id) => useScene.getState().nodes[id as AnyNodeId])
      .filter((node) => node?.type === 'column')
    expect(posts).toHaveLength(4)
    expect(
      posts.every((post) => post?.type === 'column' && managedLeanToPostSide(post) === 'low'),
    ).toBe(true)
  })

  test('keeps a deleted freestanding pillar omitted while the remaining pillars resize', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_omitted_post', level: 0 })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_omitted_post',
      parentId: level.id,
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      connectionMode: 'manual',
      autoSpan: false,
      span: 4,
    })
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [{ ...level, children: [leanTo.id] }, assembly.extension, ...assembly.children].map(
        (node) => [node.id, node],
      ),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const deletedPost = assembly.posts.find(
      (post) => managedLeanToPostSide(post) === 'high' && managedLeanToPostIndex(post) === 2,
    )!
    const resizingPost = assembly.posts.find(
      (post) => managedLeanToPostSide(post) === 'low' && managedLeanToPostIndex(post) === 2,
    )!
    const originalResizingX = resizingPost.position[0]

    useScene.getState().deleteNode(deletedPost.id as AnyNodeId)

    const afterDelete = useScene.getState().nodes[leanTo.id as AnyNodeId]
    expect(afterDelete?.type).toBe('lean-to-extension')
    if (afterDelete?.type !== 'lean-to-extension') return
    expect(afterDelete.omittedPostSlots).toEqual([{ side: 'high', index: 2, layoutCount: 3 }])
    expect(
      afterDelete.children
        .map((id) => useScene.getState().nodes[id as AnyNodeId])
        .some(
          (child) =>
            child?.type === 'column' &&
            managedLeanToPostSide(child) === 'high' &&
            managedLeanToPostIndex(child) === 2,
        ),
    ).toBe(false)

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { span: 8 })

    const afterResize = useScene.getState().nodes[leanTo.id as AnyNodeId]
    expect(afterResize?.type).toBe('lean-to-extension')
    if (afterResize?.type !== 'lean-to-extension') return
    const posts = afterResize.children
      .map((id) => useScene.getState().nodes[id as AnyNodeId])
      .filter((child): child is Extract<AnyNode, { type: 'column' }> => child?.type === 'column')
    expect(posts).toHaveLength(7)
    expect(
      posts.some(
        (post) => managedLeanToPostSide(post) === 'high' && managedLeanToPostIndex(post) === 3,
      ),
    ).toBe(false)
    expect(posts.find((post) => post.id === resizingPost.id)?.position[0]).not.toBe(
      originalResizingX,
    )
  })

  test('creates each gable eave under its matching managed roof plane', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_initial_gable_sync', level: 0 })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_initial_gable_sync',
      parentId: level.id,
      canopyForm: 'gable',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      connectionMode: 'manual',
      autoSpan: false,
    })
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes: {
        [level.id]: { ...level, children: [leanTo.id] },
        [leanTo.id]: leanTo,
      },
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const syncedLeanTo = syncedNodes[leanTo.id as AnyNodeId]
    expect(syncedLeanTo?.type).toBe('lean-to-extension')
    if (syncedLeanTo?.type !== 'lean-to-extension') return
    const roof = syncedLeanTo.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .find((node) => node?.type === 'roof')
    expect(roof?.type).toBe('roof')
    if (roof?.type !== 'roof') return
    const segments = roof.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter((node) => node?.type === 'roof-segment')
    expect(segments).toHaveLength(2)
    for (const segment of segments) {
      const gutters = segment.children
        .map((id) => syncedNodes[id as AnyNodeId])
        .filter((node) => node?.type === 'gutter')
      expect(gutters).toHaveLength(1)
      expect(gutters[0]?.parentId).toBe(segment.id)
    }
  })

  test('reconciles roof planes and drainage while a freestanding canopy changes form', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_canopy_form_sync', level: 0 })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_canopy_form_sync',
      parentId: level.id,
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      connectionMode: 'manual',
      autoSpan: false,
    })
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [{ ...level, children: [leanTo.id] }, assembly.extension, ...assembly.children].map(
        (node) => [node.id, node],
      ),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { canopyForm: 'gable' })

    const gableSegments = Object.values(useScene.getState().nodes).filter(
      (node) => node.type === 'roof-segment' && node.parentId === assembly.roof.id,
    )
    expect(gableSegments).toHaveLength(2)
    expect(gableSegments.every((segment) => segment.roofType === 'shed')).toBe(true)
    expect(
      gableSegments.flatMap((segment) =>
        segment.children
          .map((id) => useScene.getState().nodes[id as AnyNodeId])
          .filter((node) => node?.type === 'gutter'),
      ),
    ).toHaveLength(2)
    const gableRoof = gableSegments[0]
    if (!gableRoof) return

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { canopyForm: 'butterfly' })

    const butterflySegments = Object.values(useScene.getState().nodes).filter(
      (node) => node.type === 'roof-segment' && node.parentId === assembly.roof.id,
    )
    expect(butterflySegments).toHaveLength(2)
    expect(butterflySegments.every((segment) => segment.roofType === 'shed')).toBe(true)
    expect(
      butterflySegments.flatMap((segment) =>
        segment.children
          .map((id) => useScene.getState().nodes[id as AnyNodeId])
          .filter((node) => node?.type === 'gutter'),
      ),
    ).toHaveLength(1)

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { canopyForm: 'mono' })

    const monoRoof = useScene.getState().nodes[gableRoof.id as AnyNodeId]
    expect(monoRoof?.type).toBe('roof-segment')
    if (monoRoof?.type !== 'roof-segment') return
    expect(monoRoof.roofType).toBe('shed')
    expect(
      Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'roof-segment' && node.parentId === assembly.roof.id,
      ),
    ).toHaveLength(1)
    expect(
      monoRoof.children
        .map((id) => useScene.getState().nodes[id as AnyNodeId])
        .filter((node) => node?.type === 'gutter'),
    ).toHaveLength(1)
  })
})
