import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import useEditor from '../store/use-editor'
import villaAurelia from './__fixtures__/owner-villa-aurelia-basement.json'
import { belowGradeShown, followBelowGrade } from './below-grade'
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

test('the flag follows the level shown, and clears when it stops', () => {
  useViewer.setState({ hideLevelsAboveSelection: true })
  useViewer.getState().setSelection({ levelId: pianoNobile })
  const stop = followBelowGrade()
  expect(useViewer.getState().belowGrade).toBe(false)

  useViewer.getState().setSelection({ levelId: lowerGround })
  expect(useViewer.getState().belowGrade).toBe(true)
  useViewer.setState({ hideLevelsAboveSelection: false })
  expect(useViewer.getState().belowGrade).toBe(false)
  useViewer.setState({ hideLevelsAboveSelection: true })
  expect(useViewer.getState().belowGrade).toBe(true)

  stop()
  expect(useViewer.getState().belowGrade).toBe(false)
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

    await act(async () => useEditor.setState({ phase: 'building' }))
    expect(useViewer.getState().belowGrade).toBe(true)
  } finally {
    await renderer.unmount()
  }
  expect(useViewer.getState().belowGrade).toBe(false)
})
