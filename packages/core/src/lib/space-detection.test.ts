import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findOpenWallEnds, SeparatorNode } from '../index'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  runWithSceneCommitNodeIds,
  type SceneCommit,
  subscribeSceneCommits,
} from '../store/history-control'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { migrateCeilingRoomLinks, migrateRoomZones } from '../utils/room-zone-migration'
import { area } from './polygon-boolean'
import { extractRooms } from './room-graph'
import {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  type SpaceTopologyReconcileEvent,
  wallClosesRoom,
} from './space-detection'
import { encodeTerrainField } from './terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from './terrain-field'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const square: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function squareWalls(height = 2.5) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

describe('space detection scene commit boundary', () => {
  test('includes room reconciliation in the closing wall commit and undo step', () => {
    const buildingId = 'building_space_commit' as AnyNodeId
    const levelId = 'level_space_commit' as AnyNodeId
    const walls = [
      WallNode.parse({
        id: 'wall_space_commit_bottom',
        parentId: levelId,
        start: [0, 0],
        end: [4, 0],
      }),
      WallNode.parse({
        id: 'wall_space_commit_right',
        parentId: levelId,
        start: [4, 0],
        end: [4, 3],
      }),
      WallNode.parse({
        id: 'wall_space_commit_top',
        parentId: levelId,
        start: [4, 3],
        end: [0, 3],
      }),
      WallNode.parse({
        id: 'wall_space_commit_left',
        parentId: levelId,
        start: [0, 3],
        end: [0, 0],
      }),
    ]
    const initialWalls = walls.slice(0, 3)
    const building = BuildingNode.parse({
      id: buildingId,
      children: [levelId],
    })
    const level = LevelNode.parse({
      id: levelId,
      parentId: buildingId,
      children: initialWalls.map((wall) => wall.id),
      level: 0,
      height: 2.5,
    })
    const initialNodes = Object.fromEntries(
      [building, level, ...initialWalls].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>

    // The real singleton is required to exercise zundo's commit snapshot boundary.
    const previousSceneState = useScene.getState()
    useScene.setState({
      nodes: initialNodes,
      rootNodeIds: [buildingId],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      installedPlugins: [],
      readOnly: false,
    } as never)
    clearSceneHistory()

    const commits: SceneCommit[] = []
    const stopDetection = initSpaceDetectionSync(useScene, createEditorStoreStub())
    const stopCommits = subscribeSceneCommits((commit) => commits.push(commit))

    try {
      const closingWall = walls[3]!
      useScene.getState().createNode(closingWall, levelId)

      const liveNodes = useScene.getState().nodes
      const autoSlab = Object.values(liveNodes).find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const autoCeiling = Object.values(liveNodes).find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(autoSlab).toBeDefined()
      expect(autoCeiling).toBeDefined()

      const localCommits = commits.filter((commit) => commit.origin === 'local')
      expect(localCommits).toHaveLength(1)
      const currentNodes = localCommits[0]!.current.nodes
      expect(Object.keys(currentNodes).sort()).toEqual(Object.keys(liveNodes).sort())

      const committedLevel = currentNodes[levelId] as LevelNode
      expect(committedLevel.children).toEqual(
        expect.arrayContaining([closingWall.id, autoSlab!.id, autoCeiling!.id]),
      )
      for (const wall of walls) {
        const committedWall = currentNodes[wall.id] as WallNode
        expect(committedWall.frontSide).toBe('interior')
        expect(committedWall.backSide).toBe('exterior')
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)

      useScene.temporal.getState().undo()

      const undoneNodes = useScene.getState().nodes
      expect(undoneNodes[closingWall.id]).toBeUndefined()
      expect(undoneNodes[autoSlab!.id]).toBeUndefined()
      expect(undoneNodes[autoCeiling!.id]).toBeUndefined()
    } finally {
      stopCommits()
      stopDetection()
      useScene.setState(previousSceneState, true)
      clearSceneHistory()
    }
  })
})

// Minimal store stand-ins for initSpaceDetectionSync: a zustand-shaped
// scene store (getState/subscribe/temporal) whose write methods mutate the
// nodes record and re-notify, and an editor store carrying `spaces`.
function createSceneStoreStub(initialNodes: Record<string, AnyNode>) {
  const listeners = new Set<(state: unknown) => void>()
  const state: Record<string, unknown> & { nodes: Record<string, AnyNode> } = {
    nodes: migrateCeilingRoomLinks(migrateRoomZones(initialNodes).nodes).nodes as Record<
      string,
      AnyNode
    >,
  }
  for (const node of Object.values(state.nodes)) {
    if (node.type !== 'slab' || node.boundary !== 'auto') continue
    state.nodes[node.id] = {
      ...node,
      zoneIds: Object.values(state.nodes)
        .filter(
          (zone) =>
            zone.type === 'zone' &&
            zone.parentId === node.parentId &&
            JSON.stringify(zone.polygon) === JSON.stringify(node.polygon),
        )
        .map((zone) => zone.id),
    }
  }
  const notify = () => {
    for (const listener of [...listeners]) listener(state)
  }
  state.updateNodes = (updates: Array<{ id: string; data: Record<string, unknown> }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { id, data } of updates) {
      const existing = next[id]
      if (existing) {
        next[id] = { ...existing, ...data } as AnyNode
        for (const key of Object.keys(data))
          if (data[key] === undefined) delete (next[id] as unknown as Record<string, unknown>)[key]
      }
    }
    state.nodes = next
    notify()
  }
  state.deleteNodes = (ids: string[]) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const id of ids) delete next[id]
    state.nodes = next
    notify()
  }
  state.createNodes = (entries: Array<{ node: AnyNode; parentId: string }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { node, parentId } of entries) {
      next[node.id] = { ...node, parentId } as AnyNode
      const parent = next[parentId] as (AnyNode & { children?: string[] }) | undefined
      if (parent) {
        next[parentId] = { ...parent, children: [...(parent.children ?? []), node.id] } as AnyNode
      }
    }
    state.nodes = next
    notify()
  }
  return {
    getState: () => state,
    subscribe: (listener: (state: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
    setNodes(next: Record<string, AnyNode>) {
      state.nodes = next
      notify()
    },
  }
}

function createEditorStoreStub() {
  const state = {
    spaces: {} as Record<string, unknown>,
    setSpaces(next: Record<string, unknown>) {
      state.spaces = next
    },
  }
  return { getState: () => state }
}

function canonicalRing(points: Array<[number, number]>) {
  if (points.length === 0) return points
  const candidates: Array<Array<[number, number]>> = []
  for (const ring of [points, [...points].reverse()]) {
    for (let index = 0; index < ring.length; index += 1) {
      candidates.push([...ring.slice(index), ...ring.slice(0, index)])
    }
  }
  return candidates.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]!
}

