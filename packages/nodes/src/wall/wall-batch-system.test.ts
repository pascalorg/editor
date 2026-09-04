import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import type { useFrame } from '@react-three/fiber'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three'
import {
  collectTintedWalls,
  collectWallBatchCandidates,
  holdBatchedWallsAfterCapture,
  revealBatchedWallsForCapture,
  WallBatchSystem,
} from './wall-batch-system'
import { revealAllBatchedHolds } from '../shared/node-batch/candidates'

type FrameCallback = Parameters<typeof useFrame>[0]
let frameCallback: FrameCallback | null = null
let nowMs = 0
const fiber = await import('@react-three/fiber')

mock.module('@react-three/fiber', () => ({
  ...fiber,
  useFrame: (callback: FrameCallback) => {
    frameCallback = callback
  },
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate: () => undefined }),
}))

const performanceNow = spyOn(performance, 'now').mockImplementation(() => nowMs)

const registeredIds: string[] = []

afterEach(() => {
  useViewer.setState({ wallMode: 'down' } as never)
  frameCallback?.({} as never, 0)
  for (const id of registeredIds.splice(0)) {
    const object = sceneRegistry.nodes.get(id)
    if (!(object instanceof Mesh)) continue
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material?.dispose()
  }
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  useViewer.setState({ hoverHighlightMode: 'default', hoveredId: null, wallMode: 'up' } as never)
  frameCallback = null
})

afterAll(() => {
  performanceNow.mockRestore()
})

function registerWall(id: string, material: Material = new MeshBasicMaterial()) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  const mesh = new Mesh(geometry, [material])
  sceneRegistry.nodes.set(id, mesh)
  sceneRegistry.byType.wall.add(id)
  registeredIds.push(id)
  return mesh
}

function takeFrameCallback(): FrameCallback {
  const callback = frameCallback
  if (!callback) throw new Error('frame callback expected')
  return callback
}

function setupBatchedLevel(count = 8) {
  const root = new Object3D()
  const material = new MeshBasicMaterial()
  const wallIds = Array.from({ length: count }, (_, index) => `wall_${index}`)
  const walls = wallIds.map((id) => registerWall(id, material))
  for (const wall of walls) root.add(wall)
  sceneRegistry.nodes.set('level', root)
  sceneRegistry.byType.level.add('level')
  registeredIds.push('level')

  useScene.setState({
    nodes: {
      level: { id: 'level', type: 'level', children: wallIds },
      ...Object.fromEntries(
        wallIds.map((id) => [id, { id, type: 'wall', parentId: 'level', visible: true }]),
      ),
    },
    rootNodeIds: ['level'],
    dirtyNodes: new Set(),
  } as never)
  const selection = useViewer.getState().selection
  useViewer.setState({
    wallMode: 'cutaway',
    selection: { ...selection, selectedIds: new Set() },
    previewSelectedIds: new Set(),
    hoveredId: null,
  } as never)

  frameCallback = null
  renderToString(createElement(WallBatchSystem))
  const runFrame = takeFrameCallback()
  nowMs = 0
  runFrame({} as never, 0)
  nowMs = 181
  runFrame({} as never, 0)

  const batch = root.children.find((child) => child.name === 'wall-batch') as Mesh | undefined
  if (!batch) throw new Error('wall batch expected')
  return { batch, root, runFrame, walls }
}

describe('collectWallBatchCandidates', () => {
  test('keeps tinted walls out when a stale level is re-sewn', () => {
    const wallIds = Array.from({ length: 10 }, (_, index) => `wall_${index}`)
    for (const id of wallIds) registerWall(id)

    useScene.setState({
      nodes: {
        level: { id: 'level', type: 'level', children: wallIds },
        ...Object.fromEntries(
          wallIds.map((id) => [id, { id, type: 'wall', parentId: 'level', visible: true }]),
        ),
      },
      rootNodeIds: ['level'],
    } as never)

    const tinted = new Set(wallIds.slice(0, 8))
    const candidates = [...collectWallBatchCandidates('level', tinted).values()].flat()

    expect(candidates.map((candidate) => candidate.nodeId)).toEqual(wallIds.slice(8))
  })

  test('keeps walls stamped hidden out of a batch', () => {
    registerWall('wall_hidden')
    const mesh = sceneRegistry.nodes.get('wall_hidden') as Mesh
    mesh.userData.wallHidden = true

    useScene.setState({
      nodes: {
        level: { id: 'level', type: 'level', children: ['wall_hidden'] },
        wall_hidden: {
          id: 'wall_hidden',
          type: 'wall',
          parentId: 'level',
          visible: true,
        },
      },
      rootNodeIds: ['level'],
    } as never)

    expect(collectWallBatchCandidates('level').size).toBe(0)
  })
})

