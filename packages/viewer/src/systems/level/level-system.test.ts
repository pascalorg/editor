import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Object3D } from 'three'
import useViewer from '../../store/use-viewer'
import { LevelSystem } from './level-system'
import { snapLevelsToTruePositions } from './level-utils'

let previousViewerState = useViewer.getState()

beforeEach(() => {
  previousViewerState = useViewer.getState()
})

function setupLevels(baseElevations: number[]) {
  const buildingId = 'building_base-elevation-system-test'
  const levels = baseElevations.map((baseElevation, level) => ({
    object: 'node',
    id: `level_base-elevation-system-${level}`,
    type: 'level',
    parentId: buildingId,
    visible: true,
    metadata: {},
    children: [],
    level,
    baseElevation,
    height: 2.5,
  }))
  const building = {
    object: 'node',
    id: buildingId,
    type: 'building',
    parentId: null,
    visible: true,
    metadata: {},
    children: levels.map((level) => level.id),
  }

  const nodes = Object.fromEntries(
    [building, ...levels].map((node) => [node.id, node]),
  ) as unknown as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes })

  const objects = levels.map((level) => {
    const object = new Object3D()
    object.position.y = -100
    sceneRegistry.nodes.set(level.id, object)
    sceneRegistry.byType.level!.add(level.id)
    return object
  })

  return { building, levels, objects }
}

function hideLevel(levelId: string) {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]!
  useScene.setState({ nodes: { ...nodes, [levelId]: { ...level, visible: false } } })
}

function setLevelMode(
  mode: 'stacked' | 'exploded' | 'solo',
  selectedLevelId: string | null = null,
) {
  useViewer.setState({
    levelMode: mode,
    selection: { ...useViewer.getState().selection, levelId: selectedLevelId },
  })
}

async function updateLevelPresentation(delta: number) {
  const renderer = await create(createElement(LevelSystem))
  try {
    await renderer.advanceFrames(1, delta)
  } finally {
    await renderer.unmount()
  }
}

afterEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {} as Record<AnyNodeId, AnyNode> })
  useViewer.setState({
    levelMode: previousViewerState.levelMode,
    hideLevelsAboveSelection: false,
    selection: previousViewerState.selection,
  })
})

describe('updateLevelPresentation', () => {
  test('writes offset positions to the registry transform used by floorplan and selection', async () => {
    const { objects } = setupLevels([0, 1.25, 0])
    setLevelMode('stacked')

    await updateLevelPresentation(1 / 12)

    expect(objects.map((object) => object.position.y)).toEqual([0, 3.75, 6.25])
  })

  test('keeps offset-aware positions in exploded and solo modes', async () => {
    const { levels, objects } = setupLevels([1, 0.5])

    setLevelMode('exploded')
    await updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.position.y)).toEqual([1, 9])

    objects.forEach((object) => {
      object.position.y = -100
    })
    setLevelMode('solo', levels[1]!.id)
    await updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.position.y)).toEqual([1, 4])
    expect(objects[0]!.visible).toBe(false)
    expect(objects[1]!.visible).toBe(true)
  })

  test('hides a level the author hid, outside solo too', async () => {
    const { levels, objects } = setupLevels([0, 1])
    hideLevel(levels[0]!.id)
    setLevelMode('stacked')

    await updateLevelPresentation(1 / 12)

    expect(objects[0]!.visible).toBe(false)
    expect(objects[1]!.visible).toBe(true)
  })

  test('keeps a level the author hid out of the solo shadow-caster branch', async () => {
    const { levels, objects } = setupLevels([0, 1])
    hideLevel(levels[1]!.id)
    setLevelMode('solo', levels[0]!.id)

    await updateLevelPresentation(1 / 12)

    expect(objects[0]!.visible).toBe(true)
    expect(objects[1]!.visible).toBe(false)
  })
})

describe("the editor's level display", () => {
  test('stacked, hiding every level above the selected one', async () => {
    const { levels, objects } = setupLevels([0, 0, 0])
    setLevelMode('stacked', levels[1]!.id)
    useViewer.setState({ hideLevelsAboveSelection: true })
    await updateLevelPresentation(1 / 12)
    // Stacked positions, no exploded gap.
    expect(objects.map((object) => object.position.y)).toEqual([0, 2.5, 5])
    // Below and the selected level show; the one above casts shadows only.
    expect(objects.map((object) => object.visible)).toEqual([true, true, true])
    expect(objects[2]!.layers.isEnabled(0)).toBe(false)
    expect(objects[0]!.layers.isEnabled(0)).toBe(true)
    expect(objects[1]!.layers.isEnabled(0)).toBe(true)

    // The top level selected: everything shows again.
    setLevelMode('stacked', levels[2]!.id)
    await updateLevelPresentation(1 / 12)
    expect(objects.every((object) => object.visible && object.layers.isEnabled(0))).toBe(true)
  })

  test('a full-building capture shows the hidden upper levels for its render', async () => {
    const { levels, objects } = setupLevels([0, 0])
    setLevelMode('stacked', levels[0]!.id)
    useViewer.setState({ hideLevelsAboveSelection: true })
    await updateLevelPresentation(1 / 12)
    expect(objects[1]!.layers.isEnabled(0)).toBe(false)
    const restore = snapLevelsToTruePositions()
    expect(objects[1]!.layers.isEnabled(0)).toBe(true)
    restore()
    expect(objects[1]!.layers.isEnabled(0)).toBe(false)
  })
})

describe('snapLevelsToTruePositions', () => {
  test('bakes offset-aware stacked positions and restores the prior presentation', () => {
    const { objects } = setupLevels([0.5, 1.25])
    objects[0]!.position.y = 10
    objects[0]!.visible = false
    objects[1]!.position.y = 20

    const restore = snapLevelsToTruePositions()

    expect(objects.map((object) => object.position.y)).toEqual([0.5, 4.25])
    expect(objects.map((object) => object.visible)).toEqual([true, true])

    restore()

    expect(objects.map((object) => object.position.y)).toEqual([10, 20])
    expect(objects.map((object) => object.visible)).toEqual([false, true])
  })

  test('leaves a level the author hid hidden, matching the export', () => {
    const { levels, objects } = setupLevels([0.5, 1.25])
    hideLevel(levels[0]!.id)
    objects[0]!.visible = true

    const restore = snapLevelsToTruePositions()

    expect(objects.map((object) => object.visible)).toEqual([false, true])

    restore()

    expect(objects.map((object) => object.visible)).toEqual([true, true])
  })
})
