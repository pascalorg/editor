import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  DuctFittingNode,
  DuctSegmentNode,
  getSceneHistoryPauseDepth,
  LevelNode,
  LinesetNode,
  PipeSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getActiveSnapContext, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { type ComponentType, useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import {
  GeometrySystem,
  installMountedScene,
  LevelScene,
  mount,
  settle,
} from '../__tests__/harness'
import { builtinPlugin } from '../index'

installMountedScene()
beforeEach(() => {
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})
let camera: Camera
function Scene({ level, Selection }: { level: LevelNode; Selection: ComponentType }) {
  const three = useThree()
  camera = three.camera
  useMemo(() => {
    camera.position.set(4, 8, 6)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    three.gl.domElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
  }, [three])
  return (
    <>
      <LevelScene level={level} />
      <Selection />
      <GeometrySystem />
    </>
  )
}
function client(point: number[]) {
  const projected = new Vector3(...point).project(camera)
  return { clientX: (projected.x + 1) * 500, clientY: (1 - projected.y) * 500 }
}
async function pointer(type: string, point?: number[], extra = {}) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        shiftKey: false,
        altKey: false,
        ...(point ? client(point) : {}),
        ...extra,
      }),
    )
  })
}
const hitAreas = (renderer: Awaited<ReturnType<typeof mount>>) =>
  renderer.scene.findAll(
    (entry) => typeof entry.props.onPointerDown === 'function' && entry.props.userData,
  )
async function press(renderer: Awaited<ReturnType<typeof mount>>, index: number, point: number[]) {
  const target = new Vector3(...point)
  if (index > 0) target.x -= index === 2 ? 0.24 : 0.4
  const handle = hitAreas(renderer).sort(
    (a, b) =>
      a.instance.getWorldPosition(new Vector3()).distanceToSquared(target) -
      b.instance.getWorldPosition(new Vector3()).distanceToSquared(target),
  )[0]!
  expect(handle).toBeDefined()
  await renderer.fireEvent(handle, 'pointerDown', {
    object: handle.instance,
    point: new Vector3(...point),
    nativeEvent: {
      ...client(point),
      button: 0,
      stopPropagation() {},
      stopImmediatePropagation() {},
    },
    stopPropagation() {},
  })
}
async function seed(
  kind: 'duct-fitting' | 'lineset' | 'duct-segment' | 'pipe-segment',
  otherFloor = false,
) {
  const level = LevelNode.parse({ level: 0 })
  const above = LevelNode.parse({ level: 1 })
  const schema =
    kind === 'duct-fitting'
      ? DuctFittingNode
      : kind === 'lineset'
        ? LinesetNode
        : kind === 'duct-segment'
          ? DuctSegmentNode
          : PipeSegmentNode
  const node = schema.parse({
    parentId: level.id,
    position: [0, 1, 0],
    path: [
      [0, 1, 0],
      [2, 1, 0],
    ],
  })
  const foreign = schema.parse({
    parentId: above.id,
    path: [
      [-1, 7, 0],
      [-3, 7, 0],
    ],
  })
  const nodes: AnyNode[] = [
    { ...level, children: [node.id] },
    node,
    ...(otherFloor ? [{ ...above, children: [foreign.id] }, foreign] : []),
  ]
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    rootNodeIds: [level.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useInteractionScope.getState().end()
  useEditor.setState({ mode: 'select', tool: null, gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('item', 'off')
  useEditor.getState().setSnappingMode('polygon', 'off')
  useViewer.getState().setSelection({ levelId: level.id, selectedIds: [node.id] })
  clearSceneHistory()
  const def = builtinPlugin.nodes!.find((entry) => entry.kind === kind)!
  const { default: Selection } = await def.affordanceTools!.selection!()
  const renderer = await mount(<Scene level={level} Selection={Selection as ComponentType} />)
  await settle(renderer)
  return { renderer, node }
}
for (const kind of ['duct-fitting', 'lineset'] as const) {
  for (const ending of [
    'pointerup',
    'pointercancel',
    'escape',
    'unmount',
    'scope-change',
  ] as const) {
    test(`${kind} ${ending} keeps the preview transient and releases the gesture`, async () => {
      const { renderer, node } = await seed(kind)
      await press(renderer, 0, [0, 1, 0])
      await press(renderer, 1, [0, 1, 0])
      const baseline = useScene.getState().nodes
      await pointer('pointermove', [-1, 1, 0])
      expect(useScene.getState().nodes).toBe(baseline)
      expect(useLiveNodeOverrides.getState().get(node.id)).toBeDefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(getSceneHistoryPauseDepth()).toBeGreaterThan(0)
      if (ending === 'unmount') await renderer.unmount()
      else if (ending === 'escape') await pointer('keydown', undefined, { key: 'Escape' })
      else if (ending === 'scope-change')
        await act(async () =>
          useInteractionScope
            .getState()
            .begin({ kind: 'handle-drag', nodeId: 'another-node', handle: 'move' }),
        )
      else await pointer(ending)
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      expect(getSceneHistoryPauseDepth()).toBe(0)
      expect(useViewer.getState().inputDragging).toBe(false)
      if (ending === 'pointerup') {
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        expect(useScene.getState().nodes[node.id]).toEqual(node)
      } else {
        expect(useScene.getState().nodes).toBe(baseline)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      }
      await pointer('pointermove', [-2, 1, 0])
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
    })
  }
}
for (const kind of ['lineset', 'duct-segment', 'pipe-segment'] as const) {
  test(`${kind} endpoint ignores ports from another level`, async () => {
    const { renderer, node } = await seed(kind, true)
    await press(renderer, 0, [0, 1, 0])
    await press(renderer, kind === 'duct-segment' ? 2 : 1, [0, 1, 0])
    await pointer('pointermove', [-1, 1, 0])
    const path = useLiveNodeOverrides.getState().get(node.id)?.path as number[][]
    expect(path).toBeDefined()
    expect(path[0]![1]).toBeCloseTo(1)
    await pointer('pointercancel')
  })
}
for (const kind of ['duct-fitting', 'lineset'] as const) {
  test(`${kind} honors Off/Grid modes without a held Shift bypass`, async () => {
    const { renderer, node } = await seed(kind)
    await press(renderer, 0, [0, 1, 0])
    await press(renderer, 1, [0, 1, 0])
    expect(getActiveSnapContext()).toBe(kind === 'duct-fitting' ? 'item' : 'polygon')
    await pointer('pointermove', [-0.73, 1, 0])
    const coordinate = () => {
      const draft = useLiveNodeOverrides.getState().get(node.id)!
      return kind === 'duct-fitting'
        ? (draft.position as number[])[0]!
        : (draft.path as number[][])[0]![0]!
    }
    expect(coordinate()).toBeCloseTo(-0.73)
    useEditor.getState().setSnappingMode(kind === 'duct-fitting' ? 'item' : 'polygon', 'grid')
    await pointer('pointermove', [-0.73, 1, 0], { shiftKey: true })
    expect(coordinate()).toBeCloseTo(-0.5)
    await pointer('pointercancel')
  })
}
