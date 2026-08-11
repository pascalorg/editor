import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applyHeightPatch,
  CeilingNode,
  createTerrainField,
  DoorNode as DoorSchema,
  encodeTerrainField,
  flattenPatch,
  GROUND_SUPPORT_ID,
  initSpaceDetectionSync,
  runAsSingleSceneHistoryStep,
  SlabNode,
  spatialGridManager,
  useScene,
  type WallNode,
  WallNode as WallSchema,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  createWallOnCurrentLevel,
  resolveEndpointWallSplit,
  resolveTerrainWallConstructionOptions,
  snapWallDraftPointDetailed,
} from './wall-drafting'
import type { WallPlanPoint } from './wall-snap-geometry'

// `updateNodes` batches its dirty-marking through requestAnimationFrame,
// which bun's test runtime doesn't provide.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

const LEVEL_ID = 'level_test' as AnyNodeId

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id: string): WallNode {
  return {
    ...WallSchema.parse({ start, end, name: id }),
    id: id as WallNode['id'],
    parentId: LEVEL_ID,
  }
}

function seedLevel(walls: WallNode[], extraNodes: AnyNode[] = []) {
  useScene.setState({
    nodes: Object.fromEntries([
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: [...walls.map((wall) => wall.id), ...extraNodes.map((node) => node.id)],
          level: 0,
        } as AnyNode,
      ],
      ...walls.map((wall) => [wall.id, wall] as const),
      ...extraNodes.map((node) => [node.id, node] as const),
    ]),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall',
  )
}

