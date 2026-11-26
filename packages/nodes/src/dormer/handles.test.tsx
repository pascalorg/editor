import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createDormerDefaultWindow,
  DormerNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  cancelActiveTool,
  NodeArrowHandles,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, SceneSystems, settle } from '../__tests__/harness'
import { dormerEditContribution } from './definition.edit'

installMountedScene()
beforeEach(() => {
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})
let camera: Camera
function CameraSetup() {
  const three = useThree()
  camera = three.camera
  useMemo(() => {
    camera.position.set(7, 12, 10)
    camera.lookAt(0, 4, 2)
    camera.updateMatrixWorld()
    three.gl.domElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
  }, [three])
  return null
}
function client(point: Vector3) {
  const projected = point.clone().project(camera)
  return { clientX: (projected.x + 1) * 500, clientY: (1 - projected.y) * 500 }
}
async function pointer(type: string, point: Vector3) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        pointerId: 1,
        shiftKey: false,
        altKey: false,
        ...client(point),
      }),
    )
  })
}
async function seed(nearRidge = false, nearEave = false) {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    children: ['dormer_d'],
  })
  const dormer = DormerNode.parse({
    id: 'dormer_d',
    parentId: segment.id,
    roofSegmentId: segment.id,
    position: [0, 4.123, nearEave ? 3.4 : nearRidge ? 0.6 : 2],
    rotation: nearEave ? 0 : nearRidge ? Math.PI / 2 : 0.37,
    width: nearRidge ? 0.8 : 1.4,
    depth: nearEave ? 0.8 : nearRidge ? 2 : 1.8,
    height: 0.6,
    children: ['window_w'],
  })
  // Deliberately buried existing child: geometric editing is NOT a new exposure gate.
  const window = {
    ...createDormerDefaultWindow(dormer, 'window_w'),
    position: [0.1, -2, 0] as [number, number, number],
  }
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment, dormer, window].map((node) => [node.id, node]),
  )
  useScene.setState({
    nodes,
    rootNodeIds: [building.id],
    dirtyNodes: new Set([segment.id, window.id]),
    readOnly: false,
  })
  useEditor.setState({ mode: 'select', tool: null, gridSnapStep: 0.05 })
  useEditor.getState().setSnappingMode('item', 'off')
  useEditor.getState().setSnappingMode('polygon', 'off')
  useEditor.getState().setSnappingMode('rotation', 'off')
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [dormer.id] })
  const renderer = await mount(
    <>
      <CameraSetup />
      <LevelScene building={building} level={level} />
      <NodeArrowHandles />
      <SceneSystems />
    </>,
  )
  await settle(renderer, 5)
  clearSceneHistory()
  return { renderer, dormer, window, before: structuredClone(useScene.getState().nodes) }
}
async function press(f: Awaited<ReturnType<typeof seed>>, kind: 'width' | 'depth' | 'rotation') {
  // Use native public descriptor placement ONLY to locate the real rendered hit
  // target. Expected post-drag edge geometry is calculated independently below.
  const handlesForNode = dormerEditContribution.handles!
  const descriptors =
    typeof handlesForNode === 'function' ? handlesForNode(f.dormer) : handlesForNode
  const descriptor = descriptors.find((entry) =>
    kind === 'rotation'
      ? entry.kind === 'arc-resize'
      : entry.kind === 'linear-resize' &&
        entry.axis === (kind === 'width' ? 'x' : 'z') &&
        entry.anchor === 'min',
  )!
  const position = descriptor.placement?.position
  if (typeof position !== 'function')
    throw new Error('Native dormer handle lacks its routed placement')
  const object = sceneRegistry.nodes.get(f.dormer.id)!
  object.updateWorldMatrix(true, false)
  const point = object.localToWorld(new Vector3(...position(f.dormer)))
  const handles = f.renderer.scene.findAll(
    (entry) => typeof entry.props.onPointerDown === 'function' && entry.props.userData,
  )
  const hit = handles.sort(
    (a, b) =>
      a.instance.getWorldPosition(new Vector3()).distanceToSquared(point) -
      b.instance.getWorldPosition(new Vector3()).distanceToSquared(point),
  )[0]
  expect(hit).toBeDefined()
  await f.renderer.fireEvent(hit!, 'pointerDown', {
    object: hit!.instance,
    point,
    button: 0,
    pointerId: 1,
    ...client(point),
    nativeEvent: {
      ...client(point),
      button: 0,
      pointerId: 1,
      shiftKey: false,
      altKey: false,
      stopPropagation() {},
      stopImmediatePropagation() {},
    },
    stopPropagation() {},
  })
  expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')
  return point
}

