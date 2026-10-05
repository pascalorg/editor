import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor, { type CaptureMode } from '../store/use-editor'
import { showsWholeBuilding } from './editor-level-display'

const building = BuildingNode.parse({ id: 'building_capture', children: [] })
const levels = [0, 1, 2].map((level) =>
  LevelNode.parse({ id: `level_capture_${level}`, level, parentId: building.id }),
)
const [ground, first, second] = levels.map((level) => level.id) as [
  LevelNode['id'],
  LevelNode['id'],
  LevelNode['id'],
]

const wholeBuilding = () => {
  const state = useEditor.getState()
  return showsWholeBuilding({
    isPreviewMode: state.isPreviewMode,
    isFirstPersonMode: state.isFirstPersonMode,
    captureMode: state.captureMode,
    captureLevelId: state.captureLevelId,
  })
}
const activeLevel = () => useViewer.getState().selection.levelId

beforeEach(() => {
  useScene.setState({
    nodes: Object.fromEntries(
      [{ ...building, children: levels.map((level) => level.id) }, ...levels].map((node) => [
        node.id,
        node,
      ]),
    ),
    rootNodeIds: [building.id],
  } as never)
  useViewer.getState().setSelection({ buildingId: building.id, levelId: second })
})
afterEach(() => useEditor.getState().setCaptureMode(false))

describe('capture level picker', () => {
  test('editing hides the levels above; capture opens on the whole building', () => {
    expect(wholeBuilding()).toBe(false)
    useEditor.getState().setCaptureMode(true)
    expect(useEditor.getState().captureLevelId).toBeNull()
    expect(wholeBuilding()).toBe(true)
    expect(activeLevel()).toBe(second)
  })

  test('picking a level shows it and the levels below, as while editing', () => {
    useEditor.getState().setCaptureMode(true)
    useEditor.getState().setCaptureLevel(first)
    expect(wholeBuilding()).toBe(false)
    expect(activeLevel()).toBe(first)
    useEditor.getState().setCaptureLevel(null)
    expect(wholeBuilding()).toBe(true)
  })

  test("leaving capture restores the editor's active level and the editing rule", () => {
    useEditor.getState().setCaptureMode(true)
    useEditor.getState().setCaptureLevel(ground)
    useEditor.getState().setCaptureMode(false)
    expect(activeLevel()).toBe(second)
    expect(useEditor.getState().captureLevelId).toBeNull()
    expect(wholeBuilding()).toBe(false)
    // The next capture opens on the whole building again.
    useEditor.getState().setCaptureMode({ mode: 'standard', crop: 'area' })
    expect(wholeBuilding()).toBe(true)
  })

  test('a level picked outside capture is ignored', () => {
    useEditor.getState().setCaptureLevel(ground)
    expect(activeLevel()).toBe(second)
    expect(useEditor.getState().captureLevelId).toBeNull()
  })

  test('preset captures and the walkthrough keep their own rules', () => {
    const preset: CaptureMode = { mode: 'preset', isolated: [] }
    const base = { isPreviewMode: false, isFirstPersonMode: false, captureLevelId: null }
    expect(showsWholeBuilding({ ...base, captureMode: preset })).toBe(false)
    expect(showsWholeBuilding({ ...base, captureMode: { mode: 'idle' } })).toBe(false)
    expect(
      showsWholeBuilding({ ...base, isFirstPersonMode: true, captureMode: { mode: 'idle' } }),
    ).toBe(true)
    // A walk capture on a picked level still shows only that level and below.
    expect(
      showsWholeBuilding({
        ...base,
        isFirstPersonMode: true,
        captureMode: { mode: 'standard' },
        captureLevelId: first,
      }),
    ).toBe(false)
  })
})
