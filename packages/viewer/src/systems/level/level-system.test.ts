// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, describe, expect, mock, test } from 'bun:test'

type FakeLevelObject = {
  position: { y: number }
  visible: boolean
}

type FakeLevelNode = {
  id: string
  type: 'level'
  parentId: string
  level: number
  baseElevation: number
  children: []
}

type FakeBuildingNode = {
  id: string
  type: 'building'
  children: string[]
}

const levelIds = new Set<string>()
const registryNodes = new Map<string, FakeLevelObject>()
const sceneRegistry = {
  byType: { level: levelIds },
  nodes: registryNodes,
}
let nodes: Record<string, FakeLevelNode | FakeBuildingNode> = {}
let viewerState = {
  levelMode: 'stacked' as 'stacked' | 'exploded' | 'solo',
  selection: { levelId: null as string | null },
}
let frameCallback: ((state: unknown, delta: number) => void) | null = null

mock.module('@pascal-app/core', () => ({
  getLevelHeight: (levelId: string) => (nodes[levelId]?.type === 'level' ? 2.5 : 0),
  sceneRegistry,
  useScene: {
    getState: () => ({ nodes }),
  },
}))

mock.module('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    frameCallback = callback
  },
}))

mock.module('three/src/math/MathUtils.js', () => ({
  lerp: (start: number, end: number, alpha: number) => start + (end - start) * alpha,
}))

mock.module('../../store/use-viewer', () => ({
  default: {
    getState: () => viewerState,
  },
}))

const [{ LevelSystem }, { snapLevelsToTruePositions }] = await Promise.all([
  import('./level-system'),
  import('./level-utils'),
])

function setupLevels(baseElevations: number[]) {
  const buildingId = 'building_base-elevation-system-test'
  const levels: FakeLevelNode[] = baseElevations.map((baseElevation, level) => ({
    id: `level_base-elevation-system-${level}`,
    type: 'level',
    parentId: buildingId,
    level,
    baseElevation,
    children: [],
  }))
  const building: FakeBuildingNode = {
    id: buildingId,
    type: 'building',
    children: levels.map((level) => level.id),
  }
  nodes = Object.fromEntries([building, ...levels].map((node) => [node.id, node]))

  const objects = levels.map((level) => {
    const object: FakeLevelObject = {
      position: { y: -100 },
      visible: true,
    }
    sceneRegistry.nodes.set(level.id, object)
    sceneRegistry.byType.level.add(level.id)
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
  expect(frameCallback).not.toBeNull()
  frameCallback?.({}, delta)
}

afterEach(() => {
  sceneRegistry.nodes.clear()
  sceneRegistry.byType.level.clear()
  nodes = {}
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
