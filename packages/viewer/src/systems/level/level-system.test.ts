import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import {
  BATCHED_LAYER,
  hideFromScene,
  presentLevelsForCapture,
  SCENE_LAYER,
  SHADOW_ONLY_LAYER,
} from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Object3D } from 'three'
import useViewer from '../../store/use-viewer'
import { releaseLevel, setHeldLevelY } from './level-hold'
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
    levelsRevealing: [],
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

  test('decides from the level index alone: the levels above the selected one hide in every building', async () => {
    const level = (id: string, parentId: string, index: number) => ({
      object: 'node',
      id,
      type: 'level',
      parentId,
      visible: true,
      metadata: {},
      children: [],
      level: index,
      height: 2.5,
    })
    const building = (id: string, children: string[]) => ({
      object: 'node',
      id,
      type: 'building',
      parentId: null,
      visible: true,
      metadata: {},
      children,
    })
    const levels = [
      level('level_a_m1', 'building_a', -1),
      level('level_a_g', 'building_a', 0),
      level('level_b_m1', 'building_b', -1),
      level('level_b_g', 'building_b', 0),
    ]
    useScene.setState({
      nodes: Object.fromEntries(
        [
          building('building_a', ['level_a_m1', 'level_a_g']),
          building('building_b', ['level_b_m1', 'level_b_g']),
          ...levels,
        ].map((node) => [node.id, node]),
      ) as unknown as Record<AnyNodeId, AnyNode>,
    })
    const objects = new Map(
      levels.map((entry) => {
        const object = new Object3D()
        sceneRegistry.nodes.set(entry.id, object)
        sceneRegistry.byType.level!.add(entry.id)
        return [entry.id, object] as const
      }),
    )
    // The first house's basement selected: the second house's basement shows as it does, and both
    // ground floors are hidden, whichever house they belong to.
    setLevelMode('stacked', 'level_a_m1')
    useViewer.setState({ hideLevelsAboveSelection: true })
    await updateLevelPresentation(1 / 12)
    const drawn = (id: string) => objects.get(id)!.layers.isEnabled(0)
    expect(['level_a_m1', 'level_a_g', 'level_b_m1', 'level_b_g'].map(drawn)).toEqual([
      true,
      false,
      true,
      false,
    ])
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

describe('a level a construction reveal is playing on', () => {
  test('shows above the selected level while its work plays, and steps aside after', async () => {
    const { levels, objects } = setupLevels([0, 0])
    setLevelMode('stacked', levels[0]!.id)
    useViewer.setState({ hideLevelsAboveSelection: true })
    await updateLevelPresentation(1 / 12)
    expect(objects[1]!.layers.isEnabled(0)).toBe(false)

    useViewer.setState({ levelsRevealing: [levels[1]!.id] })
    await updateLevelPresentation(1 / 12)
    expect(objects[1]!.visible).toBe(true)
    expect(objects[1]!.layers.isEnabled(0)).toBe(true)

    useViewer.setState({ levelsRevealing: [] })
    await updateLevelPresentation(1 / 12)
    expect(objects[1]!.layers.isEnabled(0)).toBe(false)
  })

  test('shows in solo, where every other level is hidden', async () => {
    const { levels, objects } = setupLevels([0, 0])
    setLevelMode('solo', levels[0]!.id)
    useViewer.setState({ levelsRevealing: [levels[1]!.id] })
    await updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.visible)).toEqual([true, true])
  })

  test('stays hidden when the author hid it', async () => {
    const { levels, objects } = setupLevels([0, 0])
    hideLevel(levels[1]!.id)
    setLevelMode('stacked', levels[0]!.id)
    useViewer.setState({ levelsRevealing: [levels[1]!.id] })
    await updateLevelPresentation(1 / 12)
    expect(objects[1]!.visible).toBe(false)
  })
})

