import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  emitter,
  GROUND_SUPPORT_ID,
  LevelNode,
  subscribeSceneCommits,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { useFloorplanDraftPreview } from '../store/use-floorplan-draft-preview'
import { runUndo } from './history'
import { sfxEmitter } from './sfx-bus'
import {
  addWallPolygonDraftCorner,
  commitWallPolygonDraft,
  discardWallPolygonDraft,
  isWallPolygonDraftOpen,
  startWallPolygonDraft,
  wallPolygonDraftWalls,
} from './wall-polygon-draft'

// Node updates batch their dirty marks on the next frame.
;(
  globalThis as { requestAnimationFrame?: (callback: () => void) => number }
).requestAnimationFrame ??= (callback) => {
  callback()
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_polygon', children: ['wall_existing'] })
const existing = WallNode.parse({
  id: 'wall_existing',
  parentId: level.id,
  start: [10, 0],
  end: [14, 0],
})
const levelId = level.id as AnyNodeId

const history = () => {
  const { pastStates, futureStates } = useScene.temporal.getState()
  return { past: pastStates.length, future: futureStates.length }
}
const walls = () =>
  Object.values(useScene.getState().nodes).filter((node): node is WallNode => node.type === 'wall')

let commits = 0
let sceneWrites = 0
let stopCommits = () => {}
let stopWrites = () => {}

beforeEach(() => {
  useScene.setState({
    nodes: { [level.id]: level, [existing.id]: existing } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [levelId],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ levelId: level.id })
  commits = 0
  sceneWrites = 0
  stopCommits = subscribeSceneCommits(() => {
    commits += 1
  })
  stopWrites = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) sceneWrites += 1
  })
})

afterEach(() => {
  discardWallPolygonDraft()
  stopCommits()
  stopWrites()
})

/** Three placed sides of an open rectangle room, not closed yet. */
function drawThreeSides() {
  startWallPolygonDraft(levelId, [0, 0])
  expect(addWallPolygonDraftCorner([4, 0])).toBe('open')
  expect(addWallPolygonDraftCorner([4, 3])).toBe('open')
  expect(addWallPolygonDraftCorner([0, 3])).toBe('open')
}

