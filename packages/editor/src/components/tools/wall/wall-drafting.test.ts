import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applyHeightPatch,
  BlockNode,
  BuildingNode,
  CeilingNode,
  createTerrainField,
  DoorNode as DoorSchema,
  encodeTerrainField,
  findOpenWallEnds,
  flattenPatch,
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
  initSpaceDetectionSync,
  LevelNode as LevelSchema,
  nodeRegistry,
  registerNode,
  resolveTerrainWallConstructionOptions,
  runAsSingleSceneHistoryStep,
  SlabNode,
  snapWorldXZToBuildingLocal,
  spatialGridManager,
  useScene,
  type WallNode,
  WallNode as WallSchema,
} from '@pascal-app/core'
import {
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
} from '@pascal-app/core/scene-migrations'
import { useViewer } from '@pascal-app/viewer'
import type { SnappingMode } from '../../../lib/snapping-mode'
import { snapBuildingLocalToWorldGrid } from '../../../lib/world-grid-snap'
import useEditor, { isAngleSnapActive, isMagneticSnapActive } from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  createWallOnCurrentLevel,
  getSegmentGridStep,
  resolveEndpointWallSplit,
  snapWallDraftPoint,
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

// Seeds a site/building/level chain whose terrain field carries a sculpted
// patch raised to `liftTo` in the far corner — enough for ground drafts to be
// terrain chains, while the walls under test stand where the ground is 0.
function seedTerrainLevel(walls: WallNode[], liftTo: number) {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, origin: [-4, -4] })
  const patch = flattenPatch(field, { maxX: -2, maxZ: -2, minX: -4, minZ: -4 }, liftTo)
  if (!patch) throw new Error('Expected terrain patch')
  const terrain = applyHeightPatch(field, patch)
  useScene.setState({
    nodes: Object.fromEntries([
      [
        'site_test',
        {
          id: 'site_test',
          type: 'site',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['building_test'],
          terrain: encodeTerrainField(terrain),
        } as unknown as AnyNode,
      ],
      [
        'building_test',
        {
          id: 'building_test',
          type: 'building',
          object: 'node',
          parentId: 'site_test',
          visible: true,
          metadata: {},
          children: [LEVEL_ID],
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        } as AnyNode,
      ],
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: 'building_test',
          visible: true,
          metadata: {},
          children: walls.map((wall) => wall.id),
          level: 0,
          baseElevation: 0,
          height: 2.5,
        } as AnyNode,
      ],
      ...walls.map((wall) => [wall.id, wall] as const),
    ]),
    rootNodeIds: ['site_test' as AnyNodeId],
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
  // Set by tests that mutate the process-wide node registry; restored here
  // so the mutation can't leak into later test files (order-dependent flakes).
  let restoreRegistry: (() => void) | undefined

  afterEach(() => {
    restoreRegistry?.()
    restoreRegistry = undefined
  })

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

  describe('on a level below grade', () => {
    const seedBasement = (thickness?: number) => {
      const basement = LevelSchema.parse({
        id: 'level_cellar',
        parentId: 'building_house',
        level: -1,
        baseElevation: -2.5,
        height: 2.5,
      })
      const main = LevelSchema.parse({
        id: 'level_main',
        parentId: 'building_house',
        level: 0,
        height: 2.5,
      })
      const building = BuildingNode.parse({
        id: 'building_house',
        children: [basement.id, main.id],
      })
      useScene.setState({
        nodes: Object.fromEntries(
          [building, basement, main].map((node) => [node.id, node as AnyNode]),
        ),
        rootNodeIds: [building.id],
        dirtyNodes: new Set(),
        collections: {},
      } as never)
      useEditor.setState({
        toolDefaults: {
          ...useEditor.getState().toolDefaults,
          wall: thickness === undefined ? {} : { thickness },
        },
      } as never)
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
    }
    const select = (levelId: string) =>
      useViewer.setState({
        selection: { buildingId: 'building_house', levelId, zoneId: null, selectedIds: [] },
      } as never)
    let previousDefaults: ReturnType<typeof useEditor.getState>['toolDefaults']
    beforeEach(() => {
      previousDefaults = useEditor.getState().toolDefaults
    })
    afterEach(() => {
      useEditor.setState({ toolDefaults: previousDefaults } as never)
    })

    test('the wall tool draws an 8 in CMU foundation wall with 2x4 furring flat inside, 0.241 m thick', () => {
      seedBasement()
      select('level_cellar')
      const created = createWallOnCurrentLevel([0, 0], [4, 0])
      expect(created?.thickness).toBe(0.241)
      expect(created?.assembly?.layers).toMatchObject([
        { material: 'cmu', core: true, thickness: 0.203 },
        { role: 'furring', thickness: 0.038 },
      ])
      const stored = useScene.getState().nodes[created!.id] as WallNode
      expect(stored.assembly).toEqual(created?.assembly)
    })

    test('only the walls against the ground are foundation walls: the perimeter is, a partition and a wall inside are not', () => {
      seedBasement()
      select('level_cellar')
      const sides: Array<[[number, number], [number, number]]> = [
        [
          [0, 0],
          [8, 0],
        ],
        [
          [8, 0],
          [8, 6],
        ],
        [
          [8, 6],
          [0, 6],
        ],
        [
          [0, 6],
          [0, 0],
        ],
      ]
      for (const [start, end] of sides) {
        expect(createWallOnCurrentLevel(start, end)?.thickness).toBe(0.241)
      }
      // Not foundation walls: they take the interior wall type of the Build panel.
      const partition = createWallOnCurrentLevel([4, 0], [4, 6])
      expect(partition?.assembly?.presetId).toBe('interior-2x4-drywall')
      const dangling = createWallOnCurrentLevel([0, 3], [3, 3])
      expect(dangling?.assembly?.presetId).toBe('interior-2x4-drywall')
      // a bay on the outside of the east wall is on the outline again
      const bay = createWallOnCurrentLevel([8, 1], [11, 1])
      expect(bay?.thickness).toBe(0.241)
    })

    test('the ground floor over it draws the exterior wall type, not a foundation wall', () => {
      seedBasement()
      select('level_main')
      const created = createWallOnCurrentLevel([0, 0], [4, 0])
      expect(created?.assembly?.presetId).toBe('exterior-2x6-siding')
    })

    test('the Build panel wall types build what is drawn; plain draws a single layer', () => {
      const previousTypes = useEditor.getState().wallTypes
      try {
        seedBasement()
        select('level_main')
        useEditor.getState().setWallType('exterior', 'exterior-2x6-stucco')
        expect(createWallOnCurrentLevel([0, 0], [4, 0])?.assembly?.presetId).toBe(
          'exterior-2x6-stucco',
        )
        useEditor.getState().setWallType('exterior', 'plain')
        const plain = createWallOnCurrentLevel([0, 2], [4, 2])
        expect(plain?.assembly).toBeUndefined()
        expect(plain?.thickness).toBeUndefined()
        // An unknown id falls back to the default type.
        useEditor.getState().setWallType('exterior', 'no-such-preset')
        expect(useEditor.getState().wallTypes.exterior).toBe('exterior-2x6-siding')
      } finally {
        useEditor.setState({ wallTypes: previousTypes } as never)
      }
    })

    test('a thickness set in the tool defaults is kept, with no stack', () => {
      seedBasement(0.3)
      select('level_cellar')
      const created = createWallOnCurrentLevel([0, 0], [4, 0])
      expect(created?.thickness).toBe(0.3)
      expect(created?.assembly).toBeUndefined()
    })
  })

  test('endpoint near an existing corner attaches to the corner instead of splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [3.99, 0])

    expect(created?.end).toEqual([4, 0])
    const hostWall = useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode | undefined
    expect(hostWall?.start).toEqual([0, 0])
    expect(hostWall?.end).toEqual([4, 0])
    expect(levelWalls()).toHaveLength(2)
  })

  test('committed wall preserves the ghost construction elevation on terrain', () => {
    seedTerrainLevel([makeWall([0, 0], [4, 0], 'wall_a')], 1.75)

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

  test('never exposes a raised wall at floor elevation during commit', () => {
    const observed: WallNode[] = []
    const unsubscribe = useScene.subscribe((state) => {
      const wall = Object.values(state.nodes).find(
        (node): node is WallNode => node?.type === 'wall' && node.id !== 'wall_a',
      )
      if (wall) observed.push(wall)
    })

    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 1.75,
      preferredSupportSlabId: GROUND_SUPPORT_ID,
      constructionElevation: 1.75,
      constructionHeight: 2.5,
      flatConstructionBase: true,
    })
    unsubscribe()

    expect(created).not.toBeNull()
    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every((wall) => wall.supportSlabId === GROUND_SUPPORT_ID)).toBe(true)
    expect(observed.every((wall) => wall.supportOffset === 1.75)).toBe(true)
  })

  test('keeps a node-top room plane flat across changing terrain', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [0, 0] })
    const patch = flattenPatch(field, { minX: 3.5, minZ: 0, maxX: 4, maxZ: 4 }, 1)
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
    useScene.setState({
      nodes: Object.fromEntries([site, building, level].map((node) => [node.id, node])),
      rootNodeIds: [site.id],
      dirtyNodes: new Set(),
    } as never)

    const lowTerrainWall = createWallOnCurrentLevel([0, 0], [1, 0], {
      constructionElevation: 3,
      constructionHeight: 2.5,
      flatConstructionBase: true,
      supportCap: 3,
    })
    const highTerrainWall = createWallOnCurrentLevel([4, 0], [4, 1], {
      constructionElevation: 3,
      constructionHeight: 2.5,
      flatConstructionBase: true,
      supportCap: 3,
    })

    expect(lowTerrainWall?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(highTerrainWall?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(lowTerrainWall?.supportOffset).toBeCloseTo(3)
    expect(highTerrainWall?.supportOffset).toBeCloseTo(2)
    expect(
      spatialGridManager.getSlabSupportForWall(
        LEVEL_ID,
        lowTerrainWall!.start,
        lowTerrainWall!.end,
        lowTerrainWall!.curveOffset,
        lowTerrainWall!.thickness,
        lowTerrainWall!.supportSlabId,
        undefined,
        lowTerrainWall!.supportOffset,
      ).elevation,
    ).toBeCloseTo(3)
    expect(
      spatialGridManager.getSlabSupportForWall(
        LEVEL_ID,
        highTerrainWall!.start,
        highTerrainWall!.end,
        highTerrainWall!.curveOffset,
        highTerrainWall!.thickness,
        highTerrainWall!.supportSlabId,
        undefined,
        highTerrainWall!.supportOffset,
      ).elevation,
    ).toBeCloseTo(3)
  })

  test('pins an existing construction source before a generated room slab can lift it', () => {
    // The reset + throwaway `block` registration is scoped to this test —
    // the registry is a process-wide singleton, so leaking it would leave
    // later test FILES with a stripped registry (order-dependent flakes).
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    spatialGridManager.clear()
    registerNode({
      kind: 'block',
      schemaVersion: 2,
      schema: BlockNode,
      category: 'structure',
      defaults: () => BlockNode.parse({ name: 'Block' }),
      capabilities: {
        floorPlaced: {
          footprint: () => ({ dimensions: [4, 2.4, 4], rotation: [0, 0, 0] }),
        },
      },
    } as never)

    const slope = BlockNode.parse({
      name: 'Existing slope',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
    })
    seedLevel([makeWall([0, 0], [4, 0], 'wall_a')], [slope as AnyNode])

    createWallOnCurrentLevel([0, 1], [1, 1], {
      constructionElevation: 2.4,
      constructionHeight: 2.5,
      constructionSourceNodeId: slope.id,
      flatConstructionBase: true,
      supportCap: 2.4,
    })

    const pinnedSlope = useScene.getState().nodes[slope.id] as BlockNode
    expect(pinnedSlope.supportSlabId).toBe(GROUND_SUPPORT_ID)

    const generatedSlab = SlabNode.parse({
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      elevation: 2.45,
      autoFromWalls: true,
      parentId: LEVEL_ID,
    })
    spatialGridManager.handleNodeCreated(generatedSlab as AnyNode, LEVEL_ID)

    expect(
      getFloorPlacedElevation({
        node: pinnedSlope,
        nodes: {
          ...useScene.getState().nodes,
          [generatedSlab.id]: generatedSlab as AnyNode,
        },
        position: pinnedSlope.position,
        rotation: [0, pinnedSlope.rotation, 0],
      }),
    ).toBe(0)
  })

  test('a flat-ground draft (no sculpted terrain) commits plane-bound', () => {
    // Pointing at bare ground freezes a GROUND construction plane at 0. With
    // no terrain field in the scene that plane is just the backdrop — none of
    // the draft options may reach the committed node: no stamped height, no
    // persisted ground host (a slab drawn later must lift the wall), no
    // election cap.
    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 0,
      preferredSupportSlabId: GROUND_SUPPORT_ID,
      constructionElevation: 0,
      constructionHeight: 2.5,
    })

    expect(created).not.toBeNull()
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
    expect(created?.supportSlabId).toBeUndefined()
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

  test('a fresh-scene wall started on a slab node-top elects that slab plane-bound', () => {
    const slab = SlabNode.parse({
      id: 'slab_fresh_floor',
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
    seedLevel([], [slab])
    spatialGridManager.clear()
    spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)

    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 0.05,
      preferredSupportSlabId: null,
      constructionElevation: 0.05,
      constructionHeight: 2.5,
      constructionSourceNodeId: slab.id,
      flatConstructionBase: true,
    })

    expect(created).not.toBeNull()
    expect(created?.supportSlabId).toBeUndefined()
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
    const support = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      created!.start,
      created!.end,
      created!.curveOffset,
      created!.thickness,
      created!.supportSlabId,
    )
    expect(support.electedSlabId).toBe(slab.id)
    expect(support.elevation).toBeCloseTo(0.05)
  })

  test('a direct slab source does not pin a cross-slab wall away from the higher majority support', () => {
    const sourceSlab = SlabNode.parse({
      id: 'slab_source_low',
      parentId: LEVEL_ID,
      polygon: [
        [-0.1, -1],
        [0.1, -1],
        [0.1, 1],
        [-0.1, 1],
      ],
      elevation: 0.1,
      thickness: 0.05,
    })
    const majoritySlab = SlabNode.parse({
      id: 'slab_majority_high',
      parentId: LEVEL_ID,
      polygon: [
        [0.1, -1],
        [4.1, -1],
        [4.1, 1],
        [0.1, 1],
      ],
      elevation: 0.6,
      thickness: 0.1,
    })
    seedLevel([], [sourceSlab, majoritySlab])
    spatialGridManager.clear()
    spatialGridManager.handleNodeCreated(sourceSlab as AnyNode, LEVEL_ID)
    spatialGridManager.handleNodeCreated(majoritySlab as AnyNode, LEVEL_ID)

    const created = createWallOnCurrentLevel([0, 0], [4, 0], {
      supportCap: 0.6,
      preferredSupportSlabId: null,
      constructionElevation: 0.1,
      constructionHeight: 2.5,
      constructionSourceNodeId: sourceSlab.id,
      flatConstructionBase: true,
    })

    expect(created?.supportSlabId).toBe(majoritySlab.id)
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
  })

  test('a grazing direct slab source does not override the commit elevation cap', () => {
    const sourceSlab = SlabNode.parse({
      id: 'slab_source_high',
      parentId: LEVEL_ID,
      polygon: [
        [-0.1, -1],
        [0.1, -1],
        [0.1, 1],
        [-0.1, 1],
      ],
      elevation: 0.6,
      thickness: 0.1,
    })
    const cappedSlab = SlabNode.parse({
      id: 'slab_capped_low',
      parentId: LEVEL_ID,
      polygon: [
        [-0.1, -1],
        [4.1, -1],
        [4.1, 1],
        [-0.1, 1],
      ],
      elevation: 0.1,
      thickness: 0.05,
    })
    seedLevel([], [sourceSlab, cappedSlab])
    spatialGridManager.clear()
    spatialGridManager.handleNodeCreated(sourceSlab as AnyNode, LEVEL_ID)
    spatialGridManager.handleNodeCreated(cappedSlab as AnyNode, LEVEL_ID)

    const created = createWallOnCurrentLevel([0, 0], [4, 0], {
      supportCap: 0.1,
      preferredSupportSlabId: null,
      constructionElevation: 0.6,
      constructionHeight: 2.5,
      constructionSourceNodeId: sourceSlab.id,
      flatConstructionBase: true,
    })

    expect(created?.supportSlabId).toBe(cappedSlab.id)
    expect(created?.height).toBeUndefined()
    expect(created?.supportOffset).toBeUndefined()
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

  test('a mid-wall endpoint T-joins the host and leaves it whole', () => {
    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    const host = useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode
    expect([host.start, host.end]).toEqual([
      [0, 0],
      [4, 0],
    ])
    expect(levelWalls()).toHaveLength(2)
  })

  test('a wall drawn exactly over one built another way takes its place', () => {
    // The seed wall is plain; the wall tool draws the Build panel's outside type.
    const drawn = createWallOnCurrentLevel([0, 0], [4, 0])
    expect(drawn).not.toBeNull()
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    expect(levelWalls().map((wall) => wall.id)).toEqual([drawn!.id])
  })

  test('a wall drawn exactly over one built the same is refused', () => {
    expect(createWallOnCurrentLevel([0, 0], [4, 0])).not.toBeNull()
    expect(createWallOnCurrentLevel([0, 0], [4, 0])).toBeNull()
    expect(levelWalls()).toHaveLength(1)
  })

  test('a wall drawn on along part of another takes that stretch over', () => {
    const drawn = createWallOnCurrentLevel([2, 0], [6, 0])
    expect(drawn).not.toBeNull()
    const walls = levelWalls()
    // The seed wall keeps [0, 2]; nothing else runs along [2, 4].
    expect(walls).toHaveLength(2)
    const seed = walls.find((wall) => wall.id !== drawn!.id)!
    expect([seed.start, seed.end]).toEqual([
      [0, 0],
      [2, 0],
    ])
  })

  test('grid mode: endpoint resolved onto a wall body joins it whole', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('grid mode: endpoint beyond the connect radius is left alone (no residual snap)', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0.2])

    expect(created?.end).toEqual([2, 0.2])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test("a T into a wall leaves the host's door on it, where it was", () => {
    const door = DoorSchema.parse({
      position: [1, 1.05, 0],
      parentId: 'wall_a',
      wallId: 'wall_a',
    })
    seedLevel([{ ...makeWall([0, 0], [4, 0], 'wall_a'), children: [door.id] }], [door as AnyNode])

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    const kept = useScene.getState().nodes[door.id as AnyNodeId] as DoorSchema
    expect(kept.parentId).toBe('wall_a')
    expect(kept.position[0]).toBe(1)
    expect((useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode).children).toContain(
      door.id,
    )
  })

  test('a splitting commit lands as a single undo step', () => {
    const before = useScene.temporal.getState().pastStates.length

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created).not.toBeNull()
    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
  })

  test('a crossing splits only the drawn wall, in one undo step: the host stays whole', () => {
    const before = useScene.temporal.getState().pastStates.length

    const created = createWallOnCurrentLevel([2, -2], [2, 2])

    expect(created?.start).toEqual([2, 0])
    expect(created?.end).toEqual([2, 2])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(3)
    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
  })

  test.each([0.05, 0.18])(
    'a room divider preserves the footprint floor at %s and splits ceilings',
    (elevation) => {
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
        elevation,
        floorHeight: elevation,
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
      useScene.setState({
        nodes: migrateFloorPlates(
          migrateCeilingRoomLinks(migrateRoomZones(useScene.getState().nodes).nodes).nodes,
        ).nodes as Record<AnyNodeId, AnyNode>,
      })
      const stopDetection = initSpaceDetectionSync(useScene, useEditor)

      try {
        expect(createWallOnCurrentLevel([4, 0], [4, 6])).not.toBeNull()

        const nodes = Object.values(useScene.getState().nodes)
        const slabs = nodes.filter((node) => node.type === 'slab')
        const ceilings = nodes.filter((node) => node.type === 'ceiling')
        expect(slabs).toHaveLength(1)
        expect(slabs[0]).toMatchObject({ plateRole: 'base', floorHeight: elevation })
        expect(slabs[0]!.zoneIds).toHaveLength(2)
        expect(ceilings).toHaveLength(2)
        expect(
          slabs.every(
            (node) => node.autoFromWalls && node.elevation === elevation && node.thickness === 0.32,
          ),
        ).toBe(true)
        expect(ceilings.every((node) => node.autoFromWalls)).toBe(true)
      } finally {
        stopDetection()
      }
    },
  )

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

  test('an end aimed into an L corner block joins the corner and reads as one', () => {
    const south = { ...makeWall([0, 0], [4, 0], 'wall_south'), thickness: 0.2 }
    const west = { ...makeWall([0, 4], [0, 0], 'wall_west'), thickness: 0.2 }
    const result = snapWallDraftPointDetailed({
      point: [0.08, 0.08],
      walls: [south, west],
      start: [2, 3],
      magnetic: false,
      step: 0,
      captureWallBodies: true,
    })
    expect(result.point).toEqual([0, 0])
    expect(result.snap).toBe('endpoint')
    expect(result.targetWallIds).toEqual(['wall_south', 'wall_west'])
  })

  // The 3D tool snaps to the floor below as a reference but can't join it: an
  // end by a lower wall's face stays put, while its corner still snaps.
  test('walls left out of bodyWalls never capture an end, but still snap corners', () => {
    const lower = { ...makeWall([0, 0.4], [4, 0.4], 'wall_lower'), thickness: 0.2 }
    const snap = (point: WallPlanPoint, bodyWalls?: WallNode[]) =>
      snapWallDraftPointDetailed({
        point,
        walls: [lower],
        start: [1, 3],
        magnetic: false,
        step: 0,
        captureWallBodies: true,
        bodyWalls,
      })

    const captured = snap([1, 0.5])
    expect(captured.snap).toBe('wall')
    expect(captured.point[1]).toBeCloseTo(0.4, 12)

    const free = snap([1, 0.5], [])
    expect(free.point).toEqual([1, 0.5])
    expect(free.snap).toBeNull()

    const corner = snap([0.02, 0.42], [])
    expect(corner.point).toEqual([0, 0.4])
    expect(corner.snap).toBe('endpoint')
  })
})