function topologyOutcome(nodes: Record<string, AnyNode>, spaces: Record<string, unknown>) {
  const comparableSpaces = Object.values(spaces)
    .map((space: any) => ({
      id: space.id,
      polygon: canonicalRing(space.polygon),
      wallIds: [...space.wallIds].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const comparableSurfaces = Object.values(nodes)
    .filter(
      (node): node is SlabNode | CeilingNode => node.type === 'slab' || node.type === 'ceiling',
    )
    .map((surface) => ({
      type: surface.type,
      autoFromWalls: surface.autoFromWalls,
      polygon: canonicalRing(surface.polygon),
      holes: surface.holes
        .map(canonicalRing)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      holeMetadata: surface.holeMetadata,
      visible: surface.visible,
      slots: surface.slots,
      material: surface.material,
      materialPreset: surface.materialPreset,
      ...(surface.type === 'slab'
        ? {
            elevation: surface.elevation,
            thickness: surface.thickness,
            recessed: surface.recessed,
            recessedRimElevation: surface.recessedRimElevation,
            fillToTerrain: surface.fillToTerrain,
          }
        : { height: surface.height, children: [...surface.children].sort() }),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return { spaces: comparableSpaces, surfaces: comparableSurfaces }
}

describe('live room topology reconciliation', () => {
  test('reconciles only the connected wall component while preserving other rooms', () => {
    const levelId = 'level_component_scope'
    const leftWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_component_left_${index}`,
        parentId: levelId,
      }),
    )
    const rightWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_component_right_${index}`,
        parentId: levelId,
        start: [wall.start[0] + 20, wall.start[1]],
        end: [wall.end[0] + 20, wall.end[1]],
      }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...leftWalls, ...rightWalls].map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...leftWalls, ...rightWalls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: Array<{ strategy: string; examinedWallIds: string[] }> = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([leftWalls[0]!.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [leftWalls[0]!.id]: { ...leftWalls[0], height: 2.7 } as WallNode,
        })
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
      expect(new Set(events[0]?.examinedWallIds)).toEqual(new Set(leftWalls.map((wall) => wall.id)))
    } finally {
      unsubscribe()
    }
  })

  test('preserves customized surfaces through repeated room split and merge cycles', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_custom_split_${index}`,
      parentId: 'level_custom_split',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_custom_split',
      parentId: 'level_custom_split',
      polygon: square,
      elevation: 0.05,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_custom_split',
      parentId: 'level_custom_split',
      polygon: square,
      height: 2.49,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: 'level_custom_split',
      level: 0,
      height: 2.5,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      const room = Object.values(sceneStore.getState().nodes).find((node) => node.type === 'zone')!
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        [room.id]: { ...room, floor: { elevation: 0.42 } } as AnyNode,
        [autoSlab.id]: {
          ...autoSlab,
          elevation: 0.42,
          thickness: 0.18,
          materialPreset: 'custom-floor',
          slots: { surface: 'library:oak' },
          visible: false,
        } as SlabNode,
        [autoCeiling.id]: {
          ...autoCeiling,
          height: 2.1,
          materialPreset: 'custom-ceiling',
          slots: { surface: 'library:blue' },
          visible: false,
        } as CeilingNode,
      })

      expect((sceneStore.getState().nodes[autoSlab.id] as SlabNode).elevation).toBe(0.42)
      expect((sceneStore.getState().nodes[autoCeiling.id] as CeilingNode).height).toBe(2.1)

      const current = sceneStore.getState().nodes
      const divider = WallNode.parse({
        id: 'wall_custom_split_divider',
        parentId: level.id,
        start: [2, 0],
        end: [2, 3],
        height: 2.5,
      })
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...current,
          [divider.id]: divider,
          [level.id]: {
            ...current[level.id],
            children: [...((current[level.id] as LevelNode).children ?? []), divider.id],
          } as LevelNode,
        })
      })

      const nodes = Object.values(sceneStore.getState().nodes)
      const slabs = nodes.filter(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const ceilings = nodes.filter(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(slabs).toHaveLength(3)
      expect(ceilings).toHaveLength(2)
      expect(
        slabs.every(
          (slab) =>
            slab.elevation === (slab.plateRole === 'base' ? 0.05 : 0.42) &&
            Math.abs(slab.thickness - (slab.plateRole === 'base' ? 0.18 : 0.37)) < 1e-6 &&
            slab.materialPreset === 'custom-floor' &&
            (slab.plateRole !== 'base' || slab.slots?.surface === 'library:oak') &&
            slab.visible === false,
        ),
      ).toBe(true)
      expect(
        ceilings.every(
          (ceiling) =>
            (ceiling.id === autoCeiling.id
              ? ceiling.height === 2.1
              : ceiling.height === undefined) &&
            ceiling.materialPreset === 'custom-ceiling' &&
            ceiling.slots?.surface === 'library:blue' &&
            ceiling.visible === false,
        ),
      ).toBe(true)

      const { [divider.id]: _divider, ...withoutDivider } = sceneStore.getState().nodes
      const splitLevel = withoutDivider[level.id] as LevelNode
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...withoutDivider,
          [level.id]: {
            ...splitLevel,
            children: splitLevel.children.filter((id) => id !== divider.id),
          } as LevelNode,
        })
      })

      const mergedNodes = Object.values(sceneStore.getState().nodes)
      const mergedSlabs = mergedNodes.filter(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const mergedCeilings = mergedNodes.filter(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
      expect(mergedSlabs).toHaveLength(2)
      expect(mergedCeilings).toHaveLength(1)
      expect(mergedSlabs.find((slab) => slab.plateRole === 'platform')).toMatchObject({
        elevation: 0.42,
        thickness: 0.37,
        materialPreset: 'custom-floor',
        visible: false,
      })
      expect(mergedSlabs.find((slab) => slab.plateRole === 'platform')!.slots).toBeUndefined()
      expect(mergedCeilings[0]).toMatchObject({
        materialPreset: 'custom-ceiling',
        slots: { surface: 'library:blue' },
        visible: false,
      })

      const mergedLevel = sceneStore.getState().nodes[level.id] as LevelNode
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [divider.id]: divider,
          [level.id]: {
            ...mergedLevel,
            children: [...mergedLevel.children, divider.id],
          } as LevelNode,
        })
      })

      const resplitNodes = Object.values(sceneStore.getState().nodes)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(
        resplitNodes.filter((node) => node.type === 'slab' && node.autoFromWalls),
      ).toHaveLength(3)
      expect(
        resplitNodes.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(2)
      expect(events.map((event) => event.strategy)).toEqual(['indexed', 'indexed', 'indexed'])
    } finally {
      unsubscribe()
    }
  })

  test('creates surfaces for a corridor enclosed between two surfaced rooms', () => {
    const levelId = 'level_corridor'
    const wallData = [
      { id: 'wall_a_bottom', start: [0, 0], end: [4, 0] },
      { id: 'wall_a_top', start: [4, 3], end: [0, 3] },
      { id: 'wall_a_left', start: [0, 3], end: [0, 0] },
      { id: 'wall_a_right', start: [4, 0], end: [4, 3] },
      { id: 'wall_b_bottom', start: [6, 0], end: [10, 0] },
      { id: 'wall_b_top', start: [10, 3], end: [6, 3] },
      { id: 'wall_b_left', start: [6, 3], end: [6, 0] },
      { id: 'wall_b_right', start: [10, 0], end: [10, 3] },
      { id: 'wall_corridor_bottom', start: [4, 0], end: [6, 0] },
    ] as const
    const walls = wallData.map((wall) => WallNode.parse({ ...wall, parentId: levelId }))
    const leftPolygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const rightPolygon: Array<[number, number]> = [
      [6, 0],
      [10, 0],
      [10, 3],
      [6, 3],
    ]
    const surfaces = [
      SlabNode.parse({
        id: 'slab_a',
        parentId: levelId,
        polygon: leftPolygon,
        autoFromWalls: true,
        boundary: 'auto',
      }),
      SlabNode.parse({
        id: 'slab_b',
        parentId: levelId,
        polygon: rightPolygon,
        autoFromWalls: true,
        boundary: 'auto',
      }),
      CeilingNode.parse({
        id: 'ceiling_a',
        parentId: levelId,
        polygon: leftPolygon,
        autoFromWalls: true,
      }),
      CeilingNode.parse({
        id: 'ceiling_b',
        parentId: levelId,
        polygon: rightPolygon,
        autoFromWalls: true,
      }),
    ]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...walls.map((wall) => wall.id), ...surfaces.map((surface) => surface.id)],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, ...surfaces].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)

    try {
      const closingWall = WallNode.parse({
        id: 'wall_corridor_top',
        parentId: levelId,
        start: [4, 3],
        end: [6, 3],
      })
      const closeCorridor = (store: ReturnType<typeof createSceneStoreStub>) => {
        store.setNodes({
          ...store.getState().nodes,
          [closingWall.id]: closingWall,
          [level.id]: { ...level, children: [...level.children, closingWall.id] } as LevelNode,
        })
      }
      runWithSceneCommitNodeIds([closingWall.id, level.id], () => {
        closeCorridor(indexedStore)
      })
      closeCorridor(fullStore)

      const nodes = Object.values(indexedStore.getState().nodes)
      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(3)
      expect(nodes.filter((node) => node.type === 'slab' && node.autoFromWalls)).toHaveLength(1)
      expect(nodes.filter((node) => node.type === 'ceiling' && node.autoFromWalls)).toHaveLength(3)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
      expect(events[0]?.examinedWallIds).toHaveLength(10)
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('reconciles every slab when one compound wall edit creates four rooms', () => {
    const levelId = 'level_compound_rooms'
    const initialWalls = [
      WallNode.parse({
        id: 'wall_compound_north',
        parentId: levelId,
        start: [-4, -3],
        end: [4, -3],
      }),
      WallNode.parse({ id: 'wall_compound_east', parentId: levelId, start: [4, -3], end: [4, 3] }),
      WallNode.parse({ id: 'wall_compound_south', parentId: levelId, start: [4, 3], end: [-4, 3] }),
      WallNode.parse({
        id: 'wall_compound_west',
        parentId: levelId,
        start: [-4, 3],
        end: [-4, -3],
      }),
    ]
    const autoSlab = SlabNode.parse({
      id: 'slab_compound',
      parentId: levelId,
      polygon: [
        [-4, -3],
        [4, -3],
        [4, 3],
        [-4, 3],
      ],
      elevation: 0.2,
      thickness: 0.12,
      slots: { surface: 'library:wood-floorplank1' },
      autoFromWalls: true,
      boundary: 'auto',
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_compound',
      parentId: levelId,
      polygon: autoSlab.polygon,
      height: 2.55,
      slots: { surface: 'library:concrete-polished' },
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      height: 2.8,
      children: [...initialWalls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const sceneStore = createSceneStoreStub(
      Object.fromEntries(
        [level, ...initialWalls, autoSlab, autoCeiling].map((node) => [node.id, node]),
      ) as Record<string, AnyNode>,
    )
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    const finalWalls = [
      initialWalls[1]!,
      initialWalls[3]!,
      WallNode.parse({
        id: 'wall_compound_north_left',
        parentId: levelId,
        start: [-4, -3],
        end: [0, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_north_mid',
        parentId: levelId,
        start: [0, -3],
        end: [1, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_north_right',
        parentId: levelId,
        start: [1, -3],
        end: [4, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_right',
        parentId: levelId,
        start: [4, 3],
        end: [1, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_mid',
        parentId: levelId,
        start: [1, 3],
        end: [0, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_left',
        parentId: levelId,
        start: [0, 3],
        end: [-4, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_diagonal_lower',
        parentId: levelId,
        start: [0, -3],
        end: [1, 0],
      }),
      WallNode.parse({
        id: 'wall_compound_diagonal_upper',
        parentId: levelId,
        start: [1, 0],
        end: [0, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_divider_lower',
        parentId: levelId,
        start: [1, -3],
        end: [1, 0],
      }),
      WallNode.parse({
        id: 'wall_compound_divider_upper',
        parentId: levelId,
        start: [1, 0],
        end: [1, 3],
      }),
    ]

    try {
      const nextLevel = {
        ...level,
        children: [...finalWalls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
      } as LevelNode
      const nextNodes = Object.fromEntries(
        [nextLevel, ...finalWalls, autoSlab, autoCeiling].map((node) => [node.id, node]),
      ) as Record<string, AnyNode>
      const changedIds = [
        level.id,
        initialWalls[0]!.id,
        initialWalls[2]!.id,
        ...finalWalls.map((wall) => wall.id),
      ]

      runWithSceneCommitNodeIds(changedIds, () => sceneStore.setNodes(nextNodes))

      const reconciled = Object.values(sceneStore.getState().nodes)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(4)
      expect(reconciled.filter((node) => node.type === 'slab' && node.autoFromWalls)).toHaveLength(
        1,
      )
      expect(
        reconciled.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(4)
    } finally {
      unsubscribe()
    }
  })

  test('matches the full detector when an existing wall extends to close a second room', () => {
    const levelId = 'level_indexed_extension'
    const walls = [
      WallNode.parse({
        id: 'wall_extension_bottom',
        parentId: levelId,
        start: [0, 0],
        end: [8, 0],
      }),
      WallNode.parse({ id: 'wall_extension_top', parentId: levelId, start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_extension_left', parentId: levelId, start: [0, 3], end: [0, 0] }),
      WallNode.parse({
        id: 'wall_extension_divider',
        parentId: levelId,
        start: [4, 0],
        end: [4, 3],
      }),
      WallNode.parse({ id: 'wall_extension_right', parentId: levelId, start: [8, 0], end: [8, 3] }),
    ]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      const extendedTop = { ...walls[1]!, start: [8, 3] as [number, number] }
      runWithSceneCommitNodeIds([extendedTop.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [extendedTop.id]: extendedTop,
        })
      })

      const liveWalls = Object.values(sceneStore.getState().nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
      )
      const oracle = detectSpacesForLevel(levelId, liveWalls).spaces
      const indexed = Object.values(editorStore.getState().spaces)
      expect(indexed.map((space: any) => space.id).sort()).toEqual(
        oracle.map((space) => space.id).sort(),
      )
      expect(indexed).toHaveLength(2)
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
    } finally {
      unsubscribe()
    }
  })

  test('matches full reconciliation for spaces and surfaces through split, move, and merge', () => {
    const levelId = 'level_indexed_sequence'
    const leftWalls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_sequence_left_${index}`, parentId: levelId }),
    )
    const rightWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_sequence_right_${index}`,
        parentId: levelId,
        start: [wall.start[0] + 20, wall.start[1]],
        end: [wall.end[0] + 20, wall.end[1]],
      }),
    )
    const leftSlab = SlabNode.parse({
      id: 'slab_sequence_left',
      parentId: levelId,
      polygon: square,
      holes: [
        [
          [1.5, 1],
          [2.5, 1],
          [2.5, 2],
          [1.5, 2],
        ],
      ],
      holeMetadata: [{ source: 'stair', stairId: 'stair_sequence' }],
      elevation: 0.42,
      thickness: 0.18,
      slots: { surface: 'library:wood-floorplank1' },
      autoFromWalls: true,
      boundary: 'auto',
    })
    const leftCeiling = CeilingNode.parse({
      id: 'ceiling_sequence_left',
      parentId: levelId,
      polygon: square,
      height: 2.1,
      slots: { surface: 'library:concrete-polished' },
      autoFromWalls: true,
    })
    const rightPolygon = square.map(([x, y]) => [x + 20, y] as [number, number])
    const rightSlab = SlabNode.parse({
      id: 'slab_sequence_right',
      parentId: levelId,
      polygon: rightPolygon,
      elevation: 0.1,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const rightCeiling = CeilingNode.parse({
      id: 'ceiling_sequence_right',
      parentId: levelId,
      polygon: rightPolygon,
      height: 2.4,
      autoFromWalls: true,
    })
    const surfaces = [leftSlab, leftCeiling, rightSlab, rightCeiling]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [
        ...[...leftWalls, ...rightWalls].map((wall) => wall.id),
        ...surfaces.map((surface) => surface.id),
      ],
    })
    const initialNodes = Object.fromEntries(
      [level, ...leftWalls, ...rightWalls, ...surfaces].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const assertEquivalent = () => {
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
    }
    const applyToBoth = (
      changedIds: AnyNodeId[],
      mutation: (store: ReturnType<typeof createSceneStoreStub>) => void,
    ) => {
      runWithSceneCommitNodeIds(changedIds, () => mutation(indexedStore))
      mutation(fullStore)
      assertEquivalent()
    }

    try {
      const divider = WallNode.parse({
        id: 'wall_sequence_divider',
        parentId: levelId,
        start: [2, 0],
        end: [2, 3],
      })
      applyToBoth([divider.id, level.id], (store) => {
        const nodes = store.getState().nodes
        store.setNodes({
          ...nodes,
          [divider.id]: divider,
          [level.id]: {
            ...nodes[level.id],
            children: [...(nodes[level.id] as LevelNode).children, divider.id],
          } as LevelNode,
        })
      })

      applyToBoth([divider.id], (store) => {
        store.setNodes({
          ...store.getState().nodes,
          [divider.id]: { ...divider, start: [3, 0], end: [3, 3] } as WallNode,
        })
      })

      applyToBoth([divider.id, level.id], (store) => {
        const nodes = store.getState().nodes
        const { [divider.id]: _divider, ...withoutDivider } = nodes
        store.setNodes({
          ...withoutDivider,
          [level.id]: {
            ...withoutDivider[level.id],
            children: (withoutDivider[level.id] as LevelNode).children.filter(
              (id) => id !== divider.id,
            ),
          } as LevelNode,
        })
      })

      const rightWallIds = new Set(rightWalls.map((wall) => wall.id))
      expect(events).toHaveLength(3)
      expect(
        events.every((event) => event.examinedWallIds.every((id) => !rightWallIds.has(id))),
      ).toBe(true)
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('matches full reconciliation when a curved room boundary changes', () => {
    const levelId = 'level_indexed_curve'
    const walls = [
      WallNode.parse({ id: 'wall_curve_bottom', parentId: levelId, start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_curve_right', parentId: levelId, start: [4, 0], end: [4, 3] }),
      WallNode.parse({
        id: 'wall_curve_top',
        parentId: levelId,
        start: [4, 3],
        end: [0, 3],
        curveOffset: 0.5,
      }),
      WallNode.parse({ id: 'wall_curve_left', parentId: levelId, start: [0, 3], end: [0, 0] }),
    ]
    const initialRoom = detectSpacesForLevel(levelId, walls).spaces[0]
    expect(initialRoom).toBeDefined()
    const slab = SlabNode.parse({
      id: 'slab_curve',
      parentId: levelId,
      polygon: initialRoom!.polygon,
      elevation: 0.3,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_curve',
      parentId: levelId,
      polygon: initialRoom!.polygon,
      height: 2.2,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...walls.map((wall) => wall.id), slab.id, ceiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, slab, ceiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor)
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const curvedWall = walls[2]!
    const updateCurve = (store: ReturnType<typeof createSceneStoreStub>) => {
      store.setNodes({
        ...store.getState().nodes,
        [curvedWall.id]: { ...curvedWall, curveOffset: 1 } as WallNode,
      })
    }

    try {
      runWithSceneCommitNodeIds([curvedWall.id], () => updateCurve(indexedStore))
      updateCurve(fullStore)

      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('clears indexed rooms when their entire level is cascade-deleted', () => {
    const levelId = 'level_indexed_delete'
    const walls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_indexed_delete_${index}`, parentId: levelId }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const changeWallHeight = (store: ReturnType<typeof createSceneStoreStub>) => {
      store.setNodes({
        ...store.getState().nodes,
        [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
      })
    }

    try {
      runWithSceneCommitNodeIds([walls[0]!.id], () => {
        changeWallHeight(indexedStore)
      })
      changeWallHeight(fullStore)
      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(1)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))

      const ids = Object.keys(indexedStore.getState().nodes) as AnyNodeId[]
      runWithSceneCommitNodeIds(ids, () => indexedStore.setNodes({}))
      fullStore.setNodes({})

      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(0)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
      expect(events.at(-1)).toMatchObject({
        strategy: 'indexed',
        affectedBeforeRoomCount: 1,
        affectedCurrentRoomCount: 0,
      })
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('falls back safely when a local wall edit targets a level absent from the index', () => {
    const levelId = 'level_indexed_fallback'
    const walls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_indexed_fallback_${index}`, parentId: levelId }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const sceneStore = createSceneStoreStub({})
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([level.id, ...walls.map((wall) => wall.id)], () => {
        sceneStore.setNodes(
          Object.fromEntries([level, ...walls].map((node) => [node.id, node])) as Record<
            string,
            AnyNode
          >,
        )
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        strategy: 'fallback',
        affectedBeforeRoomCount: 0,
        affectedCurrentRoomCount: 1,
      })
    } finally {
      unsubscribe()
    }
  })

  test('restoring a deleted generated surface keeps it through the next wall edit', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_restore_${index}`,
      parentId: 'level_restore',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_restore',
      parentId: 'level_restore',
      polygon: square,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: 'level_restore',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { [autoSlab.id]: _deleted, ...withoutSlab } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutSlab,
        [level.id]: { ...level, children: walls.map((wall) => wall.id) } as LevelNode,
      })
      sceneStore.setNodes(initialNodes)
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
      })

      expect(sceneStore.getState().nodes[autoSlab.id]).toMatchObject({
        type: 'slab',
        autoFromWalls: true,
      })
    } finally {
      unsubscribe()
    }
  })
})

