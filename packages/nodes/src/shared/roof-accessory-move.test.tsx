import { expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  emitter,
  getRoofSegmentSurfaceY,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getActiveSnapContext, useEditor } from '@pascal-app/editor'
import { generateRoofSegmentGeometry, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import type { ComponentType } from 'react'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { builtinPlugin } from '../index'

function coveringPoint(segment: RoofSegmentNode, x: number): [number, number, number] {
  // Pointer events hit the finished native covering, not the bare structural
  // datum. Moving accessories are transient, so their cutters are not rendered.
  const geometry = generateRoofSegmentGeometry(segment)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(
    geometry,
    Array.from({ length: 8 }, () => material),
  )
  mesh.updateMatrixWorld(true)
  try {
    const hit = new Raycaster(new Vector3(x, 100, 1), new Vector3(0, -1, 0))
      .intersectObject(mesh)
      .find((entry) => entry.face?.materialIndex === 3 && entry.face.normal.y > 0)
    if (!hit) throw new Error('Expected a native gable covering at the drag cursor')
    expect(hit.point.y).toBeGreaterThan(getRoofSegmentSurfaceY(segment, x, 1))
    return hit.point.toArray()
  } finally {
    geometry.dispose()
    material.dispose()
  }
}

installMountedScene()
for (const kind of [
  'box-vent',
  'cupola',
  'eyebrow-vent',
  'gutter',
  'ridge-vent',
  'skylight',
  'solar-panel',
  'turbine-vent',
]) {
  for (const mode of ['off', 'grid', 'force'] as const) {
    test(`${kind} ${mode} move preserves metadata and follows snapping mode`, async () => {
      const level = LevelNode.parse({})
      const roof = RoofNode.parse({ parentId: level.id })
      const segment = RoofSegmentNode.parse({
        parentId: roof.id,
        roofType: 'gable',
        width: 12,
        depth: 10,
      })
      const def = builtinPlugin.nodes!.find((entry) => entry.kind === kind)!
      const metadata = { assetId: 'asset-42', provenance: { source: 'survey' }, isTransient: true }
      const node = def.schema.parse({
        ...def.defaults(),
        parentId: segment.id,
        roofSegmentId: segment.id,
        position: [0, getRoofSegmentSurfaceY(segment, 0, 1), 1],
        metadata,
      }) as AnyNode
      const entries: AnyNode[] = [
        { ...level, children: [roof.id] },
        { ...roof, children: [segment.id] },
        { ...segment, children: [node.id] },
        node,
      ]
      useScene.setState({
        nodes: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
        rootNodeIds: [level.id],
        readOnly: false,
        dirtyNodes: new Set(),
      })
      for (const entry of entries) sceneRegistry.nodes.set(entry.id, new Group())
      useViewer.getState().setSelection({ levelId: level.id, selectedIds: [node.id] })
      useEditor.getState().setMovingNode(node)
      useEditor.getState().setSnappingMode('item', mode === 'off' ? 'off' : 'grid')
      useEditor.setState({ gridSnapStep: 0.5 })
      clearSceneHistory()
      const { default: Component } = await def.affordanceTools!.move!()
      const Tool = Component as ComponentType<{ node: AnyNode }>
      const renderer = await mount(<Tool node={node} />)
      expect(getActiveSnapContext()).toBe('item')
      const roofEvent = (x: number) => ({
        node: useScene.getState().nodes[roof.id],
        position: coveringPoint(segment, x),
        nativeEvent: { timeStamp: x, shiftKey: true, altKey: mode === 'force' },
        stopPropagation() {},
      })
      await act(async () => {
        emitter.emit('roof:enter', roofEvent(0) as never)
        emitter.emit('roof:move', roofEvent(0.73) as never)
        emitter.emit('roof:click', roofEvent(0.73) as never)
      })
      expect(
        (useScene.getState().nodes[node.id] as { position: number[] }).position[0],
      ).toBeCloseTo(mode === 'grid' ? 0.5 : 0.73)
      expect(useScene.getState().nodes[node.id]?.metadata).toEqual({
        assetId: 'asset-42',
        provenance: { source: 'survey' },
      })
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await renderer.unmount()
      await act(async () => useScene.temporal.getState().undo())
      expect(useScene.getState().nodes[node.id]?.metadata).toEqual(metadata)
    })
  }
}
