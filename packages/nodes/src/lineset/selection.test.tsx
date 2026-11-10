import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  getEffectiveNode,
  LevelNode,
  LinesetNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  cancelActiveTool,
  PATH_POINT_DRAG_LABEL,
  runUndo,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, settle } from '../__tests__/harness'
import LinesetSelectionAffordance from './selection'

installMountedScene()
beforeEach(() => {
  Object.assign(window, {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  })
})

type Point = [number, number, number]
type Renderer = Awaited<ReturnType<typeof mount>>

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })
const RECT = { left: 0, top: 0, width: 1000, height: 1000 }
const FIRST: Point[] = [
  [0, 1, 0],
  [2, 1, 0],
]
const SECOND: Point[] = [
  [2, 1, 0],
  [4, 1, 0],
]
let camera: Camera

function Scene() {
  const three = useThree()
  useMemo(() => {
    three.camera.position.set(2, 6, 4)
    three.camera.lookAt(2, 1, 0)
    three.camera.updateMatrixWorld()
    three.gl.domElement.getBoundingClientRect = () => RECT as DOMRect
    camera = three.camera
  }, [three])
  return (
    <>
      <LevelScene level={level} />
      <LinesetSelectionAffordance />
    </>
  )
}

/** Two linesets joined end to end at x = 2, the first one selected. */
function seed() {
  const first = LinesetNode.parse({ parentId: level.id, path: FIRST })
  const second = LinesetNode.parse({ parentId: level.id, path: SECOND })
  const entries = [
    { ...site, children: [building.id] },
    { ...building, children: [level.id] },
    { ...level, children: [first.id, second.id] },
    first,
    second,
  ]
  useScene.setState({
    nodes: Object.fromEntries(entries.map((n) => [n.id, n])),
    rootNodeIds: [site.id],
    dirtyNodes: new Set(entries.map((n) => n.id)),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useEditor.setState({
    mode: 'select',
    tool: null,
    gridSnapStep: 0.5,
    snappingModeByContext: { wall: 'grid', polygon: 'grid', item: 'grid', rotation: 'angles' },
  })
  useViewer.setState({
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [first.id],
    },
  })
  return { first: first.id as AnyNodeId, second: second.id as AnyNodeId }
}

const pathOf = (id: AnyNodeId) =>
  getEffectiveNode(useScene.getState().nodes[id] as LinesetNode).path
const history = () => useScene.temporal.getState()

function client(point: Point) {
  const ndc = new Vector3(...point).project(camera)
  return { clientX: ((ndc.x + 1) / 2) * RECT.width, clientY: ((1 - ndc.y) / 2) * RECT.height }
}

/** The handle hit area whose world position passes `where`. */
function hitArea(renderer: Renderer, where: (p: Vector3) => boolean) {
  const found = renderer.scene
    .findAll(
      (n) =>
        typeof n.props.onPointerDown === 'function' &&
        (n.instance as { isMesh?: boolean }).isMesh === true,
    )
    .filter((n) => where(n.instance.getWorldPosition(new Vector3())))
  expect(found).toHaveLength(1)
  return found[0]!
}

async function press(renderer: Renderer, target: ReturnType<typeof hitArea>, at: Point) {
  await renderer.fireEvent(target, 'pointerDown', {
    nativeEvent: { button: 0, ...client(at), stopPropagation() {}, stopImmediatePropagation() {} },
  })
  await settle(renderer)
}

async function pointer(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  at: Point,
  init: { altKey?: boolean } = {},
) {
  await act(async () => {
    window.dispatchEvent(Object.assign(new Event(type), { button: 0, ...client(at), ...init }))
  })
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** Opens the first lineset's joined end and grabs its outward (+X) arrow. */
async function grabJoinedEnd(renderer: Renderer) {
  await settle(renderer)
  await press(
    renderer,
    hitArea(renderer, (p) => near(p.x, 2) && near(p.y, 1) && near(p.z, 0)),
    [2, 1, 0],
  )
  const arrow = hitArea(renderer, (p) => p.x > 2.1 && near(p.y, 1) && near(p.z, 0))
  const grip = arrow.instance.getWorldPosition(new Vector3())
  await press(renderer, arrow, [grip.x, grip.y, grip.z])
}

/** Drags the joined end to x = 3 (the neighbour follows), then to x = 3.5 with Alt held. */
async function dragThenDetach(first: AnyNodeId, second: AnyNodeId) {
  await pointer('pointermove', [3, 1, 0])
  expect(pathOf(first)).toEqual([
    [0, 1, 0],
    [3, 1, 0],
  ])
  expect(pathOf(second)).toEqual([
    [3, 1, 0],
    [4, 1, 0],
  ])
  await pointer('pointermove', [3.5, 1, 0], { altKey: true })
  expect(pathOf(first)).toEqual([
    [0, 1, 0],
    [3.5, 1, 0],
  ])
  expect(pathOf(second)).toEqual(SECOND)
}

test('holding Alt puts the joined lineset back, and Escape then leaves both untouched', async () => {
  const { first, second } = seed()
  const renderer = await mount(<Scene />)
  await grabJoinedEnd(renderer)
  expect(useInteractionScope.getState().scope).toEqual({
    kind: 'handle-drag',
    nodeId: first,
    handle: PATH_POINT_DRAG_LABEL,
  })
  await dragThenDetach(first, second)

  let consumed = false
  await act(async () => {
    consumed = cancelActiveTool()
  })
  expect(consumed).toBe(true)
  expect(pathOf(first)).toEqual(FIRST)
  expect(pathOf(second)).toEqual(SECOND)
  expect(history().pastStates).toHaveLength(0)
  expect(useViewer.getState().selection.selectedIds).toEqual([first])
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
})

test('releasing a detached lineset end commits one undo step that never moved the neighbour', async () => {
  const { first, second } = seed()
  const renderer = await mount(<Scene />)
  await grabJoinedEnd(renderer)
  await dragThenDetach(first, second)
  await pointer('pointerup', [3.5, 1, 0], { altKey: true })

  expect(pathOf(first)).toEqual([
    [0, 1, 0],
    [3.5, 1, 0],
  ])
  expect(pathOf(second)).toEqual(SECOND)
  expect(history().pastStates).toHaveLength(1)
  await act(async () => {
    history().undo()
  })
  expect(pathOf(first)).toEqual(FIRST)
  expect(pathOf(second)).toEqual(SECOND)
})

test('an undo from outside the keyboard cancels a lineset drag before it jumps', async () => {
  const { first, second } = seed()
  await act(async () => {
    useScene.getState().updateNode(second, { insulated: false } as Partial<LinesetNode>)
  })
  expect(history().pastStates).toHaveLength(1)
  const renderer = await mount(<Scene />)
  await grabJoinedEnd(renderer)
  await pointer('pointermove', [3, 1, 0])

  await act(async () => {
    runUndo()
  })
  expect(pathOf(first)).toEqual(FIRST)
  expect(pathOf(second)).toEqual(SECOND)
  expect((useScene.getState().nodes[second] as LinesetNode).insulated).toBe(true)
  expect(history().futureStates).toHaveLength(1)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')

  await pointer('pointerup', [3, 1, 0])
  expect(pathOf(first)).toEqual(FIRST)
  expect(history().futureStates).toHaveLength(1)
})

test('a pointercancel or unmounting the handles mid-drag drops the lineset drag', async () => {
  for (const end of ['pointercancel', 'unmount'] as const) {
    const { first, second } = seed()
    const renderer = await mount(<Scene />)
    await grabJoinedEnd(renderer)
    await pointer('pointermove', [3, 1, 0])
    if (end === 'pointercancel') await pointer('pointercancel', [3, 1, 0])
    else await renderer.unmount()

    expect(pathOf(first)).toEqual(FIRST)
    expect(pathOf(second)).toEqual(SECOND)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(history().isTracking).toBe(true)
    await pointer('pointerup', [3, 1, 0])
    expect(pathOf(first)).toEqual(FIRST)
    expect(history().pastStates).toHaveLength(0)
    await renderer.unmount()
  }
})