// The site planner sets a house on its lot turned and offset. Its walls are
// drawn square to the house, in building-local metres. An interior wall drawn
// across it has to meet both exterior walls exactly and stay square to the
// house however the building is turned, in 3D and on the plan alike.
const HOUSE_BUILDING_ID = 'building_lot'
// A 30' × 24' house of 8" walls, 2' × 1' off the building origin, so no wall
// line or face lies on the 0.5 m lattice.
const HOUSE_MIN: WallPlanPoint = [0.6096, 0.3048]
const HOUSE_MAX: WallPlanPoint = [9.7536, 7.62]
const EXTERIOR_THICKNESS = 0.2032
// Where a builder aims an interior wall's end: just inside the exterior
// wall's interior face (1.18" off it).
const FACE_AIM = EXTERIOR_THICKNESS / 2 + 0.03

const BUILDING_POSES: Array<{
  label: string
  yaw: number
  position: [number, number, number]
}> = [
  { label: 'an unturned building at the origin', yaw: 0, position: [0, 0, 0] },
  {
    label: 'a building turned 17° and offset on its lot',
    yaw: (17 * Math.PI) / 180,
    position: [12.37, 0, -8.91],
  },
]

function seedHouse({ yaw, position }: { yaw: number; position: [number, number, number] }) {
  const [x0, z0] = HOUSE_MIN
  const [x1, z1] = HOUSE_MAX
  const walls = [
    makeWall([x0, z0], [x1, z0], 'wall_south'),
    makeWall([x1, z0], [x1, z1], 'wall_east'),
    makeWall([x1, z1], [x0, z1], 'wall_north'),
    makeWall([x0, z1], [x0, z0], 'wall_west'),
  ].map((wall) => ({ ...wall, thickness: EXTERIOR_THICKNESS }))
  const building = BuildingNode.parse({
    id: HOUSE_BUILDING_ID,
    position,
    rotation: [0, yaw, 0],
    children: [LEVEL_ID],
  })
  const level = LevelSchema.parse({ id: LEVEL_ID, parentId: building.id, level: 0, height: 2.5 })
  useScene.setState({
    nodes: Object.fromEntries([
      [building.id, building],
      [level.id, { ...level, children: walls.map((wall) => wall.id) }],
      ...walls.map((wall) => [wall.id, wall] as const),
    ]),
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
  useViewer.setState({
    selection: {
      buildingId: HOUSE_BUILDING_ID,
      levelId: LEVEL_ID,
      zoneId: null,
      selectedIds: [],
    },
  } as never)
}

for (const pose of BUILDING_POSES) {
  describe(`an interior wall drawn across a house in ${pose.label}`, () => {
    const [, z0] = HOUSE_MIN
    const [, z1] = HOUSE_MAX

    beforeEach(() => {
      useEditor.getState().setGridSnapStep(0.5)
      // A reshaping-endpoint scope resolves to the 'wall' snap context
      // without the node registry, as in `createWallOnCurrentLevel` above.
      useInteractionScope
        .getState()
        .begin({ kind: 'reshaping', nodeId: 'wall_south', reshape: 'endpoint', driver: 'tool' })
      seedHouse(pose)
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
    })

    afterEach(() => {
      useEditor.getState().setSnappingMode('wall', 'grid')
    })

    const setMode = (mode: SnappingMode) => useEditor.getState().setSnappingMode('wall', mode)

    // The cursor as a grid event hands it over: a hit on the world plane,
    // taken into the building's frame.
    const cursorAt = (local: WallPlanPoint): WallPlanPoint => {
      const cos = Math.cos(pose.yaw)
      const sin = Math.sin(pose.yaw)
      const worldX = pose.position[0] + local[0] * cos + local[1] * sin
      const worldZ = pose.position[2] - local[0] * sin + local[1] * cos
      return snapWorldXZToBuildingLocal(worldX, worldZ, pose.position, pose.yaw, 0).local
    }

    // The 3D wall tool's snap call.
    const snapIn3d = (point: WallPlanPoint, start?: WallPlanPoint, captureWallBodies = true) =>
      snapWallDraftPointDetailed({
        point,
        walls: levelWalls(),
        start,
        angleSnap: start !== undefined && isAngleSnapActive(),
        magnetic: isMagneticSnapActive(),
        captureWallBodies,
      })

    // The plan's click: the same cursor through the plan's grid callback.
    const snapOnPlan = (point: WallPlanPoint, start?: WallPlanPoint) =>
      snapWallDraftPoint({
        point,
        walls: levelWalls(),
        start,
        angleSnap: start !== undefined && isAngleSnapActive(),
        magnetic: isMagneticSnapActive(),
        gridSnap: (p) => snapBuildingLocalToWorldGrid(p, getSegmentGridStep()),
        captureWallBodies: true,
      })

    const partitionOpenEnds = (partition: WallNode) =>
      findOpenWallEnds(useScene.getState().nodes, LEVEL_ID).filter(
        (end) => end.wallId === partition.id,
      )

    test('grid: both ends land on the exterior walls, square to the house, with no gap', () => {
      setMode('grid')
      const startAim = cursorAt([4.2, z0 + FACE_AIM])
      const start = snapIn3d(startAim)
      expect(start.snap).toBe('wall')
      expect(start.targetWallIds).toEqual(['wall_south'])
      expect(start.point[0]).toBeCloseTo(4, 9)
      expect(start.point[1]).toBeCloseTo(z0, 9)

      // The cursor drifts a little sideways on its way across the house.
      const endAim = cursorAt([4.1, z1 - FACE_AIM])
      const end = snapIn3d(endAim, start.point)
      expect(end.snap).toBe('wall')
      expect(end.targetWallIds).toEqual(['wall_north'])
      expect(end.point[0]).toBeCloseTo(start.point[0], 9)
      expect(end.point[1]).toBeCloseTo(z1, 9)

      // The plan snaps the same cursor to the same points.
      expect(snapOnPlan(startAim)).toEqual(start.point)
      expect(snapOnPlan(endAim, start.point)).toEqual(end.point)

      const partition = createWallOnCurrentLevel(start.point, end.point)
      expect(partition).not.toBeNull()
      expect(partitionOpenEnds(partition!)).toEqual([])
    })

    test('ortho holds the wall square to the house and lands it on the far wall', () => {
      setMode('angles')
      const startAim = cursorAt([4.2, z0 + FACE_AIM])
      const start = snapIn3d(startAim)
      expect(start.point[0]).toBeCloseTo(4.2, 9)
      expect(start.point[1]).toBeCloseTo(z0, 9)

      // 4° off square: the 15° lock squares it to the house.
      const endAim = cursorAt([3.7, z1 - FACE_AIM])
      const end = snapIn3d(endAim, start.point)
      expect(end.snap).toBe('wall')
      expect(end.point[0]).toBeCloseTo(start.point[0], 9)
      expect(end.point[1]).toBeCloseTo(z1, 9)

      const onPlan = snapOnPlan(endAim, start.point)
      expect(onPlan[0]).toBeCloseTo(end.point[0], 9)
      expect(onPlan[1]).toBeCloseTo(end.point[1], 9)

      const partition = createWallOnCurrentLevel(start.point, end.point)
      expect(partition).not.toBeNull()
      expect(partitionOpenEnds(partition!)).toEqual([])
    })

    test('without the body snap the lattice stops the end short of the face: an open gap', () => {
      setMode('grid')
      const start = snapIn3d(cursorAt([4.2, z0 + FACE_AIM]))
      const end = snapIn3d(cursorAt([4.1, z1 - FACE_AIM]), start.point, false)
      // The lattice line under the cursor, 0.72" short of the north wall's face.
      expect(end.snap).toBeNull()
      expect(end.point[1]).toBeCloseTo(7.5, 9)

      const partition = createWallOnCurrentLevel(start.point, end.point)
      const [open] = partitionOpenEnds(partition!)
      expect(open?.reason).toBe('gap')
      expect(open?.gap).toBeCloseTo(z1 - EXTERIOR_THICKNESS / 2 - 7.5, 3)
    })
  })
}
