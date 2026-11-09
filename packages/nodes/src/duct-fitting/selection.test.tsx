import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  DuctFittingNode,
  DuctSegmentNode,
  LevelNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  AXIS_MOVE_DRAG_LABEL,
  isGridSnapActive,
  type SnappingMode,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, settle } from '../__tests__/harness'
import { ductSegmentDefinition } from '../duct-segment/definition'
import { getDuctFittingPorts } from './ports'
import DuctFittingSelectionAffordance from './selection'

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
const CENTER: Point = [0, 1, 0]
let camera: Camera

function Scene() {
  const three = useThree()
  useMemo(() => {
    three.camera.position.set(0, 6, 4)
    three.camera.lookAt(0, 1, 0)
    three.camera.updateMatrixWorld()
    three.gl.domElement.getBoundingClientRect = () => RECT as DOMRect
    camera = three.camera
  }, [three])
  return (
    <>
      <LevelScene level={level} />
      <DuctFittingSelectionAffordance />
    </>
  )
}

function seed(item: SnappingMode = 'lines') {
  const fitting = DuctFittingNode.parse({
    parentId: level.id,
    fittingType: 'coupling',
    position: CENTER,
  })
  const entries = [
    { ...site, children: [building.id] },
    { ...building, children: [level.id] },
    { ...level, children: [fitting.id] },
    fitting,
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
    snappingModeByContext: { wall: 'grid', polygon: 'grid', item, rotation: 'angles' },
  })
  useViewer.setState({
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [fitting.id],
    },
  })
  return fitting.id as AnyNodeId
}

const fittingOf = (id: AnyNodeId) => useScene.getState().nodes[id] as DuctFittingNode

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

async function openCluster(renderer: Renderer) {
  await settle(renderer)
  await press(
    renderer,
    hitArea(renderer, (p) => near(p.x, CENTER[0]) && near(p.y, CENTER[1]) && near(p.z, CENTER[2])),
    CENTER,
  )
}

const plusXArrow = (renderer: Renderer) =>
  hitArea(renderer, (p) => p.x > 0.1 && near(p.y, CENTER[1]) && near(p.z, CENTER[2]))

test('a Select-mode duct fitting arrow slide claims a handle-drag scope and steps on the grid', async () => {
  const id = seed('grid')
  const renderer = await mount(<Scene />)
  await openCluster(renderer)
  await press(renderer, plusXArrow(renderer), CENTER)
  expect(useInteractionScope.getState().scope).toEqual({
    kind: 'handle-drag',
    nodeId: id,
    handle: AXIS_MOVE_DRAG_LABEL,
  })
  expect(isGridSnapActive()).toBe(true)

  await pointer('pointermove', [0.37, 1, 0])
  expect(fittingOf(id).position).toEqual([0.5, 1, 0])
  await pointer('pointerup', [0.37, 1, 0])

  expect(fittingOf(id).position).toEqual([0.5, 1, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
})

test('Alt slides a duct fitting arrow freely in Grid mode, and a pointercancel drops the drag', async () => {
  const id = seed('grid')
  const renderer = await mount(<Scene />)
  await openCluster(renderer)
  await press(renderer, plusXArrow(renderer), CENTER)
  await pointer('pointermove', [0.37, 1, 0], { altKey: true })
  expect(fittingOf(id).position[0]).toBeCloseTo(0.37, 6)

  await pointer('pointercancel', [0.37, 1, 0])
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  expect(useViewer.getState().inputDragging).toBe(false)
  await pointer('pointerup', [0.37, 1, 0])
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('a joined duct goes back to its start when the fitting slide returns to the start', async () => {
  const id = seed()
  const outlet = getDuctFittingPorts(fittingOf(id)).find((port) => port.id === 'outlet')!
  const collar = [...outlet.position] as Point
  const duct = DuctSegmentNode.parse({
    ...ductSegmentDefinition.defaults(),
    parentId: level.id,
    path: [
      collar,
      [collar[0] + outlet.direction[0] * 2, collar[1], collar[2] + outlet.direction[2] * 2],
    ],
  })
  const nodes = useScene.getState().nodes
  useScene.setState({
    nodes: { ...nodes, [level.id]: { ...level, children: [id, duct.id] }, [duct.id]: duct },
    dirtyNodes: new Set([level.id, duct.id]),
  })
  useScene.temporal.getState().clear()
  const ductPath = () => (useScene.getState().nodes[duct.id] as DuctSegmentNode).path

  const renderer = await mount(<Scene />)
  await openCluster(renderer)
  await press(renderer, plusXArrow(renderer), CENTER)
  await pointer('pointermove', [0.37, 1, 0])
  expect(ductPath()[0]![0]).toBeCloseTo(collar[0] + 0.37, 6)
  await pointer('pointermove', CENTER)
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(ductPath()).toEqual(duct.path)
  await pointer('pointerup', CENTER)
  expect(ductPath()).toEqual(duct.path)
})

test('the duct fitting arrow slide follows the item mode: lines and off slide freely', async () => {
  for (const item of ['lines', 'off'] as const) {
    const id = seed(item)
    const renderer = await mount(<Scene />)
    await openCluster(renderer)
    await press(renderer, plusXArrow(renderer), CENTER)
    expect(isGridSnapActive()).toBe(false)
    await pointer('pointermove', [0.37, 1, 0])
    await pointer('pointerup', [0.37, 1, 0])
    expect(fittingOf(id).position[0]).toBeCloseTo(0.37, 6)
    await renderer.unmount()
  }
})

test('a pointercancel drops a duct fitting resize', async () => {
  const id = seed()
  const height = fittingOf(id).height
  const renderer = await mount(<Scene />)
  await settle(renderer)
  const sphere = hitArea(
    renderer,
    (p) => near(p.x, CENTER[0]) && near(p.z, CENTER[2]) && p.y > CENTER[1] + 0.1,
  )
  const grip = sphere.instance.getWorldPosition(new Vector3())
  await press(renderer, sphere, [grip.x, grip.y, grip.z])
  // 0.013 m up the height axis is 1.02 in of height (both sides grow).
  const pulled: Point = [grip.x, grip.y + 0.013, grip.z]
  await pointer('pointermove', pulled)
  expect(fittingOf(id).height).toBe(height + 1)

  await pointer('pointercancel', pulled)
  expect(fittingOf(id).height).toBe(height)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  await pointer('pointerup', pulled)
  expect(fittingOf(id).height).toBe(height)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
