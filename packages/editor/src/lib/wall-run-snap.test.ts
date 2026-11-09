import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  detectSpacesForLevel,
  LevelNode as LevelSchema,
  nodeRegistry,
  registerNode,
  useScene,
  type WallNode,
  WallNode as WallSchema,
  wallClosesRoom,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createWallOnCurrentLevel } from '../components/tools/wall/wall-drafting'
import type { WallPlanPoint } from '../components/tools/wall/wall-snap-geometry'
import useEditor from '../store/use-editor'
import {
  addWallPolygonDraftCorner,
  discardWallPolygonDraft,
  startWallPolygonDraft,
  wallPolygonDraftWalls,
} from './wall-polygon-draft'
import { isWallRunFree, snapWallRunDraftPoint, wallRunDirection } from './wall-run-snap'

// `updateNodes` batches its dirty-marking through requestAnimationFrame,
// which bun's test runtime doesn't provide.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

const LEVEL_ID = 'level_run' as AnyNodeId
const deg = (degrees: number) => (degrees * Math.PI) / 180

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === LEVEL_ID,
  )
}

/**
 * A plain run as the wall tool drafts it once its first point is placed: each
 * wall from the last one's end, square to it, snapped against the level's walls.
 */
function plainRun(runStart: WallPlanPoint) {
  let start = runStart
  let reference: WallPlanPoint | null = null
  return (cursor: WallPlanPoint, free = false) => {
    const snapped = snapWallRunDraftPoint({
      point: cursor,
      start,
      runStart,
      reference,
      walls: levelWalls(),
      free,
    })
    const wall = createWallOnCurrentLevel(start, snapped.point)!
    start = wall.end
    reference = wallRunDirection(wall.start, wall.end)
    return { wall, snapped }
  }
}

describe('a plain wall run snaps like a pulled one once started', () => {
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
    useEditor.getState().setSnappingMode('wall', 'grid')
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    useViewer.setState({
      selection: { buildingId: null, levelId: LEVEL_ID, zoneId: null, selectedIds: [] },
    } as never)
    const level = LevelSchema.parse({ id: LEVEL_ID, level: 0, height: 2.7, children: [] })
    useScene.setState({
      nodes: { [level.id]: level as AnyNode },
      rootNodeIds: [level.id],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
  })

  afterEach(() => {
    discardWallPolygonDraft()
    restoreRegistry?.()
    restoreRegistry = undefined
    useEditor.getState().setSnappingMode('wall', 'grid')
    useEditor.setState(previousEditor as never)
    useEditor.getState().armToolMode({ mode: 'select' })
  })

  test("the first wall holds to the house's axes, steps 15° past them, and Alt frees it", () => {
    const snap = (cursor: WallPlanPoint, free = false) =>
      snapWallRunDraftPoint({
        point: cursor,
        start: [0, 0],
        runStart: [0, 0],
        reference: null,
        walls: [],
        free,
      })
    const axis = snap([4.1, 0.35])
    expect(axis.lock).toBe('axis')
    expect(axis.point).toEqual([4, 0])
    const stepped = snap([Math.cos(deg(40)) * 3, Math.sin(deg(40)) * 3])
    expect(stepped.lock).toBe('angle')
    expect(stepped.point[0]).toBeCloseTo(Math.cos(deg(45)) * 3, 6)
    expect(stepped.point[1]).toBeCloseTo(Math.sin(deg(45)) * 3, 6)
    expect(isWallRunFree({ altKey: true })).toBe(true)
    expect(isWallRunFree()).toBe(false)
    expect(snap([3.13, 1.07], isWallRunFree({ altKey: true })).point).toEqual([3.13, 1.07])
    // Snapping off frees it too.
    useEditor.getState().setSnappingMode('wall', 'off')
    expect(isWallRunFree()).toBe(true)
  })

  test('a Walls run squares up, lines up with its start and closes into a room', () => {
    // The first point keeps the tool's own snapping; the run starts at (0, 0).
    const place = plainRun([0, 0])
    const first = place([5.1, 0.4])
    expect(first.snapped.lock).toBe('axis')
    expect(first.wall.end).toEqual([5, 0])
    const second = place([5.3, 3.9])
    expect(second.snapped.lock).toBe('square')
    expect(second.wall.end).toEqual([5, 4])
    const third = place([0.1, 4.05])
    expect(third.snapped.snap).toBe('alignment')
    expect(third.snapped.label).toBe('In line with start')
    expect(third.snapped.guides.some((guide) => guide.kind === 'run-start')).toBe(true)
    expect(third.snapped.guides.some((guide) => guide.kind === 'extension')).toBe(true)
    expect(third.wall.end).toEqual([0, 4])
    const last = place([0.12, 0.18])
    expect(last.snapped.snap).toBe('endpoint')
    expect(last.wall.end).toEqual([0, 0])
    expect(wallClosesRoom(levelWalls(), last.wall)).toBe(true)
    const rooms = detectSpacesForLevel(LEVEL_ID, levelWalls()).spaces.filter(
      (space) => !space.isExterior,
    )
    expect(rooms).toHaveLength(1)
  })

  test('a Polygon room snaps its corners the same way and closes on its first', () => {
    startWallPolygonDraft(LEVEL_ID, [0, 0])
    let start: WallPlanPoint = [0, 0]
    let reference: WallPlanPoint | null = null
    const corner = (cursor: WallPlanPoint) => {
      const snapped = snapWallRunDraftPoint({
        point: cursor,
        start,
        runStart: [0, 0],
        reference,
        walls: [...levelWalls(), ...wallPolygonDraftWalls()],
        free: false,
      })
      const outcome = addWallPolygonDraftCorner(snapped.point)
      reference = wallRunDirection(start, snapped.point)
      start = snapped.point
      return { snapped, outcome }
    }
    expect(corner([3.9, -0.3]).snapped.point).toEqual([4, 0])
    expect(corner([4.2, 2.95]).snapped.point).toEqual([4, 3])
    const across = corner([-0.08, 3.1])
    expect(across.snapped.label).toBe('In line with start')
    expect(across.snapped.point).toEqual([0, 3])
    const close = corner([0.1, 0.2])
    expect(close.snapped.snap).toBe('endpoint')
    expect(close.outcome).toBe('closed')
  })
})
