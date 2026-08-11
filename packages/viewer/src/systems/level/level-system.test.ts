// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import type { Object3D } from 'three'

// Only the two modules that need a renderer or a React context are mocked.
// `@pascal-app/core` is deliberately NOT mocked: mock.module replaces a module
// for the whole test process and Bun never restores it, so faking core here
// breaks the other viewer suites that run after this file.
type FrameCallback = (state: unknown, delta: number) => void
let frameCallback: FrameCallback | null = null

// Read through a function so the value is not control-flow narrowed. The
// useFrame mock assigns frameCallback while LevelSystem() runs; TypeScript
// cannot see through that indirection, so reading the binding directly after
// `frameCallback = null` narrows it to `null` and types the call `never`.
function takeFrameCallback(): FrameCallback | null {
  return frameCallback
}

mock.module('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    frameCallback = callback
  },
}))

let viewerState = {
  levelMode: 'stacked' as 'stacked' | 'exploded' | 'solo',
  selection: { levelId: null as string | null },
}

mock.module('../../store/use-viewer', () => ({
  default: {
    getState: () => viewerState,
  },
}))

const [{ LevelSystem }, { snapLevelsToTruePositions }] = await Promise.all([
  import('./level-system'),
  import('./level-utils'),
])

/** Stand-in for a level's Object3D — LevelSystem only touches these fields. */
function fakeLevelObject(): Object3D {
  return {
    position: { y: -100 },
    visible: true,
    layers: { mask: 0 },
  } as unknown as Object3D
}

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
    const object = fakeLevelObject()
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
  viewerState = {
    levelMode: mode,
    selection: { levelId: selectedLevelId },
  }
}

function updateLevelPresentation(delta: number) {
  frameCallback = null
  LevelSystem()
  const callback = takeFrameCallback()
  expect(callback).not.toBeNull()
  callback?.({}, delta)
}

afterEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {} as Record<AnyNodeId, AnyNode> })
})

describe('updateLevelPresentation', () => {
  test('writes offset positions to the registry transform used by floorplan and selection', () => {
    const { objects } = setupLevels([0, 1.25, 0])
    setLevelMode('stacked')

    updateLevelPresentation(1 / 12)

    expect(objects.map((object) => object.position.y)).toEqual([0, 3.75, 6.25])
  })

  test('keeps offset-aware positions in exploded and solo modes', () => {
    const { levels, objects } = setupLevels([1, 0.5])

    setLevelMode('exploded')
    updateLevelPresentation(1 / 12)
    expect(objects.map((object) => object.position.y)).toEqual([1, 9])

    objects.forEach((object) => {
      object.position.y = -100
    })
    setLevelMode('solo', levels[1]!.id)
    updateLevelPresentation(1 / 12)
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