describe('createWallOnCurrentLevel', () => {
  beforeEach(() => {
    useViewer.setState({
      selection: {
        buildingId: 'building_test',
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    // 'lines' keeps the generous commit-time join radius; the other modes
    // still resolve + split within the tight connect radius (covered by the
    // grid-mode cases below). A reshaping-endpoint scope resolves to the
    // 'wall' context without needing the node registry (which isn't loaded in
    // this package's tests).
    useEditor.getState().setSnappingMode('wall', 'lines')
    useInteractionScope
      .getState()
      .begin({ kind: 'reshaping', nodeId: 'wall_a', reshape: 'endpoint', driver: 'tool' })
    seedLevel([makeWall([0, 0], [4, 0], 'wall_a')])
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('endpoint near an existing corner attaches to the corner instead of splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [3.99, 0])

    expect(created?.end).toEqual([4, 0])
    const hostWall = useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode | undefined
    expect(hostWall?.start).toEqual([0, 0])
    expect(hostWall?.end).toEqual([4, 0])
    expect(levelWalls()).toHaveLength(2)
  })

  test('committed wall preserves the ghost construction elevation on ground', () => {
    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 1.75,
      preferredSupportSlabId: GROUND_SUPPORT_ID,
      constructionElevation: 1.75,
      constructionHeight: 2.5,
    })

    expect(created?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(created?.supportOffset).toBe(1.75)
    expect(created?.height).toBe(2.5)
    const support = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      created?.start ?? [0, 0],
      created?.end ?? [0, 0],
      created?.curveOffset,
      created?.thickness,
      created?.supportSlabId,
      undefined,
      created?.supportOffset,
    )
    expect(support.elevation).toBe(1.75)
  })

  test('a wall started on a slab stays plane-bound (no stamped height or offset)', () => {
    const slab = SlabNode.parse({
      id: 'slab_floor',
      parentId: LEVEL_ID,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 5],
        [-1, 5],
      ],
      elevation: 0.05,
      thickness: 0.05,
    })
    seedLevel([makeWall([0, 0], [4, 0], 'wall_a')], [slab])

    // Mirrors the 3D tool's first click on the slab top: frozen plane at the
    // slab elevation, ghost drawn at the level height. None of it may reach
    // the committed node — plane-bound is the default.
    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 0.05,
      preferredSupportSlabId: slab.id,
      constructionElevation: 0.05,
      constructionHeight: 2.55,
    })

    expect(created).not.toBeNull()
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
    expect(created?.supportSlabId).not.toBe(GROUND_SUPPORT_ID)
  })

  test('a non-ground draft never freezes the ghost height, even at a raised plane', () => {
    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 1.2,
      preferredSupportSlabId: null,
      constructionElevation: 1.2,
      constructionHeight: 2.5,
    })

    expect(created).not.toBeNull()
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
  })

  test('2D terrain construction options freeze the first-point elevation and wall height', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [-2, -2] })
    const patch = flattenPatch(field, { minX: -2, minZ: -2, maxX: 2, maxZ: 2 }, 1.5)
    if (!patch) throw new Error('Expected terrain patch')
    const terrain = applyHeightPatch(field, patch)
    const site = {
      id: 'site_test',
      type: 'site',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_test'],
      terrain: encodeTerrainField(terrain),
    } as unknown as AnyNode
    const building = {
      id: 'building_test',
      type: 'building',
      object: 'node',
      parentId: site.id,
      visible: true,
      metadata: {},
      children: [LEVEL_ID],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    } as AnyNode
    const level = {
      id: LEVEL_ID,
      type: 'level',
      object: 'node',
      parentId: building.id,
      visible: true,
      metadata: {},
      children: [],
      level: 0,
      baseElevation: 0,
      height: 3,
    } as AnyNode
    const nodes = Object.fromEntries([site, building, level].map((node) => [node.id, node]))

    expect(resolveTerrainWallConstructionOptions(nodes, LEVEL_ID, [0, 0])).toEqual({
      constructionElevation: 1.5,
      constructionHeight: 3,
      supportCap: 1.5,
    })
    expect(
      resolveTerrainWallConstructionOptions(nodes, LEVEL_ID, [0, 0], { height: 2.25 }),
    ).toEqual({
      constructionElevation: 1.5,
      constructionHeight: 2.25,
      supportCap: 1.5,
    })
  })

  test('endpoint near the host start corner snaps there without splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [0.015, 0])

    expect(created?.end).toEqual([0, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('genuine mid-wall endpoint still splits the host (T junction)', () => {
    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    const walls = levelWalls()
    expect(walls).toHaveLength(3)
    expect(
      walls.some((wall) => wall.start[0] === 0 && wall.end[0] === 2 && wall.end[1] === 0),
    ).toBe(true)
    expect(
      walls.some((wall) => wall.start[0] === 2 && wall.start[1] === 0 && wall.end[0] === 4),
    ).toBe(true)
  })

  test('exact duplicate segment is rejected', () => {
    expect(createWallOnCurrentLevel([0, 0], [4, 0])).toBeNull()
    expect(levelWalls()).toHaveLength(1)
  })

  test('grid mode: endpoint resolved onto a wall body still splits the host', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    expect(levelWalls()).toHaveLength(3)
  })

  test('grid mode: endpoint beyond the connect radius is left alone (no residual snap)', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0.2])

    expect(created?.end).toEqual([2, 0.2])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('mid-span split migrates the host attachments to the covering half', () => {
    const door = DoorSchema.parse({
      position: [1, 1.05, 0],
      parentId: 'wall_a',
      wallId: 'wall_a',
    })
    seedLevel([{ ...makeWall([0, 0], [4, 0], 'wall_a'), children: [door.id] }], [door as AnyNode])

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    const walls = levelWalls()
    const firstHalf = walls.find((wall) => wall.start[0] === 0 && wall.end[0] === 2)
    expect(firstHalf).toBeDefined()
    const migratedDoor = useScene.getState().nodes[door.id as AnyNodeId]
    expect(migratedDoor?.parentId).toBe(firstHalf?.id)
    expect(firstHalf?.children).toContain(door.id)
  })

  test('a splitting commit lands as a single undo step', () => {
    const before = useScene.temporal.getState().pastStates.length

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created).not.toBeNull()
    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
  })

  test('a crossing splits both the host and the inserted wall in one undo step', () => {
    const before = useScene.temporal.getState().pastStates.length

    const created = createWallOnCurrentLevel([2, -2], [2, 2])

    expect(created?.start).toEqual([2, 0])
    expect(created?.end).toEqual([2, 2])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    expect(levelWalls()).toHaveLength(4)
    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
  })

  test('a room divider splits customized auto slabs and ceilings', () => {
    const walls = [
      makeWall([0, 0], [8, 0], 'wall_bottom'),
      makeWall([8, 0], [8, 6], 'wall_right'),
      makeWall([8, 6], [0, 6], 'wall_top'),
      makeWall([0, 6], [0, 0], 'wall_left'),
    ]
    const slab = SlabNode.parse({
      id: 'slab_auto',
      parentId: LEVEL_ID,
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      elevation: 0.18,
      thickness: 0.32,
      autoFromWalls: true,
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_auto',
      parentId: LEVEL_ID,
      polygon: slab.polygon,
      autoFromWalls: true,
    })
    seedLevel(walls, [slab, ceiling])
    const stopDetection = initSpaceDetectionSync(useScene, useEditor)

    try {
      expect(createWallOnCurrentLevel([4, 0], [4, 6])).not.toBeNull()

      const nodes = Object.values(useScene.getState().nodes)
      const slabs = nodes.filter((node) => node.type === 'slab')
      const ceilings = nodes.filter((node) => node.type === 'ceiling')
      expect(slabs).toHaveLength(2)
      expect(ceilings).toHaveLength(2)
      expect(
        slabs.every(
          (node) => node.autoFromWalls && node.elevation === 0.18 && node.thickness === 0.32,
        ),
      ).toBe(true)
      expect(ceilings.every((node) => node.autoFromWalls)).toBe(true)
    } finally {
      stopDetection()
    }
  })

  test('close crossings reject the whole insertion without mutating the scene', () => {
    seedLevel([
      makeWall([2, -2], [2, 2], 'wall_close_a'),
      makeWall([2.0055, -2], [2.0055, 2], 'wall_close_b'),
    ])
    useScene.temporal.getState().clear()
    const beforeNodes = useScene.getState().nodes

    const created = createWallOnCurrentLevel([0, 0], [4, 0])

    expect(created).toBeNull()
    expect(useScene.getState().nodes).toBe(beforeNodes)
    expect(levelWalls()).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
})