describe('manual ceilings through the detection sync', () => {
  test('a flush deck clamps explicit manual ceiling height downward', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 0], end: [4, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 3], end: [0, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [0, 3], end: [0, 0], parentId: 'level_0' }),
    ]
    const manualCeiling = CeilingNode.parse({
      id: 'ceiling_main',
      parentId: 'level_0',
      polygon: square,
      height: 2.49,
      autoFromWalls: false,
    })
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: [...walls.map((wall) => wall.id), 'ceiling_main'],
        }),
        LevelNode.parse({ id: 'level_1', level: 1, height: 2.5, parentId: 'building_a' }),
        ...walls,
        manualCeiling,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      // Scenario gate 11's reactive half: the deck lands on the level
      // ABOVE, so only the covering-underside part of level_0's structure
      // snapshot changes — the sync must still re-run and clamp down.
      const deck = SlabNode.parse({
        id: 'slab_deck',
        parentId: 'level_1',
        polygon: square,
        elevation: 0,
        thickness: 0.3,
      })
      const current = sceneStore.getState().nodes
      const levelAbove = current.level_1 as AnyNode
      sceneStore.setNodes({
        ...current,
        slab_deck: deck,
        level_1: { ...levelAbove, children: ['slab_deck'] } as AnyNode,
      })

      const ceiling = sceneStore.getState().nodes.ceiling_main as CeilingNode
      expect(ceiling.height).toBeCloseTo(2.19)
    } finally {
      unsubscribe()
    }
  })
})

