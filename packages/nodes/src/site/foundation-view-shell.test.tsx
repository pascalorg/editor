import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FootingNode,
  LevelNode,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Group } from 'three'
import { FoundationViewShell } from './foundation-view-shell'

const wall = WallNode.parse({ id: 'wall_a', parentId: 'level_g', start: [0, 0], end: [4, 0] })
const hiddenWall = WallNode.parse({
  id: 'wall_b',
  parentId: 'level_g',
  start: [4, 0],
  end: [4, 3],
  visible: false,
})
const footing = FootingNode.parse({
  id: 'footing_a',
  parentId: 'level_g',
  start: [0, 1],
  end: [4, 1],
})
const nodes: AnyNode[] = [
  BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
  LevelNode.parse({
    id: 'level_g',
    parentId: 'building_a',
    level: 0,
    children: ['wall_a', 'wall_b', 'footing_a'],
  }),
  wall,
  hiddenWall,
  footing,
]
const objects = new Map(['level_g', 'wall_a', 'wall_b', 'footing_a'].map((id) => [id, new Group()]))

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
  for (const [id, object] of objects) {
    object.visible = id !== 'wall_b'
    sceneRegistry.nodes.set(id, object)
  }
  useViewer
    .getState()
    .setSelection({ buildingId: 'building_a' as never, levelId: 'level_g' as never })
})
afterEach(() => {
  for (const id of objects.keys()) sceneRegistry.nodes.delete(id)
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
})

const shown = () => Object.fromEntries([...objects].map(([id, object]) => [id, object.visible]))

test('the foundation view hides the house, keeps the level and its footings, and gives each object back its own visibility', async () => {
  const renderer = await create(<FoundationViewShell />)
  // The state lands (and the hider mounts) before the frames run.
  const settle = async (state: Partial<ReturnType<typeof useViewer.getState>>) => {
    await act(async () => useViewer.setState(state))
    await act(async () => renderer.advanceFrames(2, 0.05))
  }

  await settle({ foundationView: true, walkthroughMode: false })
  expect(shown()).toEqual({ level_g: true, wall_a: false, wall_b: false, footing_a: true })

  // The walkthrough walks through the finished house.
  await settle({ walkthroughMode: true })
  expect(shown()).toEqual({ level_g: true, wall_a: true, wall_b: false, footing_a: true })

  await settle({ walkthroughMode: false })
  expect(shown().wall_a).toBe(false)
  await settle({ foundationView: false })
  expect(shown()).toEqual({ level_g: true, wall_a: true, wall_b: false, footing_a: true })
  await renderer.unmount()
})
