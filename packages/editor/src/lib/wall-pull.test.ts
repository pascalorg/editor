import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  detectSpacesForLevel,
  getWallAssemblyPreset,
  LevelNode as LevelSchema,
  nodeRegistry,
  registerNode,
  useScene,
  type WallNode,
  WallNode as WallSchema,
  wallAssemblyPatch,
  wallClosesRoom,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createWallOnCurrentLevel } from '../components/tools/wall/wall-drafting'
import type { WallPlanPoint } from '../components/tools/wall/wall-snap-geometry'
import useEditor from '../store/use-editor'
import {
  endWallPullRun,
  startWallPull,
  useWallPullRun,
  wallPullSeed,
  wallPullTypePatch,
} from './wall-pull'
import { isWallRunFree, snapWallRunDraftPoint, wallRunDirection } from './wall-run-snap'

// `updateNodes` batches its dirty-marking through requestAnimationFrame,
// which bun's test runtime doesn't provide.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

const LEVEL_ID = 'level_pull' as AnyNodeId

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === LEVEL_ID,
  )
}

/** A lone stucco wall running east to the origin, 3.1 m tall on a 2.7 m storey, painted. */
function seedSourceWall(): WallNode {
  const preset = getWallAssemblyPreset('exterior-2x6-stucco')
  if (!preset) throw new Error('Expected the stucco preset')
  const source = WallSchema.parse({
    id: 'wall_source',
    name: 'Source',
    parentId: LEVEL_ID,
    start: [-4, 0],
    end: [0, 0],
    height: 3.1,
    ...wallAssemblyPatch(structuredClone(preset.assembly)),
    slots: { a: 'library:paint-sage', b: 'library:stucco-white' },
    skirting: { enabled: true, sides: 'both', height: 0.12, proud: 0.02, profile: 'flat' },
  })
  const level = LevelSchema.parse({
    id: LEVEL_ID,
    level: 0,
    height: 2.7,
    children: [source.id],
  })
  useScene.setState({
    nodes: { [level.id]: level as AnyNode, [source.id]: source as AnyNode },
    rootNodeIds: [level.id],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
  return source
}

describe('pulling the next wall from a wall end', () => {
  let restoreRegistry: (() => void) | undefined
  let previousEditor: Partial<ReturnType<typeof useEditor.getState>>

  beforeEach(() => {
    previousEditor = {
      toolDefaults: useEditor.getState().toolDefaults,
      continuationByContext: useEditor.getState().continuationByContext,
    }
    // The wall's snap profile makes the armed wall tool the 'wall' snapping
    // context (grid lengths), as in the app.
    restoreRegistry = nodeRegistry._snapshot()
    registerNode({
      kind: 'wall',
      schemaVersion: 10,
      schema: WallSchema,
      category: 'structure',
      snapProfile: 'structural',
      defaults: () => WallSchema.parse({ start: [0, 0], end: [1, 0] }),
      capabilities: {},
    } as never)
    useEditor.getState().setContinuation('wall', 'room')
    useEditor.getState().setSnappingMode('wall', 'grid')
    useEditor.getState().armToolMode({ mode: 'select' })
    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: ['wall_source'],
      },
    } as never)
    seedSourceWall()
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  afterEach(() => {
    endWallPullRun()
    restoreRegistry?.()
    restoreRegistry = undefined
    useEditor.setState(previousEditor as never)
    useEditor.getState().armToolMode({ mode: 'select' })
  })

  test('the pull arms the Walls run at the end, with the pulled wall’s type', () => {
    const source = useScene.getState().nodes['wall_source' as AnyNodeId] as WallNode
    expect(startWallPull({ wallId: source.id, endpoint: 'end', origin: '3d' })).toBe(true)

    const run = useWallPullRun.getState().run
    expect(run).toMatchObject({
      sourceWallId: source.id,
      levelId: LEVEL_ID,
      runStart: [0, 0],
      start: [0, 0],
      origin: '3d',
      dragging: true,
    })
    expect(run?.reference[0]).toBeCloseTo(1, 9)
    expect(run?.reference[1]).toBeCloseTo(0, 9)
    const editor = useEditor.getState()
    expect(editor.mode).toBe('build')
    expect(editor.tool).toBe('wall')
    expect(editor.getContinuation('wall')).toBe('single')
    expect(useViewer.getState().selection.selectedIds).toEqual([])

    // The pulled wall's construction, finishes and own height, not the Build
    // panel's types.
    const pulled = createWallOnCurrentLevel([0, 0], [3, 0])
    expect(pulled?.assembly).toEqual(source.assembly)
    expect(pulled?.thickness).toBe(source.thickness)
    expect(pulled?.height).toBe(3.1)
    expect(pulled?.slots).toEqual(source.slots)
    expect(pulled?.skirting).toEqual(source.skirting)
    expect(pulled?.start).toEqual([0, 0])

    // Ending puts back the Rooms shape and the wall tool defaults, in Select.
    endWallPullRun()
    expect(useWallPullRun.getState().run).toBeNull()
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().getContinuation('wall')).toBe('room')
    expect(useEditor.getState().toolDefaults.wall).toBeUndefined()
  })

  test('the type patch keeps a plain wall plain and a storey-high wall on the storey', () => {
    const plain = WallSchema.parse({ start: [0, 0], end: [2, 0], height: 2.7 })
    expect(wallPullTypePatch(plain, 2.7)).toEqual({ thickness: plain.thickness ?? 0.1 })
    const pulledFromStart = wallPullSeed(plain, 'start')
    expect(pulledFromStart?.start).toEqual([0, 0])
    expect(pulledFromStart?.reference[0]).toBeCloseTo(-1, 9)
  })

  test('closing the run back to its start forms a room, one undo step per wall', () => {
    startWallPull({ wallId: 'wall_source', endpoint: 'end', origin: '3d' })
    expect(isWallRunFree()).toBe(false)
    const run = useWallPullRun.getState().run!
    // The run as the tool drafts it: each wall from the last one's end,
    // square to it — the pulled wall first.
    let start = run.start
    let reference: WallPlanPoint | null = run.reference
    const place = (cursor: WallPlanPoint) => {
      const snapped = snapWallRunDraftPoint({
        point: cursor,
        start,
        runStart: run.runStart,
        reference,
        walls: levelWalls(),
        free: isWallRunFree(),
      })
      const before = useScene.temporal.getState().pastStates.length
      const wall = createWallOnCurrentLevel(start, snapped.point)!
      expect(useScene.temporal.getState().pastStates.length).toBe(before + 1)
      start = wall.end
      reference = wallRunDirection(wall.start, wall.end)
      return { wall, snapped }
    }

    // Straight on (6° off) to a grid length; square up; back west until the
    // run's start lines up; then onto the start itself.
    const first = place([5.1, 0.45])
    expect(first.snapped.lock).toBe('straight')
    expect(first.wall.end).toEqual([5, 0])
    const second = place([5.25, 3.9])
    expect(second.snapped.lock).toBe('square')
    expect(second.wall.end).toEqual([5, 4])
    expect(wallClosesRoom(levelWalls(), second.wall)).toBe(false)
    const third = place([0.1, 4.05])
    expect(third.snapped.snap).toBe('alignment')
    expect(third.wall.end).toEqual([0, 4])
    const last = place([0.12, 0.2])
    expect(last.snapped.snap).toBe('endpoint')
    expect(last.wall.end).toEqual([0, 0])

    const walls = levelWalls()
    expect(wallClosesRoom(walls, last.wall)).toBe(true)
    const rooms = detectSpacesForLevel(LEVEL_ID, walls).spaces.filter((space) => !space.isExterior)
    expect(rooms).toHaveLength(1)
    const xs = rooms[0]!.polygon.map((point) => point[0])
    const zs = rooms[0]!.polygon.map((point) => point[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([
      0, 5, 0, 4,
    ])
  })

  test('leaving the wall tool ends the run without leaving Select behind', () => {
    startWallPull({ wallId: 'wall_source', endpoint: 'start', origin: '2d' })
    expect(useWallPullRun.getState().run?.start).toEqual([-4, 0])
    useEditor.getState().armToolMode({ mode: 'build', tool: 'slab' })
    expect(useWallPullRun.getState().run).toBeNull()
    expect(useEditor.getState().tool).toBe('slab')
    expect(useEditor.getState().getContinuation('wall')).toBe('room')
  })
})