describe('raised auto-room surfaces', () => {
  test('follows boundary wall bases when the room has no floor elevation intent', () => {
    const wallData = [
      { id: 'wall_bottom', start: [0, 0], end: [4, 0] },
      { id: 'wall_right', start: [4, 0], end: [4, 3] },
      { id: 'wall_top', start: [4, 3], end: [0, 3] },
      { id: 'wall_left', start: [0, 3], end: [0, 0] },
    ] as const
    const walls = wallData.map((wall) =>
      WallNode.parse({
        ...wall,
        parentId: 'level_0',
        height: 2.5,
        supportOffset: 0.6,
      }),
    )
    const initialWalls = walls.slice(0, 3)
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: initialWalls.map((wall) => wall.id),
        }),
        ...initialWalls,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      const current = sceneStore.getState().nodes
      const level = current.level_0 as LevelNode
      const closingWall = walls[3]!
      runWithSceneCommitNodeIds([closingWall.id, level.id], () => {
        sceneStore.setNodes({
          ...current,
          [closingWall.id]: closingWall,
          level_0: {
            ...level,
            children: [...level.children, closingWall.id],
          } as LevelNode,
        })
      })

      const generated = Object.values(sceneStore.getState().nodes)
      const autoSlab = generated.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const autoCeiling = generated.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )

      expect(autoSlab?.elevation).toBeCloseTo(0.65)
      expect(autoSlab?.thickness).toBeCloseTo(0.05)
      expect(autoCeiling?.height).toBeUndefined()

      const raisedAgain = { ...sceneStore.getState().nodes }
      for (const wall of walls) {
        raisedAgain[wall.id] = { ...raisedAgain[wall.id], supportOffset: 0.8 } as AnyNode
      }
      runWithSceneCommitNodeIds(
        walls.map((wall) => wall.id),
        () => sceneStore.setNodes(raisedAgain),
      )

      const reconciled = Object.values(sceneStore.getState().nodes)
      const reconciledSlab = reconciled.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const reconciledCeiling = reconciled.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(reconciledSlab?.elevation).toBeCloseTo(0.85)
      expect(reconciledCeiling?.height).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })
})

