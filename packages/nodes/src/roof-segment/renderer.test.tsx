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

test('a failed roof rebuild keeps the last valid mesh and recovers after retry', async () => {
  const { nodeRegistry, registerNode, SkylightNode } = await import('@pascal-app/core')
  const { useGeometryStatus } = await import('@pascal-app/viewer')
  const previous = useScene.getState()
  const restoreRegistry = nodeRegistry._snapshot()
  let fail = false
  registerNode({
    kind: 'skylight',
    schemaVersion: 1,
    schema: SkylightNode,
    capabilities: {
      roofAccessory: {
        buildCut: () => {
          if (fail) throw new Error('Cut geometry unavailable')
          return null
        },
      },
    },
  })
  const roof = RoofNode.parse({ id: 'roof_recovery', children: ['rseg_recovery'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_recovery',
    parentId: roof.id,
    children: ['skylight_recovery'],
  })
  const skylight = SkylightNode.parse({
    id: 'skylight_recovery',
    parentId: segment.id,
    roofSegmentId: segment.id,
  })
  useScene.setState({
    nodes: { [roof.id]: roof, [segment.id]: segment, [skylight.id]: skylight },
    rootNodeIds: [roof.id],
    dirtyNodes: new Set([segment.id]),
  })
  const renderer = await create(
    <>
      <RoofSystem />
      <RoofSegmentRenderer node={segment} />
    </>,
  )
  try {
    await renderer.advanceFrames(2, 1 / 60)
    const mesh = sceneRegistry.nodes.get(segment.id) as Mesh
    const validGeometry = mesh.geometry
    expect(validGeometry.getAttribute('position').count).toBeGreaterThan(3)
    const stored = useScene.getState().nodes[segment.id]
    fail = true
    useScene.getState().markDirty(segment.id)
    await renderer.advanceFrames(1, 1 / 60)
    expect(mesh.geometry).toBe(validGeometry)
    expect(useGeometryStatus.getState().failures.has(segment.id)).toBe(true)
    expect(useScene.getState().nodes[segment.id]).toBe(stored)
    fail = false
    useScene.getState().markDirty(segment.id)
    await renderer.advanceFrames(1, 1 / 60)
    expect(mesh.geometry).not.toBe(validGeometry)
    expect(useGeometryStatus.getState().failures.has(segment.id)).toBe(false)
  } finally {
    await renderer.unmount()
    restoreRegistry()
    useScene.setState(previous)
  }
})
