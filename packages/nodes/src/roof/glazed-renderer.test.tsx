import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  loadPlugin,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { builtinPlugin, glazedRoofGeometryAdapter } from '@pascal-app/nodes'
import { getPendingRoofMergeCount, RoofSystem } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh } from 'three'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}
const original = useScene.getState()
afterEach(() => {
  useScene.setState(original)
})

for (const roofType of ['gable', 'barrel'] as const)
  test(`${roofType} renders glazed segments separately and restores standard construction`, async () => {
    await loadPlugin(builtinPlugin)
    const segmentLoader = nodeRegistry.get('roof-segment')!.renderer!
    if (segmentLoader.kind !== 'parametric')
      throw new Error('Roof segment must expose its renderer')
    await segmentLoader.module()
    const definition = nodeRegistry.get('roof')!
    const loader = definition.renderer!
    if (loader.kind !== 'parametric') throw new Error('Roof must expose its registered renderer')
    const { default: Renderer } = await loader.module()
    const roof = RoofNode.parse({ id: 'roof_glazed-render', children: ['rseg_glazed-render'] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_glazed-render',
      parentId: roof.id,
      roofType,
      roofSystem: 'glazed',
    })
    useScene.setState({
      nodes: { [roof.id]: roof, [segment.id]: segment } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [roof.id],
    })
    const renderer = await create(
      <>
        <RoofSystem geometryAdapter={glazedRoofGeometryAdapter} />
        <Renderer node={roof} />
      </>,
    )
    try {
      await act(async () => {
        await renderer.advanceFrames(6, 1 / 60)
      })
      const mesh = sceneRegistry.nodes.get(segment.id) as Mesh
      expect(mesh).toBeDefined()
      expect(mesh.parent?.name).toBe('painted-segments')
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(3)
      expect(mesh.geometry.groups.some((group) => group.materialIndex === 1)).toBe(true)
      expect((Array.isArray(mesh.material) ? mesh.material[1] : undefined)?.transparent).toBe(true)
      await act(async () => {
        useScene.getState().updateNode(segment.id, { roofSystem: 'standard' })
        useScene.getState().markDirty(segment.id)
      })
      await act(async () => {
        await renderer.advanceFrames(6, 1 / 60)
      })
      const standard = sceneRegistry.nodes.get(segment.id) as Mesh
      expect(standard.parent?.name).toBe(
        roofType === 'barrel' ? 'painted-segments' : 'segments-wrapper',
      )
      const merged = sceneRegistry.nodes.get(roof.id)!.getObjectByName('merged-roof') as Mesh
      if (roofType === 'barrel')
        expect(standard.geometry.groups.some((group) => group.materialIndex === 3)).toBe(true)
      else expect(merged.geometry.getAttribute('position').count).toBeGreaterThan(3)
    } finally {
      await renderer.unmount()
    }
  })

test('glazed roof rebuilds drain the shared frame budget before capture', async () => {
  await loadPlugin(builtinPlugin)
  const loader = nodeRegistry.get('roof')!.renderer!
  if (loader.kind !== 'parametric') throw new Error('Roof must expose its registered renderer')
  const { default: Renderer } = await loader.module()
  const roof = RoofNode.parse({ id: 'roof_glazed-budget' })
  const segments = Array.from({ length: 5 }, (_, index) =>
    RoofSegmentNode.parse({
      parentId: roof.id,
      roofType: 'gable',
      roofSystem: 'glazed',
      position: [index * 10, 0, 0],
    }),
  )
  roof.children = segments.map((segment) => segment.id)
  useScene.setState({
    nodes: Object.fromEntries([roof, ...segments].map((node) => [node.id, node])) as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [roof.id],
  })
  const renderer = await create(
    <>
      <RoofSystem geometryAdapter={glazedRoofGeometryAdapter} />
      <Renderer node={roof} />
    </>,
  )
  try {
    await act(async () => {
      await renderer.advanceFrames(12, 1 / 60)
    })
    expect(getPendingRoofMergeCount()).toBe(0)
    for (const segment of segments)
      expect(
        (sceneRegistry.nodes.get(segment.id) as Mesh).geometry.getAttribute('position').count,
      ).toBeGreaterThan(3)
    await act(async () => {
      useScene.getState().updateNode(roof.id, { position: [1, 0, 0] })
      useScene.getState().markDirty(roof.id)
    })
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60)
    })
    expect(getPendingRoofMergeCount()).toBeGreaterThan(0)
    await act(async () => {
      await renderer.advanceFrames(12, 1 / 60)
    })
    expect(getPendingRoofMergeCount()).toBe(0)
  } finally {
    await renderer.unmount()
  }
})