describe('generated surface deletion memory', () => {
  test('does not backfill missing generated surfaces when a closed scene is loaded and reshaped', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_loaded_without_surfaces_${index}`,
      parentId: 'level_loaded_without_surfaces',
    })) as WallNode[]
    const level = LevelNode.parse({
      id: 'level_loaded_without_surfaces',
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    for (const node of Object.values(sceneStore.getState().nodes))
      if (node.type === 'zone') sceneStore.getState().nodes[node.id] = { ...node, hasFloor: false }
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        [walls[0]!.id]: { ...current[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...current[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...current[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      expect(
        Object.values(sceneStore.getState().nodes).filter(
          (node) => node.type === 'slab' && node.autoFromWalls && !!node.zoneIds?.length,
        ),
      ).toHaveLength(0)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  test('a deleted generated slab stays absent while the ceiling follows a later room reshape', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_delete_memory_${index}`,
      parentId: 'level_delete_memory',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_delete_memory',
      parentId: 'level_delete_memory',
      polygon: square,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_delete_memory',
      parentId: 'level_delete_memory',
      polygon: square,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: 'level_delete_memory',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { slab_delete_memory: _deleted, ...withoutSlab } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutSlab,
        [level.id]: {
          ...withoutSlab[level.id],
          children: level.children.filter((id) => id !== autoSlab.id),
        } as LevelNode,
      })

      const afterDelete = sceneStore.getState().nodes
      expect(
        Object.values(afterDelete).filter(
          (node) => node.type === 'slab' && node.autoFromWalls && !!node.zoneIds?.length,
        ),
      ).toHaveLength(0)

      sceneStore.setNodes({
        ...afterDelete,
        [walls[0]!.id]: { ...afterDelete[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...afterDelete[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...afterDelete[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      const afterReshape = Object.values(sceneStore.getState().nodes)
      expect(
        afterReshape.filter(
          (node) => node.type === 'slab' && node.autoFromWalls && !!node.zoneIds?.length,
        ),
      ).toHaveLength(0)
      const ceiling = afterReshape.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      // Explicit-height walls may not reach the ceiling, so it spans them to the reference line.
      expect(ceiling?.polygon).toContainEqual([5, 0])
      expect(ceiling?.polygon).toContainEqual([5, 3])
    } finally {
      unsubscribe()
    }
  })

  test('deleting a generated ceiling records a persistent zone opt-out', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_ceiling_memory_${index}`,
      parentId: 'level_ceiling_memory',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_ceiling_memory',
      parentId: 'level_ceiling_memory',
      polygon: square,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_ceiling_memory',
      parentId: 'level_ceiling_memory',
      polygon: square,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const level = LevelNode.parse({
      id: 'level_ceiling_memory',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { ceiling_ceiling_memory: _deleted, ...withoutCeiling } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutCeiling,
        [level.id]: {
          ...withoutCeiling[level.id],
          children: level.children.filter((id) => id !== autoCeiling.id),
        } as LevelNode,
      })

      const afterDelete = sceneStore.getState().nodes
      expect(
        Object.values(afterDelete).filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(0)

      sceneStore.setNodes({
        ...afterDelete,
        [walls[0]!.id]: { ...afterDelete[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...afterDelete[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...afterDelete[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      const afterReshape = Object.values(sceneStore.getState().nodes)
      expect(
        afterReshape.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(0)
      expect(afterReshape.find((node) => node.type === 'zone')).toMatchObject({ hasCeiling: false })
      const slab = afterReshape.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      expect(Math.max(...slab!.polygon.map(([x]) => x))).toBeCloseTo(5.05)
      expect(slab?.polygon).toContainEqual([5.05, 3.05])
    } finally {
      unsubscribe()
    }
  })
})

describe('space lifecycle reconciliation', () => {
  test('removes stale spaces and deleted wall ids when a room is opened', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_space_lifecycle_${index}`,
      parentId: 'level_space_lifecycle',
    })) as WallNode[]
    const level = LevelNode.parse({
      id: 'level_space_lifecycle',
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([walls[0]!.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
        })
      })
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)

      const current = sceneStore.getState().nodes
      const deletedWall = walls[3]!
      const { [deletedWall.id]: _deleted, ...withoutWall } = current
      runWithSceneCommitNodeIds([deletedWall.id, level.id], () => {
        sceneStore.setNodes({
          ...withoutWall,
          [level.id]: {
            ...withoutWall[level.id],
            children: level.children.filter((id) => id !== deletedWall.id),
          } as LevelNode,
        })
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(0)
      expect(
        Object.values(editorStore.getState().spaces).some((space) =>
          (space as { wallIds?: string[] }).wallIds?.includes(deletedWall.id),
        ),
      ).toBe(false)
      expect(events.map((event) => event.strategy)).toEqual(['indexed', 'indexed'])
    } finally {
      unsubscribe()
    }
  })
})

// A 1 m ramp across the room's x span: ground 0 at x ≤ 0 rising to 1 at
// x ≥ 4, flat in z. Written column by column so the field is exactly
// monotonic across the walls, rather than depending on brush falloff.
function rampedSite(): AnyNode {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  let field = base
  for (let col = 0; col <= 16; col += 1) {
    const x = -8 + col
    const height = Math.max(0, Math.min(1, x / 4))
    const patch = flattenPatch(field, { minX: x, minZ: -8, maxX: x + 0.001, maxZ: 8 }, height)
    if (patch) field = applyHeightPatch(field, patch)
  }
  return {
    id: 'site_test',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['building_a'],
    terrain: encodeTerrainField(field),
  } as unknown as AnyNode
}

