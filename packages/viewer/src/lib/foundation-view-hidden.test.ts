// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  emitter,
  FootingNode,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { Object3D, Vector3 } from 'three'
import { useNodeEvents } from '../hooks/use-node-events'
import useViewer from '../store/use-viewer'
import { foundationViewBuildingId, hiddenByFoundationView } from './foundation-view-hidden'

const wall = WallNode.parse({ id: 'wall_a', parentId: 'level_g', start: [0, 0], end: [4, 0] })
const footing = FootingNode.parse({ id: 'footing_a', parentId: 'level_g' })
const NODES: AnyNode[] = [
  BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
  LevelNode.parse({
    id: 'level_g',
    parentId: 'building_a',
    level: 0,
    children: [wall.id, footing.id],
  }),
  wall,
  footing,
]

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
  useScene.setState({
    nodes: Object.fromEntries(NODES.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
  useViewer.getState().setSelection({ buildingId: null, levelId: 'level_g' as never })
  useViewer.getState().setFoundationView(true)
})
afterEach(() => {
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
})

/** A left-button press released on the wall's mesh, as R3F hands it to a node's handlers. */
const release = () =>
  ({
    button: 0,
    point: new Vector3(1, 1, 0),
    object: new Object3D(),
    face: null,
    stopPropagation: () => {},
  }) as never

test('the foundation view hides the house over the foundation, the footings not; off, nothing', () => {
  // The view is of the selected level's building.
  expect(foundationViewBuildingId()).toBe('building_a')
  expect(hiddenByFoundationView(wall.id)).toBe(true)
  expect(hiddenByFoundationView(footing.id)).toBe(false)
  useViewer.setState({ walkthroughMode: true })
  expect(hiddenByFoundationView(wall.id)).toBe(false)
  useViewer.setState({ walkthroughMode: false })
  useViewer.getState().setFoundationView(false)
  expect(hiddenByFoundationView(wall.id)).toBe(false)
})

test('a click on a wall the foundation view hides selects nothing; with the view off it does', () => {
  const clicks: string[] = []
  const onClick = (event: { node: AnyNode }) => clicks.push(event.node.id)
  emitter.on('wall:click', onClick as never)
  try {
    const handlers = useNodeEvents(wall, 'wall')
    handlers.onPointerUp(release())
    expect(clicks).toEqual([])
    useViewer.getState().setFoundationView(false)
    handlers.onPointerUp(release())
    expect(clicks).toEqual([wall.id])
  } finally {
    emitter.off('wall:click', onClick as never)
  }
})