describe('Polygon room draft', () => {
  test('an open polygon writes nothing: no scene change, history, commit or autosave trigger', () => {
    const before = useScene.getState().nodes
    drawThreeSides()
    expect(useScene.getState().nodes).toBe(before)
    expect(sceneWrites).toBe(0)
    expect(commits).toBe(0)
    expect(history()).toEqual({ past: 0, future: 0 })
    // It exists only as draft corners, drawn as ghosts and used as snap targets.
    expect(useFloorplanDraftPreview.getState().wallPolygonDraftPoints).toHaveLength(4)
    expect(wallPolygonDraftWalls()).toHaveLength(3)
  })

  test('each placed corner plays the start tick; closing plays the build cue once', () => {
    const played: string[] = []
    const listen = (name: string) => () => played.push(name)
    const onStart = listen('start')
    const onBuild = listen('build')
    sfxEmitter.on('sfx:structure-build-start', onStart)
    sfxEmitter.on('sfx:structure-build', onBuild)
    try {
      drawThreeSides()
      expect(played).toEqual(['start', 'start', 'start'])
      expect(addWallPolygonDraftCorner([0.05, 0.05])).toBe('closed')
      commitWallPolygonDraft()
      expect(played).toEqual(['start', 'start', 'start', 'build'])
    } finally {
      sfxEmitter.off('sfx:structure-build-start', onStart)
      sfxEmitter.off('sfx:structure-build', onBuild)
    }
  })

  test('Esc just drops the draft', () => {
    const before = useScene.getState().nodes
    drawThreeSides()
    discardWallPolygonDraft()
    expect(isWallPolygonDraftOpen()).toBe(false)
    expect(useFloorplanDraftPreview.getState().wallPolygonDraftPoints).toEqual([])
    expect(useScene.getState().nodes).toBe(before)
    expect({ sceneWrites, commits, ...history() }).toEqual({
      sceneWrites: 0,
      commits: 0,
      past: 0,
      future: 0,
    })
  })

  test('closing on the first corner writes every wall as one undo step and one commit', () => {
    const before = useScene.getState().nodes
    drawThreeSides()
    expect(addWallPolygonDraftCorner([0.05, 0.05])).toBe('closed')
    const created = commitWallPolygonDraft()

    expect(created).toHaveLength(4)
    expect(walls()).toHaveLength(5)
    expect(history()).toEqual({ past: 1, future: 0 })
    expect(commits).toBe(1)
    // The closing side ends exactly on the first corner.
    expect(created.some((wall) => wall.end[0] === 0 && wall.end[1] === 0)).toBe(true)

    runUndo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('a corner that tees into an existing wall ends the polygon and splits that wall', () => {
    startWallPolygonDraft(levelId, [12, 3])
    expect(addWallPolygonDraftCorner([12, 0])).toBe('joined')
    commitWallPolygonDraft()
    // The existing wall is split at the tee; one new wall joins it.
    expect(walls()).toHaveLength(3)
    expect(history()).toEqual({ past: 1, future: 0 })
    expect(commits).toBe(1)
  })

  test('a double-click keeps an open polygon as drawn', () => {
    drawThreeSides()
    expect(commitWallPolygonDraft()).toHaveLength(3)
    expect(walls()).toHaveLength(4)
    expect(history()).toEqual({ past: 1, future: 0 })
  })

  test("a collaborator's edit during the draft survives Esc and survives the commit", () => {
    drawThreeSides()
    // Stands in for a remote patch landing mid-draft.
    useScene.getState().updateNode(existing.id, { name: 'Renamed remotely' })
    discardWallPolygonDraft()
    expect(useScene.getState().nodes[existing.id]?.name).toBe('Renamed remotely')

    drawThreeSides()
    useScene.getState().updateNode(existing.id, { name: 'Renamed again' })
    addWallPolygonDraftCorner([0, 0])
    commitWallPolygonDraft()
    expect(useScene.getState().nodes[existing.id]?.name).toBe('Renamed again')
    expect(walls()).toHaveLength(5)
  })

  test('a level change drops the polygon and resets the drafting tool', () => {
    let toolCancels = 0
    const onCancel = () => {
      toolCancels += 1
    }
    emitter.on('tool:cancel', onCancel)
    try {
      drawThreeSides()
      useViewer.getState().setSelection({ levelId: 'level_other' })
      expect(isWallPolygonDraftOpen()).toBe(false)
      expect(toolCancels).toBe(1)
      expect(sceneWrites).toBe(0)
    } finally {
      emitter.off('tool:cancel', onCancel)
    }
  })

  test('a view switch drops the polygon: its owning view changes, so ownership starts over', () => {
    let toolCancels = 0
    const onCancel = () => {
      toolCancels += 1
    }
    emitter.on('tool:cancel', onCancel)
    const view = useEditor.getState().viewMode
    try {
      drawThreeSides()
      useEditor.getState().setViewMode(view === '2d' ? '3d' : '2d')
      expect(isWallPolygonDraftOpen()).toBe(false)
      expect(toolCancels).toBe(1)
      // The other view's click after that finds no polygon and ends its chain
      // instead of drafting on as if one were open.
      expect(addWallPolygonDraftCorner([6, 6])).toBe('ended')
      expect(sceneWrites).toBe(0)
    } finally {
      emitter.off('tool:cancel', onCancel)
      useEditor.getState().setViewMode(view)
    }
  })

  test('sides split by a later crossing side keep the polygon construction settings', () => {
    // A raised ground draft: the construction plane sets each wall's height
    // and support offset.
    startWallPolygonDraft(levelId, [0, 0], {
      preferredSupportSlabId: GROUND_SUPPORT_ID,
      flatConstructionBase: true,
      constructionElevation: 2,
      constructionHeight: 2,
    })
    addWallPolygonDraftCorner([4, 0])
    addWallPolygonDraftCorner([4, 3])
    // Crosses the first side at (3, 0): that side splits into two pieces.
    addWallPolygonDraftCorner([2, -1])
    const created = commitWallPolygonDraft()
    const drawn = walls().filter((wall) => wall.id !== existing.id)
    expect(drawn.length).toBeGreaterThan(3)
    expect(new Set(created.map((wall) => wall.id))).toEqual(new Set(drawn.map((wall) => wall.id)))
    for (const wall of drawn) {
      expect(wall.height).toBe(2)
      expect(wall.supportOffset).toBe(2)
    }
  })

  test('commit and discard are no-ops without an open draft', () => {
    expect(commitWallPolygonDraft()).toEqual([])
    discardWallPolygonDraft()
    expect({ sceneWrites, commits, ...history() }).toEqual({
      sceneWrites: 0,
      commits: 0,
      past: 0,
      future: 0,
    })
  })
})