/** The 4×3 `square` room on `level_0` of a building on `site_test`. */
function slopedRoomScene(site: AnyNode | null) {
  const wallData = [
    { id: 'wall_bottom', start: [0, 0], end: [4, 0] },
    { id: 'wall_right', start: [4, 0], end: [4, 3] },
    { id: 'wall_top', start: [4, 3], end: [0, 3] },
    { id: 'wall_left', start: [0, 3], end: [0, 0] },
  ] as const
  const walls = wallData.map((wall) =>
    WallNode.parse({ ...wall, parentId: 'level_0', height: 2.5 }),
  )
  const initialWalls = walls.slice(0, 3)
  const nodes = Object.fromEntries(
    [
      ...(site ? [site] : []),
      BuildingNode.parse({ id: 'building_a', parentId: site?.id ?? null, children: ['level_0'] }),
      LevelNode.parse({
        id: 'level_0',
        level: 0,
        height: 2.5,
        parentId: 'building_a',
        children: initialWalls.map((wall) => wall.id),
      }),
      ...initialWalls,
    ].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { nodes, closingWall: walls[3]! }
}

function closeRoom(sceneStore: ReturnType<typeof createSceneStoreStub>, closingWall: AnyNode) {
  const current = sceneStore.getState().nodes
  const level = current.level_0 as LevelNode
  sceneStore.setNodes({
    ...current,
    [closingWall.id]: closingWall,
    level_0: { ...level, children: [...level.children, closingWall.id] } as LevelNode,
  })
}

function autoSurfacesOf(sceneStore: ReturnType<typeof createSceneStoreStub>) {
  const all = Object.values(sceneStore.getState().nodes)
  return {
    slab: all.find((node): node is SlabNode => node.type === 'slab' && node.autoFromWalls),
    ceiling: all.find((node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls),
  }
}

describe('auto-room surfaces over terrain', () => {
  test('a room on a slope follows the highest boundary wall base', () => {
    // Walls on bare terrain: no `supportSlabId`, no `supportOffset` — exactly
    // what a stamped room preset or a 3D draw over untouched ground produces.
    // Bases run 0 → 1 across the ramp, so a floor at the lowest base would
    // leave daylight under the walls at the high end.
    const { nodes, closingWall } = slopedRoomScene(rampedSite())
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      const { slab, ceiling } = autoSurfacesOf(sceneStore)

      // Highest wall base = the ramp at x = 4 (the right wall's start), +the
      // 5 cm auto-slab lift.
      expect(slab?.elevation).toBeCloseTo(1.05)
      // Lowest wall top = the LOWEST base + 2.5 (explicit-height walls ride
      // their own base), −the 1 cm clamp margin. Bottom/left walls start at
      // x = 0, i.e. ground 0.
      expect(ceiling?.height).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })

  test('flat ground is unchanged — the same room with no terrain', () => {
    const { nodes, closingWall } = slopedRoomScene(null)
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      const { slab, ceiling } = autoSurfacesOf(sceneStore)
      expect(slab?.elevation).toBeCloseTo(0.05)
      expect(ceiling?.height).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })

  test('sculpting under an existing room re-derives an unauthored floor', () => {
    // The trigger half of the bug: a sculpt writes only `site.terrain`, so
    // without a terrain term in the structure signature every level hashes
    // identically and the sync early-exits.
    const { nodes, closingWall } = slopedRoomScene(rampedSite())
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      expect(autoSurfacesOf(sceneStore).slab?.elevation).toBeCloseTo(1.05)

      // Level the whole lot to 2 m — the ground under every wall moves, and
      // nothing else in the scene changes.
      const flat = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
      const levelled = applyHeightPatch(
        flat,
        flattenPatch(flat, { minX: -8, minZ: -8, maxX: 8, maxZ: 8 }, 2) as never,
      )
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        site_test: {
          ...(current.site_test as Record<string, unknown>),
          terrain: encodeTerrainField(levelled),
        } as AnyNode,
      })

      const { slab, ceiling } = autoSurfacesOf(sceneStore)
      expect(slab?.elevation).toBeCloseTo(2.05)
      expect(ceiling?.height).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })
})