describe('collectTintedWalls', () => {
  // Regression: hover feedback for a wall is an outline, and the outline node
  // renders through the main camera — which never sees a sewn wall. A hovered
  // wall has to leave its batch or hovering it lights up nothing, in select
  // mode and in paint mode alike.
  const wallIds = new Set(['wall_a', 'wall_b'])

  test.each([
    'default',
    'paint-ready',
    'paint-disabled',
    'delete',
  ])('a %s hover takes the wall out of its batch', (hoverHighlightMode) => {
    useViewer.setState({ hoverHighlightMode, hoveredId: 'wall_a' } as never)

    expect([...collectTintedWalls(wallIds)]).toEqual(['wall_a'])
  })

  test('a hover over a non-wall node tints nothing', () => {
    useViewer.setState({ hoverHighlightMode: 'default', hoveredId: 'slab_a' } as never)

    expect([...collectTintedWalls(wallIds)]).toEqual([])
  })
})

describe('WallBatchSystem cutaway releases', () => {
  test('releases a batched wall on the frame its wallHidden stamp appears', () => {
    const { batch, runFrame, walls } = setupBatchedLevel()
    const wall = walls[0]!
    wall.userData.wallHidden = true

    nowMs = 200
    runFrame({} as never, 0)

    expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(batch.geometry.groups[0]?.count).toBe(21)
  })

  test('does not count hidden walls toward the settled re-merge threshold', () => {
    const { batch, root, runFrame, walls } = setupBatchedLevel()
    for (const wall of walls) wall.userData.wallHidden = true

    nowMs = 200
    runFrame({} as never, 0)
    nowMs = 381
    runFrame({} as never, 0)

    expect(root.children.find((child) => child.name === 'wall-batch')).toBe(batch)
    expect(walls.every((wall) => wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
  })

  test('re-sews released walls that become visible before settlement', () => {
    const { batch, root, runFrame, walls } = setupBatchedLevel()
    for (const wall of walls) wall.userData.wallHidden = true

    nowMs = 200
    runFrame({} as never, 0)
    for (const wall of walls) wall.userData.wallHidden = false
    nowMs = 201
    runFrame({} as never, 0)
    nowMs = 381
    runFrame({} as never, 0)

    expect(root.children.find((child) => child.name === 'wall-batch')).not.toBe(batch)
    expect(walls.every((wall) => !wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
  })

  test('re-sews a settled level once its hidden walls become visible again', () => {
    const { root, runFrame, walls } = setupBatchedLevel()
    for (const wall of walls) wall.userData.wallHidden = true

    nowMs = 200
    runFrame({} as never, 0)
    nowMs = 381
    runFrame({} as never, 0)
    expect(walls.every((wall) => wall.layers.isEnabled(SCENE_LAYER))).toBe(true)

    for (const wall of walls) wall.userData.wallHidden = false
    nowMs = 400
    runFrame({} as never, 0)
    nowMs = 581
    runFrame({} as never, 0)

    expect(root.children.some((child) => child.name === 'wall-batch')).toBe(true)
    expect(walls.every((wall) => !wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
  })

  test('a hovered wall does not hold the settle window open', () => {
    const { root, runFrame, walls } = setupBatchedLevel(9)
    for (const wall of walls) wall.userData.wallHidden = true
    nowMs = 200
    runFrame({} as never, 0)
    for (const wall of walls) wall.userData.wallHidden = false
    useViewer.setState({ hoveredId: 'wall_0' } as never)

    nowMs = 400
    runFrame({} as never, 0)
    nowMs = 581
    runFrame({} as never, 0)
    nowMs = 762
    runFrame({} as never, 0)

    expect(root.children.some((child) => child.name === 'wall-batch')).toBe(true)
    expect(walls.slice(1).every((wall) => !wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
    expect(walls[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })
})

describe('WallBatchSystem capture holds', () => {
  test("the node batch's reveal sweep leaves batched walls held", () => {
    const { walls } = setupBatchedLevel()
    revealAllBatchedHolds()
    expect(walls.every((wall) => !wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
  })

  test('sources come back for a capture and go under again after it', () => {
    const { walls } = setupBatchedLevel()
    revealBatchedWallsForCapture()
    expect(walls.every((wall) => wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
    holdBatchedWallsAfterCapture()
    expect(walls.every((wall) => !wall.layers.isEnabled(SCENE_LAYER))).toBe(true)
  })
})