describe('snapLevelsToTruePositions', () => {
  test.each(['missing', 'unmounted', 'unindexed', 'hidden-level', 'hidden-building'])(
    'refuses Solo for a %s floor before changing the live presentation',
    (condition) => {
      const { building, levels, objects } = setupLevels([0.5, 1.25])
      const selected = levels[1]!
      if (condition === 'missing') {
        const nodes = { ...useScene.getState().nodes }
        delete nodes[selected.id as AnyNodeId]
        useScene.setState({ nodes })
      } else if (condition === 'unmounted') sceneRegistry.nodes.delete(selected.id)
      else if (condition === 'unindexed') sceneRegistry.byType.level!.delete(selected.id)
      else hideLevel(condition === 'hidden-level' ? selected.id : building.id)
      const snapshot = () =>
        objects.map((obj) => ({
          y: obj.position.y,
          visible: obj.visible,
          mask: obj.layers.mask,
        }))
      const before = snapshot()
      const graph = useScene.getState().nodes
      const preferences = useViewer.getState()
      expect(() => presentLevelsForCapture({ mode: 'solo', levelId: selected.id })).toThrow()
      expect(snapshot()).toEqual(before)
      expect(useScene.getState().nodes).toBe(graph)
      expect(useViewer.getState()).toBe(preferences)
    },
  )

  test('captures exact Solo and Exploded states, retaining batch masks and restoring live state', () => {
    const { levels, objects } = setupLevels([0.5, 1.25, 0])
    objects[0]!.visible = false
    hideFromScene(objects[1]!, 'shadow-only')
    hideFromScene(objects[2]!, 'isolated')
    const batchSource = new Object3D()
    objects[1]!.add(batchSource)
    hideFromScene(batchSource, 'batched')
    const snapshot = () =>
      objects.map((obj) => ({ y: obj.position.y, visible: obj.visible, mask: obj.layers.mask }))
    const before = snapshot()
    const graph = useScene.getState().nodes
    const preferences = useViewer.getState()
    const batchMask = batchSource.layers.mask
    let restore = presentLevelsForCapture({ mode: 'exploded' })
    expect(objects.map((obj) => obj.position.y)).toEqual([0.5, 9.25, 16.75])
    expect(objects.every((obj) => obj.visible)).toBe(true)
    expect(objects.map((obj) => obj.layers.isEnabled(SCENE_LAYER))).toEqual([true, true, false])
    expect(objects[2]!.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)
    expect(batchSource.layers.isEnabled(BATCHED_LAYER)).toBe(true)
    expect(batchSource.layers.isEnabled(SCENE_LAYER)).toBe(false)
    restore()
    expect(snapshot()).toEqual(before)
    expect(batchSource.layers.mask).toBe(batchMask)
    restore = presentLevelsForCapture({ mode: 'solo', levelId: levels[1]!.id })
    expect(objects.map((obj) => obj.position.y)).toEqual([0.5, 4.25, 6.75])
    expect(objects[0]!.visible).toBe(false)
    expect(objects[1]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(objects[2]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(objects[2]!.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)
    restore()
    expect(snapshot()).toEqual(before)
    restore = presentLevelsForCapture({ mode: 'solo', levelId: levels[2]!.id })
    expect(objects[2]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
    restore()
    expect(snapshot()).toEqual(before)
    restore = presentLevelsForCapture({ mode: 'stacked' })
    expect(objects.map((obj) => obj.position.y)).toEqual([0.5, 4.25, 6.75])
    expect(objects.map((obj) => obj.layers.isEnabled(SCENE_LAYER))).toEqual([true, true, false])
    restore()
    expect(snapshot()).toEqual(before)
    expect(batchSource.layers.mask).toBe(batchMask)
    expect(useScene.getState().nodes).toBe(graph)
    expect(useViewer.getState()).toBe(preferences)
  })

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

describe('a level held by a construction reveal', () => {
  test('stays at the height the reveal gives it, and eases from there once released', async () => {
    const { levels, objects } = setupLevels([0, 0])
    setLevelMode('stacked')
    await updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.position.y)).toEqual([0, 2.5])

    setHeldLevelY(levels[1]!.id, 4)
    await updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.position.y)).toEqual([0, 4])

    releaseLevel(levels[1]!.id)
    await updateLevelPresentation(1 / 60)
    const [, eased] = objects.map((object) => object.position.y)
    expect(eased!).toBeLessThan(4)
    expect(eased!).toBeGreaterThan(2.5)
  })

  test('a level that has just mounted cuts every level to its height, none slides through another', async () => {
    const { levels, objects } = setupLevels([0, 0])
    setLevelMode('stacked')
    await updateLevelPresentation(1 / 12)
    // The ground floor and a roof level stand; a restored floor between them mounts at the origin.
    useViewer.setState({ levelMode: 'stacked' })
    const restored = new Object3D()
    sceneRegistry.nodes.set('level_restored' as AnyNodeId, restored)
    sceneRegistry.byType.level!.add('level_restored' as AnyNodeId)
    const nodes = useScene.getState().nodes
    const upper = nodes[levels[1]!.id as AnyNodeId] as unknown as { level: number }
    useScene.setState({
      nodes: {
        ...nodes,
        [levels[1]!.id]: { ...upper, level: 2 },
        level_restored: {
          ...(nodes[levels[1]!.id as AnyNodeId] as object),
          id: 'level_restored',
          level: 1,
        },
      } as unknown as Record<AnyNodeId, AnyNode>,
    })
    await updateLevelPresentation(1 / 60)
    expect(restored.position.y).toBe(2.5)
    expect(objects[1]!.position.y).toBe(5)
  })
})