describe('detectSpacesForLevel', () => {
  const areaOf = (polygon: Array<{ x: number; y: number }>) => {
    let area = 0
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      area += a.x * b.y - b.x * a.y
    }
    return Math.abs(area / 2)
  }

  test('detects an isolated four-wall room', () => {
    const walls = squareWalls()
    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(new Set(spaces[0]?.wallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
    expect(
      spaces[0]?.boundaryFaces.map((boundary) => `${boundary.wallId}:${boundary.face}`).sort(),
    ).toEqual(walls.map((wall) => `${wall.id}:front`).sort())
  })

  test('excludes dangling wall branches from a room boundary', () => {
    const roomWalls = squareWalls()
    const branch = WallNode.parse({ start: [0, 0], end: [1, 1] })

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', [...roomWalls, branch])

    expect(roomPolygons).toHaveLength(1)
    expect(roomPolygons[0]).toHaveLength(4)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(12)
    expect(spaces[0]?.wallIds.sort()).toEqual(roomWalls.map((wall) => wall.id).sort())
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
  })

  test('detects a room closed against the middle of an existing wall (T-junction)', () => {
    // Big 6×5 room; a smaller room hangs below, its two verticals landing on the
    // interior of the big room's bottom wall (x=1 and x=3, not endpoints). Before
    // planarization those touch points were dangling nodes and the small room
    // was never detected.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
      WallNode.parse({ start: [1, 0], end: [1, -2] }),
      WallNode.parse({ start: [1, -2], end: [3, -2] }),
      WallNode.parse({ start: [3, -2], end: [3, 0] }),
    ]

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    const areas = roomPolygons.map((poly) => areaOf(poly)).sort((a, b) => a - b)
    const smallRoom = spaces.find((space) => areaOf(space.polygon.map(([x, y]) => ({ x, y }))) < 5)

    expect(roomPolygons).toHaveLength(2)
    expect(areas[0]).toBeCloseTo(4, 1) // small room: 2×2
    expect(areas[1]).toBeCloseTo(30, 1) // big room: 6×5
    expect(new Set(smallRoom?.wallIds)).toEqual(
      new Set([walls[0]!.id, walls[4]!.id, walls[5]!.id, walls[6]!.id]),
    )

    const longWallId = walls[0]!.id
    const longWallBoundaries = spaces.flatMap((space) =>
      space.boundaryFaces.filter((boundary) => boundary.wallId === longWallId),
    )
    expect(longWallBoundaries).toHaveLength(4)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'back')).toHaveLength(1)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'front')).toHaveLength(3)
    expect(longWallBoundaries.map((boundary) => boundary.points)).toContainEqual([
      [1, 0],
      [3, 0],
    ])
  })

  test('detects a newly enclosed corridor between two existing rooms', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
      WallNode.parse({ start: [2, 0], end: [2, 3] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [6, 0], end: [6, 3] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-1', walls)

    expect(roomPolygons).toHaveLength(3)
    expect(roomPolygons.map(areaOf).sort((a, b) => a - b)).toEqual([6, 6, 6])
  })

  test('detects a new enclosure outside an extended existing room wall', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [8, 0] }),
      WallNode.parse({ start: [8, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [8, 0], end: [8, 3] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-1', walls)

    expect(roomPolygons).toHaveLength(2)
    expect(roomPolygons.map(areaOf).sort((a, b) => a - b)).toEqual([12, 12])
  })

  // Prod "Wawa House": walls drawn a few centimetres short of their corner read as
  // joined (their bodies overlap) but left Living Room and Master Bedroom undetected.
  test('joins a corner whose wall ends stop a few centimetres apart', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4.0091, 0.0012], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0.0384] }),
    ]
    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(12, 1)
    expect(new Set(spaces[0]?.wallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
  })

  test('joins a wall end that lands on another wall close to its end', () => {
    // The right wall stops 1 mm off the top wall, 3 cm from the top wall's end.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 2.999] }),
      WallNode.parse({ start: [4.03, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const { roomPolygons } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(12, 1)
  })

  test('keeps a short jog wall and distinct junctions beyond the tolerance', () => {
    // A 5 cm jog joins two walls; both of its ends are real junctions.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [2, 0] }),
      WallNode.parse({ start: [2, 0], end: [2, 0.05] }),
      WallNode.parse({ start: [2, 0.05], end: [4, 0.05] }),
      WallNode.parse({ start: [4, 0.05], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const { spaces } = detectSpacesForLevel('level-1', walls)
    expect(spaces).toHaveLength(1)
    expect(new Set(spaces[0]?.wallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
    // A 10 cm gap stays open.
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0.1], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    expect(detectSpacesForLevel('level-1', open).roomPolygons).toHaveLength(0)
  })
})

describe('near-miss joints follow the drawn wall bodies', () => {
  const rectangleWith = (gapWall: WallNode) => [
    WallNode.parse({ start: [0, 0], end: [4, 0], thickness: gapWall.thickness }),
    WallNode.parse({ start: [4, 0], end: [4, 3], thickness: gapWall.thickness }),
    WallNode.parse({ start: [4, 3], end: [0, 3], thickness: gapWall.thickness }),
    gapWall,
  ]
  test.each([
    ['a 5 cm gap between 1 cm walls', 0.01, 0.05],
    ['a 5 cm gap between 10 cm walls', 0.1, 0.05],
    ['an 80 cm doorway', 0.1, 0.8],
  ])('%s along one side stays open', (_label, thickness, gap) => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [2, 0], thickness }),
      WallNode.parse({ start: [2 + gap, 0], end: [4, 0], thickness }),
      WallNode.parse({ start: [4, 0], end: [4, 3], thickness }),
      WallNode.parse({ start: [4, 3], end: [0, 3], thickness }),
      WallNode.parse({ start: [0, 3], end: [0, 0], thickness }),
    ]
    expect(detectSpacesForLevel('level-1', walls).roomPolygons).toHaveLength(0)
    // A 5 mm hairline between 10 cm walls reads as one wall.
    if (thickness === 0.1 && gap < 0.1) {
      const hairline = walls.map((wall, i) =>
        i === 1 ? { ...wall, start: [2.005, 0] as [number, number] } : wall,
      )
      expect(detectSpacesForLevel('level-1', hairline).roomPolygons).toHaveLength(1)
    }
  })
  test('a corner a few centimetres short closes when the bodies overlap', () => {
    const walls = rectangleWith(WallNode.parse({ start: [0, 3], end: [0, 0.04], thickness: 0.1 }))
    expect(detectSpacesForLevel('level-1', walls).roomPolygons).toHaveLength(1)
    const thin = rectangleWith(WallNode.parse({ start: [0, 3], end: [0, 0.04], thickness: 0.01 }))
    expect(detectSpacesForLevel('level-1', thin).roomPolygons).toHaveLength(0)
  })
  test('stays near-linear on 2,000 isolated walls', () => {
    // Timed in a fresh process (`__bench__/near-linear-walls.ts`): inside the suite, the heap the
    // other test files leave behind made the large run pay for collections the small one didn't
    // (CI read 41–57 while the code runs at ~26).
    const run = Bun.spawnSync(
      [process.execPath, resolve(import.meta.dir, '__bench__/near-linear-walls.ts')],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    expect(run.exitCode).toBe(0)
    const { ratio, rooms } = JSON.parse(run.stdout.toString()) as { ratio: number; rooms: number }
    expect(rooms).toBe(0)
    // Eight times the walls: splitting every wall at every vertex already grows ~25× on a laptop
    // and 42–57× on a shared CI runner, where 2,000 walls fall out of cache; the unbounded
    // neighbour scan (7.8 s at 2,000 walls) grows ~70× even on a laptop.
    expect(ratio).toBeLessThan(60)
  }, 30_000)
})

describe('open wall ends', () => {
  const nodes = (...walls: WallNode[]) => Object.fromEntries(walls.map((wall) => [wall.id, wall]))
  const wall = (id: string, start: [number, number], end: [number, number]) =>
    WallNode.parse({ id, parentId: 'level_open', start, end })

  test('reports the reference endpoints and body gap of a visibly open collinear seam', () => {
    const a = wall('wall_a', [0, 0], [2, 0])
    const b = wall('wall_b', [2.05, 0], [4, 0])
    const end = findOpenWallEnds(nodes(a, b), 'level_open').find(
      (end) => end.wallId === a.id && end.end === 'end',
    )!
    expect(end).toMatchObject({
      point: [2, 0],
      reason: 'gap',
      candidate: { wallId: b.id, kind: 'endpoint', point: [2.05, 0] },
    })
    expect(end.gap).toBeCloseTo(0.05, 6)
    expect(findOpenWallEnds(nodes(a, b), 'level_other')).toEqual([])
  })

  test('reports isolated ends without a candidate beyond 35 cm', () => {
    const a = wall('wall_a', [0, 0], [2, 0])
    const b = wall('wall_b', [3, 0], [4, 0])
    expect(findOpenWallEnds(nodes(a, b), 'level_open')).toEqual(
      expect.arrayContaining([{ wallId: a.id, end: 'end', point: [2, 0], reason: 'isolated' }]),
    )
  })

  test('distinguishes parallel bodies from endpoint gaps', () => {
    const a = wall('wall_a', [0, 0], [4, 0])
    const b = wall('wall_b', [1, 0.2], [3, 0.2])
    expect(findOpenWallEnds(nodes(a, b), 'level_open')).toContainEqual({
      wallId: b.id,
      end: 'start',
      point: [1, 0.2],
      reason: 'parallel',
      candidate: { wallId: a.id, point: [1, 0], kind: 'body' },
    })
  })

  test('reports rejected joins that would double an existing wall span', () => {
    const a = wall('wall_a', [0, 0], [2, 0])
    const b = wall('wall_b', [0, 0.02], [2, 0.02])
    expect(
      findOpenWallEnds(nodes(a, b), 'level_open').filter((end) => end.reason === 'rejected'),
    ).toHaveLength(2)
  })

  test('uses the exact crossing as the repair target for an overshot end', () => {
    const a = wall('wall_a', [-2, 0], [4, 0])
    const b = wall('wall_b', [2, 3], [2, -0.2])
    expect(findOpenWallEnds(nodes(a, b), 'level_open')).toContainEqual({
      wallId: b.id,
      end: 'end',
      point: [2, -0.2],
      reason: 'crosses',
      candidate: { wallId: a.id, point: [2, 0], kind: 'body' },
    })
  })

  test('excludes separator ends and wall ends connected through a preserved deletion edge', () => {
    const a = wall('wall_a', [0, 0], [2, 0])
    const separator = SeparatorNode.parse({
      id: 'separator_open',
      parentId: 'level_open',
      start: [2, 0],
      end: [4, 0],
    })
    expect(findOpenWallEnds({ ...nodes(a), [separator.id]: separator }, 'level_open')).toEqual([
      { wallId: a.id, end: 'start', point: [0, 0], reason: 'isolated' },
    ])
  })

  test('a perpendicular 20 cm overshoot closes its room without closing a central crossing', () => {
    const walls = [
      wall('wall_bottom', [-1, 0], [4, 0]),
      wall('wall_right', [4, 0], [4, 3]),
      wall('wall_top', [4, 3], [0, 3]),
      wall('wall_left', [0, 3], [0, -0.2]),
    ]
    expect(extractRooms(walls)).toHaveLength(1)
    expect(
      Math.abs(area([{ outer: extractRooms(walls)[0]!.referencePolygon, holes: [] }])),
    ).toBeCloseTo(12, 6)
    expect(
      extractRooms(
        walls.map((wall) =>
          wall.id === 'wall_left' ? ({ ...wall, end: [0, -1] } as WallNode) : wall,
        ),
      ),
    ).toHaveLength(0)
  })

  test('a wall passing through two walls near their joined corners closes no strip room', () => {
    const walls = [
      wall('wall_bottom', [0, 0], [4, 0]),
      wall('wall_right', [4, 0], [4, 3]),
      wall('wall_top', [4, 3], [0, 3]),
      wall('wall_left', [0, 3], [0, 0]),
      wall('wall_through', [-1, 0.3], [4.5, 0.3]),
    ]
    expect(extractRooms(walls)).toHaveLength(1)
  })

  test('an overshoot hidden inside the crossed body is one clean T, not an open end', () => {
    const thick = (id: string, start: [number, number], end: [number, number]) =>
      WallNode.parse({ id, parentId: 'level_open', start, end, thickness: 0.3 })
    const walls = [
      thick('wall_bottom', [0, 0], [4, 0]),
      thick('wall_right', [4, 0], [4, 3]),
      thick('wall_top', [4, 3], [0, 3]),
      thick('wall_left', [0, 3], [0, 0]),
      thick('wall_divider', [2, -0.1], [2.02, 3]),
    ]
    const rooms = extractRooms(walls)
    expect(rooms).toHaveLength(2)
    for (const span of rooms.flatMap((room) => room.spans)) {
      const wall = walls.find((wall) => wall.id === span.boundaryId)!
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      expect((span.t1 - span.t0) * length).toBeGreaterThan(0.01)
    }
    expect(findOpenWallEnds(nodes(...walls), 'level_open')).toEqual([])
  })
})

describe('wall ends that stand inside another wall body', () => {
  // A 4 × 3 room whose right wall stops inside a 30 cm wall, 10 cm off its line.
  const room = (thickness: number, end: [number, number] = [4, 2.9]) => [
    WallNode.parse({ id: 'wall_a', start: [0, 0], end: [4, 0], thickness: 0.1 }),
    WallNode.parse({ id: 'wall_b', start: [4, 0], end, thickness: 0.1 }),
    WallNode.parse({ id: 'wall_c', start: [5, 3], end: [-1, 3], thickness }),
    WallNode.parse({ id: 'wall_d', start: [0, 3], end: [0, 0], thickness: 0.1 }),
  ]

  test('prod "Structure test 06": the right half closes where its wall stops inside a thick wall', () => {
    const walls = (
      JSON.parse(
        readFileSync(
          new URL('./__fixtures__/structure-test-06-walls.json', import.meta.url),
          'utf8',
        ),
      ) as Partial<WallNode>[]
    ).map((wall) => WallNode.parse({ ...wall, parentId: 'level-1' }))
    const areas = detectSpacesForLevel('level-1', walls)
      .spaces.map((space) => area([{ outer: space.polygon, holes: space.holes }]))
      .sort((a, b) => b - a)
    expect(areas).toHaveLength(2)
    expect(areas[0]).toBeGreaterThan(50)
  })

  test('joins at the foot of the thick wall’s line; a thin wall there leaves the gap open', () => {
    const { spaces } = detectSpacesForLevel('level-1', room(0.3))
    expect(spaces).toHaveLength(1)
    expect(area([{ outer: spaces[0]!.polygon, holes: [] }])).toBeCloseTo(12, 1)
    // A 10 cm wall's body ends 5 cm short of the end: a visible gap.
    expect(detectSpacesForLevel('level-1', room(0.1)).spaces).toHaveLength(0)
    // Metre-thick "walls" are blocks, not joints.
    expect(detectSpacesForLevel('level-1', room(1.2, [4, 2.6])).spaces).toHaveLength(0)
  })

  test('a thick corner a few centimetres further than the junction tolerance closes', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.3 }),
      WallNode.parse({ start: [4, 0], end: [4, 3], thickness: 0.3 }),
      WallNode.parse({ start: [4, 3], end: [0.092, 3], thickness: 0.3 }),
      WallNode.parse({ start: [0, 3], end: [0, 0], thickness: 0.3 }),
    ]
    expect(detectSpacesForLevel('level-1', walls).spaces).toHaveLength(1)
  })

  test('a stub inside a body, an overshoot past a corner and nearly aligned ends change nothing', () => {
    const square = [
      WallNode.parse({ id: 'wall_1', start: [0, 0], end: [4, 0], thickness: 0.3 }),
      WallNode.parse({ id: 'wall_2', start: [4, 0], end: [4, 3], thickness: 0.3 }),
      WallNode.parse({ id: 'wall_3', start: [4, 3], end: [0, 3], thickness: 0.3 }),
      WallNode.parse({ id: 'wall_4', start: [0, 3], end: [0, 0], thickness: 0.3 }),
    ]
    const areaOf = (walls: WallNode[]) =>
      detectSpacesForLevel('level-1', walls).spaces.map((space) =>
        area([{ outer: space.polygon, holes: space.holes }]),
      )
    expect(areaOf(square)).toEqual([12])
    // A corner filler drawn entirely inside the bodies.
    const stub = WallNode.parse({ id: 'wall_5', start: [4, 0], end: [4.08, 0.12], thickness: 0.3 })
    expect(areaOf([...square, stub])).toEqual([12])
    // A thin wall running 10 cm past the corner it already crosses.
    const overshoot = [
      WallNode.parse({ id: 'wall_1', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_2', start: [4, -0.01], end: [4, 3] }),
      WallNode.parse({ id: 'wall_3', start: [4.1, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_4', start: [0, 3], end: [0, 0] }),
      WallNode.parse({ id: 'wall_6', start: [4, 3], end: [4, 5] }),
    ]
    expect(areaOf(overshoot).map((value) => Math.round(value))).toEqual([12])
  })
})

describe('joints never cost a room the plain rules found', () => {
  const load = (file: string) =>
    (
      JSON.parse(
        readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8'),
      ) as Partial<WallNode>[]
    ).map((wall) => WallNode.parse({ ...wall, parentId: 'level-1' }))
  const areas = (walls: WallNode[]) =>
    extractRooms(walls)
      .map((room) => area([{ outer: room.referencePolygon, holes: room.holes }]))
      .sort((a, b) => b - a)

  test('a room walled by a span drawn twice survives a joint elsewhere on it', () => {
    // Wall vcums lies exactly on part of lv02j; joining 9q8u1 at the room's corner used to
    // make the face walk cross the doubled span and lose the 618 m² room.
    expect(areas(load('stacked-walls-doubled-span.json'))[0]).toBeCloseTo(618.52, 1)
  })

  test('a joint that would merge two rooms keeps them apart', () => {
    const rooms = areas(load('joint-merge-rooms.json'))
    expect(rooms).toHaveLength(20)
    expect(rooms).toContainEqual(expect.closeTo(15.38, 1))
    expect(rooms).toContainEqual(expect.closeTo(4.78, 1))
  })

  test('open-end diagnostics retain an end when the final graph rejects its room-merging join', () => {
    const walls = load('joint-merge-rooms.json')
    const end = findOpenWallEnds(
      Object.fromEntries(walls.map((wall) => [wall.id, wall])),
      'level-1',
    ).find((end) => end.wallId === 'wall_yyljh535a2wao2tn' && end.end === 'end')
    expect(end).toMatchObject({
      point: [6.8, 3.05],
      reason: 'rejected',
      candidate: { wallId: 'wall_h2iwndxe7xi48frz' },
    })
  })
})

describe('wallClosesRoom', () => {
  test('is false while a chain is still open, true once it encloses a room', () => {
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
    ]
    const closing = WallNode.parse({ start: [0, 3], end: [0, 0] })

    expect(wallClosesRoom(open, closing)).toBe(false)
    expect(wallClosesRoom([...open, closing], closing)).toBe(true)
  })

  test('fires when a bay is sealed against the middle of an existing wall', () => {
    const bigRoom = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
    ]
    const bayLeft = WallNode.parse({ start: [1, 0], end: [1, -2] })
    const bayBottom = WallNode.parse({ start: [1, -2], end: [3, -2] })
    const bayRight = WallNode.parse({ start: [3, -2], end: [3, 0] })

    // Two sides down and across: not enclosed yet.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom], bayBottom)).toBe(false)
    // The final side lands on the interior of the big room's bottom wall.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom, bayRight], bayRight)).toBe(true)
  })
})
