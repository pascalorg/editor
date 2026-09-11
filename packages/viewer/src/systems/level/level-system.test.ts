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
})
