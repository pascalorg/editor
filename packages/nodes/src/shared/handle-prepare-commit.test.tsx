import { beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  ColumnNode,
  clearSceneHistory,
  createSceneApi,
  getSceneHistoryPauseDepth,
  LevelNode,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { NodeArrowHandles, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, SceneSystems, settle } from '../__tests__/harness'

installMountedScene()
beforeEach(() => {
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})
type Route = 'height' | 'radius' | 'rotation'
let camera: Camera
function CameraSetup() {
  const three = useThree()
  camera = three.camera
  useMemo(() => {
    camera.position.set(7, 12, 10)
    camera.lookAt(0, 1.5, 0)
    camera.updateMatrixWorld()
    three.gl.domElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
  }, [three])
  return null
}
function client(point: Vector3) {
  const p = point.clone().project(camera)
  return { clientX: (p.x + 1) * 500, clientY: (1 - p.y) * 500 }
}
async function pointer(type: string, point: Vector3) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        pointerId: 1,
        altKey: true,
        shiftKey: false,
        ...client(point),
      }),
    )
  })
}
async function seed(route: Route, prepared: boolean) {
  const building = BuildingNode.parse({ id: 'building_prepare', children: ['level_prepare'] })
  const level = LevelNode.parse({
    id: 'level_prepare',
    parentId: building.id,
    children: ['column_prepare'],
  })
  const column = ColumnNode.parse({
    id: 'column_prepare',
    parentId: level.id,
    height: 3,
    radius: 0.25,
    rotation: 0,
    crossSection: 'round',
    position: [0, 0, 0],
  })
  const control = { allow: false, prepares: 0, commits: 0 }
  const preparations: { isTracking: boolean; node: ColumnNode | undefined; pastStates: number }[] =
    []
  const definition = nodeRegistry.get('column')!
  const nativeHandles = definition.handles!
  const matches = (entry: { kind: string; axis?: string }) =>
    route === 'rotation'
      ? entry.kind === 'arc-resize'
      : route === 'radius'
        ? entry.kind === 'radial-resize'
        : entry.kind === 'linear-resize' && entry.axis === 'y'
  // The harness registered a fresh definition copy. Only its new public hook is controlled;
  // native descriptor geometry/apply, renderer, pointer session and writer remain real.
  if (prepared)
    definition.handles = (node, api) => {
      const handles = typeof nativeHandles === 'function' ? nativeHandles(node, api) : nativeHandles
      return handles.map((handle) => {
        if (
          !matches(handle) ||
          !['linear-resize', 'radial-resize', 'arc-resize'].includes(handle.kind)
        )
          return handle
        return {
          ...handle,
          prepareCommit: (
            initial: ColumnNode,
            patch: Partial<ColumnNode>,
            sceneApi: ReturnType<typeof createSceneApi>,
          ) => {
            control.prepares++
            // Native handles use temporal.pause(), not the separate counted-pause API.
            // Record inside the event; assert outside it so failures cannot escape EventTarget.
            preparations.push({
              isTracking: useScene.temporal.getState().isTracking,
              node: structuredClone(sceneApi.get<ColumnNode>(initial.id)),
              pastStates: useScene.temporal.getState().pastStates.length,
            })
            if (!control.allow) return null
            return () => {
              control.commits++
              sceneApi.update(initial.id, patch)
              sceneApi.update(initial.id, { name: 'Prepared column' })
            }
          },
        }
      })
    }
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [column.id]: column },
    rootNodeIds: [building.id],
    dirtyNodes: new Set([column.id]),
    readOnly: false,
  })
  useEditor.setState({ mode: 'select', tool: null, gridSnapStep: 0.05 })
  for (const kind of ['item', 'polygon', 'rotation'] as const)
    useEditor.getState().setSnappingMode(kind, 'off')
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [column.id] })
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
  const handles =
    typeof definition.handles === 'function'
      ? definition.handles(column, createSceneApi(useScene))
      : definition.handles!
  const descriptor = handles.find(matches)!
  expect(descriptor).toBeDefined()
  return {
    renderer,
    route,
    column,
    descriptor,
    control,
    preparations,
    before: structuredClone(useScene.getState().nodes),
    selection: structuredClone(useViewer.getState().selection),
  }
}
async function preview(f: Awaited<ReturnType<typeof seed>>, delta: number) {
  const object = sceneRegistry.nodes.get(f.column.id)!
  object.updateWorldMatrix(true, false)
  const point = object.localToWorld(
    new Vector3(...f.descriptor.placement!.position(f.column, createSceneApi(useScene))),
  )
  const hit = f.renderer.scene
    .findAll((entry) => typeof entry.props.onPointerDown === 'function' && entry.props.userData)
    .sort(
      (a, b) =>
        a.instance.getWorldPosition(new Vector3()).distanceToSquared(point) -
        b.instance.getWorldPosition(new Vector3()).distanceToSquared(point),
    )[0]!
  expect(hit).toBeDefined()
  await f.renderer.fireEvent(hit, 'pointerDown', {
    object: hit.instance,
    point,
    button: 0,
    pointerId: 1,
    ...client(point),
    nativeEvent: {
      ...client(point),
      button: 0,
      pointerId: 1,
      altKey: true,
      shiftKey: false,
      stopPropagation() {},
      stopImmediatePropagation() {},
    },
    stopPropagation() {},
  })
  expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')
  const target =
    f.route === 'rotation'
      ? new Vector3(
          point.x * Math.cos(delta) + point.z * Math.sin(delta),
          point.y,
          -point.x * Math.sin(delta) + point.z * Math.cos(delta),
        )
      : point
          .clone()
          .add(f.route === 'height' ? new Vector3(0, delta, 0) : new Vector3(delta, 0, 0))
  await pointer('pointermove', target)
  await settle(f.renderer, 1)
  expect(useLiveNodeOverrides.getState().get(f.column.id)?.[f.route]).toBeCloseTo(
    f.column[f.route] + delta,
    5,
  )
  expect(useScene.getState().nodes).toEqual(f.before)
  return target
}
function released(f: Awaited<ReturnType<typeof seed>>) {
  expect(useLiveNodeOverrides.getState().get(f.column.id)).toBeUndefined()
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(getSceneHistoryPauseDepth()).toBe(0)
  expect(useScene.temporal.getState().isTracking).toBe(true)
  expect(useViewer.getState().selection).toEqual(f.selection)
}
for (const route of ['height', 'radius', 'rotation'] as const) {
  test(`mounted ${route} prepare refuses cleanly, then retries its prepared writer in one undo`, async () => {
    const f = await seed(route, true)
    const delta = route === 'height' ? 0.4 : 0.2
    let target = await preview(f, delta)
    expect(f.control.prepares).toBe(0)
    await pointer('pointerup', target)
    expect(f.control).toEqual({ allow: false, prepares: 1, commits: 0 })
    const pausedBeforeWrite = { isTracking: false, node: f.column, pastStates: 0 }
    expect(f.preparations).toEqual([pausedBeforeWrite])
    expect(useScene.getState().nodes).toEqual(f.before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(0)
    released(f)
    f.control.allow = true
    target = await preview(f, delta)
    expect(f.control.prepares).toBe(1)
    await pointer('pointerup', target)
    expect(f.control).toEqual({ allow: true, prepares: 2, commits: 1 })
    expect(f.preparations).toEqual([pausedBeforeWrite, pausedBeforeWrite])
    const changed = useScene.getState().nodes[f.column.id] as ColumnNode
    expect(changed[route]).toBeCloseTo(f.column[route] + delta, 5)
    expect(changed.name).toBe('Prepared column')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    released(f)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(f.before)
    await f.renderer.unmount()
  })
}
test('mounted ordinary column without prepare keeps its native writer and one undo', async () => {
  const f = await seed('height', false)
  const target = await preview(f, 0.4)
  await pointer('pointerup', target)
  expect((useScene.getState().nodes[f.column.id] as ColumnNode).height).toBeCloseTo(3.4, 5)
  expect(f.control.prepares).toBe(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  released(f)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(f.before)
  await f.renderer.unmount()
})