describe('resolveEndpointWallSplit', () => {
  beforeEach(() => {
    seedLevel([makeWall([0, 0], [4, 0], 'wall_host'), makeWall([2, 2], [2, 1], 'wall_moved')])
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('endpoint dropped mid-span splits the host and returns the projection', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0.02],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeUndefined()
    const walls = levelWalls()
    expect(walls).toHaveLength(3)
    expect(
      walls.some((wall) => wall.start[0] === 0 && wall.end[0] === 2 && wall.end[1] === 0),
    ).toBe(true)
    expect(
      walls.some((wall) => wall.start[0] === 2 && wall.start[1] === 0 && wall.end[0] === 4),
    ).toBe(true)
  })

  test('mid-span split migrates host attachments to the covering half', () => {
    const door = DoorSchema.parse({
      position: [1, 1.05, 0],
      parentId: 'wall_host',
      wallId: 'wall_host',
    })
    seedLevel(
      [
        { ...makeWall([0, 0], [4, 0], 'wall_host'), children: [door.id] },
        makeWall([2, 2], [2, 1], 'wall_moved'),
      ],
      [door as AnyNode],
    )

    const resolved = resolveEndpointWallSplit({
      point: [2, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    const firstHalf = levelWalls().find((wall) => wall.start[0] === 0 && wall.end[0] === 2)
    expect(firstHalf).toBeDefined()
    const migratedDoor = useScene.getState().nodes[door.id as AnyNodeId]
    expect(migratedDoor?.parentId).toBe(firstHalf?.id)
    expect(firstHalf?.children).toContain(door.id)
  })

  test('a drop near an existing corner resolves to the corner without splitting', () => {
    const resolved = resolveEndpointWallSplit({
      point: [3.99, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([4, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('an opening straddling the drop point skips the split but still resolves the point', () => {
    const door = DoorSchema.parse({
      position: [2, 1.05, 0],
      parentId: 'wall_host',
      wallId: 'wall_host',
    })
    seedLevel(
      [
        { ...makeWall([0, 0], [4, 0], 'wall_host'), children: [door.id] },
        makeWall([2, 2], [2, 1], 'wall_moved'),
      ],
      [door as AnyNode],
    )

    const resolved = resolveEndpointWallSplit({
      point: [2, 0.02],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('a drop beyond the connect radius resolves nothing and splits nothing', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0.2],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toBeNull()
    expect(levelWalls()).toHaveLength(2)
  })

  test('ignored walls (the moved wall and its commit siblings) are never split', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved', 'wall_host'],
    })

    expect(resolved).toBeNull()
    expect(levelWalls()).toHaveLength(2)
  })

  test('split + endpoint write compose into a single history step', () => {
    const before = useScene.temporal.getState().pastStates.length

    runAsSingleSceneHistoryStep(useScene, () => {
      const resolved = resolveEndpointWallSplit({
        point: [2, 0],
        levelId: LEVEL_ID,
        ignoreWallIds: ['wall_moved'],
      })
      useScene
        .getState()
        .updateNodes([{ id: 'wall_moved' as AnyNodeId, data: { end: resolved ?? [2, 0] } }])
    })

    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
    expect(levelWalls()).toHaveLength(3)
    const moved = useScene.getState().nodes['wall_moved' as AnyNodeId] as WallNode
    expect(moved.end).toEqual([2, 0])
  })
})

describe('snapWallDraftPointDetailed', () => {
  test('bypassSnap returns the raw point without endpoint or angle snap', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_a')
    const result = snapWallDraftPointDetailed({
      point: [3.99, 0.03],
      walls: [wall],
      start: [2, 2],
      angleSnap: true,
      bypassSnap: true,
    })

    expect(result.point).toEqual([3.99, 0.03])
    expect(result.snap).toBeNull()
    expect(result.targetWallIds).toEqual([])
  })

  // Endpoint-move regression: walls attached to the moving corner keep their
  // pre-drag coordinates in the scene during the drag, so their stale corner
  // recreates the old junction inside the connect radius. The move tools must
  // pass those walls in `ignoreWallIds` (attached mode) or a sub-5cm corner
  // correction — e.g. squaring a scan-imported 91° junction — can never land.
  test('a stale linked-wall corner swallows a sub-connect-radius correction unless ignored', () => {
    // `wall_d` shares the dragged corner of `wall_c` at [2, 0.03]; the user
    // drops 3cm away at [2, 0] to square the junction.
    const linked = makeWall([2, 0.03], [2, 2], 'wall_d')

    const captured = snapWallDraftPointDetailed({
      point: [2, 0],
      walls: [linked],
      ignoreWallIds: ['wall_c'],
      magnetic: false,
      step: 0,
    })
    expect(captured.point).toEqual([2, 0.03])
    expect(captured.snap).toBe('endpoint')
    expect(captured.targetWallIds).toEqual(['wall_d'])

    const freed = snapWallDraftPointDetailed({
      point: [2, 0],
      walls: [linked],
      ignoreWallIds: ['wall_c', 'wall_d'],
      magnetic: false,
      step: 0,
    })
    expect(freed.point).toEqual([2, 0])
    expect(freed.snap).toBeNull()
  })
})