for (const axis of ['width', 'depth'] as const) {
  for (const ending of ['commit', 'cancel', 'invalid'] as const) {
    test(`real anchored ${axis} handle ${ending}: transient preview and preserved opposite edge/Y`, async () => {
      const f = await seed(
        ending === 'invalid' && axis === 'width',
        ending === 'invalid' && axis === 'depth',
      )
      const start = await press(f, axis)
      const growth = ending === 'invalid' ? 1 : 0.6
      const arm =
        axis === 'width'
          ? new Vector3(Math.cos(f.dormer.rotation), 0, -Math.sin(f.dormer.rotation))
          : new Vector3(Math.sin(f.dormer.rotation), 0, Math.cos(f.dormer.rotation))
      const target = start.clone().add(arm.multiplyScalar(growth))
      await pointer('pointermove', target)
      await settle(f.renderer, 1)
      if (ending !== 'invalid') {
        expect(useLiveNodeOverrides.getState().get(f.dormer.id)?.[axis]).toBeCloseTo(
          f.dormer[axis] + growth,
          5,
        )
      }
      expect(useScene.getState().nodes).toEqual(f.before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      if (ending === 'cancel') await act(async () => void cancelActiveTool())
      else await pointer('pointerup', target)
      if (ending !== 'commit') {
        expect(useScene.getState().nodes).toEqual(f.before)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      } else {
        const changed = useScene.getState().nodes[f.dormer.id] as DormerNode
        expect(changed[axis]).toBeCloseTo(f.dormer[axis] + growth, 5)
        expect(changed.position[1]).toBe(4.123)
        expect(changed.rotation).toBe(0.37)
        const fixedEdge = (node: DormerNode) =>
          axis === 'width'
            ? [
                node.position[0] - (Math.cos(node.rotation) * node.width) / 2,
                node.position[2] + (Math.sin(node.rotation) * node.width) / 2,
              ]
            : [
                node.position[0] - (Math.sin(node.rotation) * node.depth) / 2,
                node.position[2] - (Math.cos(node.rotation) * node.depth) / 2,
              ]
        fixedEdge(changed).forEach((value, i) => {
          expect(value).toBeCloseTo(fixedEdge(f.dormer)[i]!, 6)
        })
        expect(useScene.getState().nodes[f.window.id]).toEqual(f.window)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        useScene.temporal.getState().undo()
        expect(useScene.getState().nodes).toEqual(f.before)
      }
      expect(useLiveNodeOverrides.getState().get(f.dormer.id)).toBeUndefined()
      await f.renderer.unmount()
    })
  }
}

for (const invalid of [false, true]) {
  test(`real rotation handle ${invalid ? 'refuses a newly crossed ridge' : 'keeps existing Y and dimensions without exposure gating'}`, async () => {
    const f = await seed(invalid)
    const start = await press(f, 'rotation')
    const delta = invalid ? Math.PI / 2 : 0.25
    const rx = start.x - f.dormer.position[0],
      rz = start.z - f.dormer.position[2]
    const target = new Vector3(
      f.dormer.position[0] + rx * Math.cos(delta) + rz * Math.sin(delta),
      start.y,
      f.dormer.position[2] - rx * Math.sin(delta) + rz * Math.cos(delta),
    )
    await pointer('pointermove', target)
    await settle(f.renderer, 1)
    if (!invalid) {
      expect(useLiveNodeOverrides.getState().get(f.dormer.id)?.rotation).toBeCloseTo(0.62, 5)
    }
    expect(useScene.getState().nodes).toEqual(f.before)
    await pointer('pointerup', target)
    if (invalid) {
      expect(useScene.getState().nodes).toEqual(f.before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } else {
      const changed = useScene.getState().nodes[f.dormer.id] as DormerNode
      expect(changed.rotation).toBeCloseTo(0.62, 5)
      expect(changed.position).toEqual(f.dormer.position)
      expect(changed).toMatchObject({ width: 1.4, depth: 1.8, height: 0.6 })
      expect(useScene.getState().nodes[f.window.id]).toEqual(f.window)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(f.before)
    }
    await f.renderer.unmount()
  })
}
