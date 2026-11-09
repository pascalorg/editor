import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  type LevelNode,
  LevelNode as LevelSchema,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { buildGroundLevelChanges } from '@pascal-app/core/building'
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

test('the ground window’s box is the shown level’s while its upper storeys are hidden and the building’s while it stands, follows the display, and closes when it stops', () => {
  const levelBox = groundWindowBoxShown(shown(lowerGround), villa)
  const buildingBox = groundWindowBoxShown(shown(lowerGround, false), villa)
  expect(levelBox).not.toBeNull()
  expect(buildingBox).not.toBeNull()
  // The building wraps the level: no wider claim than that is this test's to make.
  expect(buildingBox?.min[1]).toBeLessThanOrEqual(levelBox?.min[1] ?? 0)
  expect(buildingBox?.max[1]).toBeGreaterThan(levelBox?.max[1] ?? 0)

  useViewer.setState({ hideLevelsAboveSelection: true })
  useViewer.getState().setSelection({ levelId: lowerGround })
  const stop = followGroundWindowBox()
  expect(useViewer.getState().groundWindowBox).not.toBeNull()
  stop()
  expect(useViewer.getState().groundWindowBox).toBeNull()
})

test('the flag follows the level shown (below grade with the storeys above it hidden; never a level at grade, never while the whole building stands), and clears when it stops', () => {
  useViewer.setState({ hideLevelsAboveSelection: true })
  useViewer.getState().setSelection({ levelId: pianoNobile })
  const stop = followBelowGrade()
  expect(useViewer.getState().belowGrade).toBe(false)
  expect(belowGradeShown(shown(pianoNobile), villa)).toBe(false)

  useViewer.getState().setSelection({ levelId: lowerGround })
  expect(useViewer.getState().belowGrade).toBe(true)
  expect(useViewer.getState().gradeStanding).toBe('below-grade')
  expect(gradeStandingShown(shown(lowerGround), villa)).toBe('below-grade')
  useViewer.setState({ hideLevelsAboveSelection: false })
  expect(useViewer.getState().belowGrade).toBe(false)
  expect(belowGradeShown(shown(lowerGround, false), villa)).toBe(false)
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

// The owner's mansion (15 Oct): two basements, the stack standing Lower Ground at grade.
test('with the ground line set on a mansion, the flag follows the level shown: -1, then -2, then the ground floor', () => {
  const plate = (id: string, size: number) =>
    SlabNode.parse({
      id: `slab_${id}`,
      parentId: id,
      elevation: 0.2,
      polygon: [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
      ],
    })
  const level = (id: string, index: number, baseElevation: number, height: number) =>
    LevelSchema.parse({
      id,
      parentId: 'building_mansion',
      level: index,
      baseElevation,
      height,
      children: [`slab_${id}`],
    })
  const levels = [
    level('level_basement_2', -2, -3.4, 3.4),
    level('level_lower_ground', -1, 0, 3.4),
    level('level_reception', 0, 0, 4),
  ]
  const mansion = Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_mansion', children: levels.map((entry) => entry.id) }),
      ...levels,
      plate('level_basement_2', 14),
      plate('level_lower_ground', 8),
      plate('level_reception', 10),
    ].map((node) => [node.id, node as AnyNode]),
  ) as Record<AnyNodeId, AnyNode>
  const lower = 'level_lower_ground' as LevelNode['id']
  const deep = 'level_basement_2' as LevelNode['id']
  const reception = 'level_reception' as LevelNode['id']
  // "Set as ground floor" on the reception seats the stack: both basements are below grade.
  const built = buildGroundLevelChanges({ nodes: mansion, levelId: reception })
  const seated: Record<string, AnyNode> = { ...mansion }
  for (const { id, data } of built?.update ?? []) seated[id] = { ...seated[id], ...data } as AnyNode
  useScene.setState({ nodes: seated as Record<AnyNodeId, AnyNode> } as never)
  useViewer.setState({ hideLevelsAboveSelection: true })
  const stop = followBelowGrade()
  const flag = () => useViewer.getState().gradeStanding
  useViewer.getState().setSelection({ levelId: lower })
  expect(flag()).toBe('below-grade')
  useViewer.getState().setSelection({ levelId: deep })
  expect(flag()).toBe('below-grade')
  useViewer.getState().setSelection({ levelId: reception })
  expect(flag()).toBe('at-grade')
  stop()
})
