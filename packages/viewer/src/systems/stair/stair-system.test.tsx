import { afterEach, expect, test } from 'bun:test'
import {
  StairNode,
  StairSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { BufferGeometry, Group, Mesh } from 'three'
import { StairSystem } from './stair-system'

const initialScene = useScene.getState()

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.clear()
  useScene.setState({
    nodes: initialScene.nodes,
    rootNodeIds: initialScene.rootNodeIds,
    dirtyNodes: initialScene.dirtyNodes,
  })
})

test('rebuilds the visible stair body from a live snapped flight', async () => {
  const segment = StairSegmentNode.parse({
    id: 'sseg_live_body',
    parentId: 'stair_live_body',
    height: 0.35,
    length: 0.84,
    stepCount: 2,
  })
  const stair = StairNode.parse({
    id: 'stair_live_body',
    children: [segment.id],
    totalRise: 0.35,
    stepCount: 2,
  })
  const group = new Group()
  const body = new Mesh(new BufferGeometry())
  body.name = 'merged-stair'
  group.add(body)
  sceneRegistry.nodes.set(stair.id, group)
  sceneRegistry.nodes.set(segment.id, new Mesh(new BufferGeometry()))
  useScene.setState({
    nodes: { [stair.id]: stair, [segment.id]: segment },
    rootNodeIds: [stair.id],
    dirtyNodes: new Set([stair.id, segment.id]),
  } as never)

  const renderer = await ReactThreeTestRenderer.create(<StairSystem />)
  await renderer.advanceFrames(1, 1 / 60)
  body.geometry.computeBoundingBox()
  const original = body.geometry.boundingBox!.clone()

  useLiveNodeOverrides.getState().set(segment.id, { height: 1.2, length: 2.24, stepCount: 8 })
  useScene.getState().markDirty(segment.id)
  useScene.getState().markDirty(stair.id)
  await renderer.advanceFrames(1, 1 / 60)
  body.geometry.computeBoundingBox()
  expect(body.geometry.boundingBox!.max.y).toBeGreaterThan(original.max.y + 0.8)
  expect(body.geometry.boundingBox!.max.z).toBeGreaterThan(original.max.z + 1)
  await renderer.unmount()
})
