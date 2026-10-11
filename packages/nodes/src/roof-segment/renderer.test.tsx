import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { RoofSystem } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh } from 'three'
import RoofSegmentRenderer from './renderer'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

let oldNodes: ReturnType<typeof useScene.getState>['nodes']
beforeEach(() => {
  oldNodes = useScene.getState().nodes
})
afterEach(() => {
  useScene.setState({ nodes: oldNodes })
})

test('a painted segment whose renderer mounts after the scene-load pass still builds, unknown preset included', async () => {
  const level = LevelNode.parse({ id: 'level_roof-paint', height: 3 })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_roof-paint',
    roofType: 'gable',
    width: 8,
    depth: 6,
    pitch: 28,
    materialPreset: 'asphalt-shingle-grey',
    topMaterial: { properties: { color: '#5d6164' } },
    parentId: 'roof_roof-paint',
  })
  const roof = RoofNode.parse({
    id: 'roof_roof-paint',
    materialPreset: 'asphalt-shingle-grey',
    children: [segment.id],
    parentId: level.id,
  })
  useScene.setState({
    nodes: { [level.id]: level, [roof.id]: roof, [segment.id]: segment } as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [level.id],
  })
  useScene.getState().markDirty(segment.id)

  // The roof system consumes the load-time dirty mark before the lazily
  // loaded segment renderer has registered its mesh.
  const renderer = await create(<RoofSystem />)
  try {
    await renderer.advanceFrames(2, 1 / 60)
    await act(async () => {
      await renderer.update(
        <>
          <RoofSystem />
          <RoofSegmentRenderer node={segment} />
        </>,
      )
    })
    await renderer.advanceFrames(2, 1 / 60)
    const mesh = sceneRegistry.nodes.get(segment.id) as Mesh
    expect(mesh.geometry.userData.placeholder).toBeUndefined()
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(3)
  } finally {
    await renderer.unmount()
  }
})
