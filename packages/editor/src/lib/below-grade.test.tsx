import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import useEditor from '../store/use-editor'
import villaAurelia from './__fixtures__/owner-villa-aurelia-basement.json'
import {
  belowGradeShown,
  followBelowGrade,
  followGroundWindowBox,
  gradeStandingShown,
  groundWindowBoxShown,
} from './below-grade'
import { useEditorLevelDisplay } from './editor-level-display'

// The owner's villa (13 Oct), trimmed: its Lower Ground lies 3.35 m under the lawn.
const villa = villaAurelia.nodes as unknown as Record<AnyNodeId, AnyNode>
const lowerGround = 'level_68jf2zqaukfjof3m' as LevelNode['id']
const pianoNobile = 'level_ztimtvrgdzzd6c9f' as LevelNode['id']

const shown = (levelId: LevelNode['id'], hideLevelsAboveSelection = true) => ({
  hideLevelsAboveSelection,
  selection: { levelId },
})

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
  editor: ReturnType<typeof useEditor.getState>
}
beforeEach(() => {
  previous = {
    viewer: useViewer.getState(),
    scene: useScene.getState(),
    editor: useEditor.getState(),
  }
  useScene.setState({ nodes: villa } as never)
})
afterEach(() => {
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
  useEditor.setState(previous.editor, true)
})

describe('when a level below grade is shown', () => {
  test('a level below grade, the storeys above it hidden', () => {
    expect(belowGradeShown(shown(lowerGround), villa)).toBe(true)
  })

  test('never for a level at grade', () => {
    expect(belowGradeShown(shown(pianoNobile), villa)).toBe(false)
  })

  test('never while the whole building stands', () => {
    expect(belowGradeShown(shown(lowerGround, false), villa)).toBe(false)
  })
})

describe('the ground window’s box', () => {
  test('the shown level’s box while its upper storeys are hidden, the building’s while it stands', () => {
    const levelBox = groundWindowBoxShown(shown(lowerGround), villa)
    const buildingBox = groundWindowBoxShown(shown(lowerGround, false), villa)
    expect(levelBox).not.toBeNull()
    expect(buildingBox).not.toBeNull()
    // The building wraps the level: no wider claim than that is this test's to make.
    expect(buildingBox?.min[1]).toBeLessThanOrEqual(levelBox?.min[1] ?? 0)
    expect(buildingBox?.max[1]).toBeGreaterThan(levelBox?.max[1] ?? 0)
  })

  test('it follows the display and closes when it stops', () => {
    useViewer.setState({ hideLevelsAboveSelection: true })
    useViewer.getState().setSelection({ levelId: lowerGround })
    const stop = followGroundWindowBox()
    expect(useViewer.getState().groundWindowBox).not.toBeNull()
    stop()
    expect(useViewer.getState().groundWindowBox).toBeNull()
  })
})

test('the flag follows the level shown, and clears when it stops', () => {
  useViewer.setState({ hideLevelsAboveSelection: true })
  useViewer.getState().setSelection({ levelId: pianoNobile })
  const stop = followBelowGrade()
  expect(useViewer.getState().belowGrade).toBe(false)

  useViewer.getState().setSelection({ levelId: lowerGround })
  expect(useViewer.getState().belowGrade).toBe(true)
  expect(useViewer.getState().gradeStanding).toBe('below-grade')
  expect(gradeStandingShown(shown(lowerGround), villa)).toBe('below-grade')
  useViewer.setState({ hideLevelsAboveSelection: false })
  expect(useViewer.getState().belowGrade).toBe(false)
  useViewer.setState({ hideLevelsAboveSelection: true })
  expect(useViewer.getState().belowGrade).toBe(true)

  stop()
  expect(useViewer.getState().belowGrade).toBe(false)
  expect(useViewer.getState().gradeStanding).toBe('at-grade')
})

test("the editor's level display marks it, except on the site, where the ground is the work", async () => {
  useViewer.getState().setSelection({ levelId: lowerGround })
  useEditor.setState({ phase: 'site' })
  function LevelDisplay() {
    useEditorLevelDisplay(false)
    return null
  }
  const renderer = await create(<LevelDisplay />)
  try {
    expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
    expect(useViewer.getState().belowGrade).toBe(false)
    expect(useViewer.getState().groundWindowBox).toBeNull()

    await act(async () => useEditor.setState({ phase: 'building' }))
    expect(useViewer.getState().belowGrade).toBe(true)
    expect(useViewer.getState().groundWindowBox).not.toBeNull()
  } finally {
    await renderer.unmount()
  }
  expect(useViewer.getState().belowGrade).toBe(false)
  expect(useViewer.getState().groundWindowBox).toBeNull()
})
