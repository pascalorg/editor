import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  PipeFittingNode,
  PipeSegmentNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  AXIS_MOVE_DRAG_LABEL,
  cancelActiveTool,
  isAngleSnapActive,
  isGridSnapActive,
  ROTATE_HANDLE_DRAG_LABEL,
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
import { getPipeFittingPorts } from './ports'
import PipeFittingSelectionAffordance from './selection'

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
      <PipeFittingSelectionAffordance />
    </>
  )
}

function seed(modes: { item?: SnappingMode; rotation?: SnappingMode } = {}) {
  const fitting = PipeFittingNode.parse({
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
    snappingModeByContext: {
      wall: 'grid',
      polygon: 'grid',
      item: modes.item ?? 'lines',
      rotation: modes.rotation ?? 'angles',
    },
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

const fittingOf = (id: AnyNodeId) => useScene.getState().nodes[id] as PipeFittingNode

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

test('a Select-mode fitting arrow slide claims a handle-drag scope and steps on the grid', async () => {
  const id = seed({ item: 'grid' })
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

test('Alt slides a fitting arrow freely in Grid mode, and a pointercancel drops the drag', async () => {
  const id = seed({ item: 'grid' })
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

test('a joined run goes back to its start when the fitting slide returns to the start', async () => {
  const id = seed()
  const outlet = getPipeFittingPorts(fittingOf(id)).find((port) => port.id === 'outlet')!
  const collar: Point = [...outlet.position]
  const run = PipeSegmentNode.parse({
    parentId: level.id,
    diameter: fittingOf(id).diameter,
    path: [
      collar,
      [collar[0] + outlet.direction[0] * 2, collar[1], collar[2] + outlet.direction[2] * 2],
    ],
  })
  const nodes = useScene.getState().nodes
  useScene.setState({
    nodes: { ...nodes, [level.id]: { ...level, children: [id, run.id] }, [run.id]: run },
    dirtyNodes: new Set([level.id, run.id]),
  })
  useScene.temporal.getState().clear()
  const runPath = () => (useScene.getState().nodes[run.id] as PipeSegmentNode).path

  const renderer = await mount(<Scene />)
  await openCluster(renderer)
  await press(renderer, plusXArrow(renderer), CENTER)
  await pointer('pointermove', [0.37, 1, 0])
  expect(runPath()[0]![0]).toBeCloseTo(collar[0] + 0.37, 6)
  await pointer('pointermove', CENTER)
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(runPath()).toEqual(run.path)
  await pointer('pointerup', CENTER)
  expect(runPath()).toEqual(run.path)
})

test('the fitting arrow slide follows the item mode: lines and off slide freely', async () => {
  for (const item of ['lines', 'off'] as const) {
    const id = seed({ item })
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

test('Escape cancels a fitting drag without deselecting it or touching history', async () => {
  const id = seed({ item: 'grid' })
  const renderer = await mount(<Scene />)
  await openCluster(renderer)
  await press(renderer, plusXArrow(renderer), CENTER)
  await pointer('pointermove', [0.37, 1, 0])
  expect(fittingOf(id).position).toEqual([0.5, 1, 0])

  let consumed = false
  await act(async () => {
    consumed = cancelActiveTool()
  })
  expect(consumed).toBe(true)
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(useViewer.getState().selection.selectedIds).toEqual([id])
  expect(useInteractionScope.getState().scope.kind).toBe('idle')

  await pointer('pointermove', [1.2, 1, 0])
  await pointer('pointerup', [1.2, 1, 0])
  expect(fittingOf(id).position).toEqual(CENTER)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('a fitting rotate arc steps 45° in the default angle mode and turns freely with Alt held', async () => {
  for (const altKey of [false, true]) {
    const id = seed()
    const renderer = await mount(<Scene />)
    await openCluster(renderer)
    const arc = hitArea(renderer, (p) => near(p.y, CENTER[1]) && p.x > 0.1 && near(p.x, p.z))
    const grip = arc.instance.getWorldPosition(new Vector3())
    await press(renderer, arc, [grip.x, grip.y, grip.z])
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: id,
      handle: ROTATE_HANDLE_DRAG_LABEL,
    })
    expect(isAngleSnapActive()).toBe(true)

    // The grip sits at -45° about +Y; the pointer swings 50° to +5°.
    const radius = Math.hypot(grip.x - CENTER[0], grip.z - CENTER[2])
    const turned: Point = [
      CENTER[0] + radius * Math.cos((5 * Math.PI) / 180),
      CENTER[1],
      CENTER[2] - radius * Math.sin((5 * Math.PI) / 180),
    ]
    await pointer('pointermove', turned, { altKey })
    await pointer('pointerup', turned, { altKey })
    expect(fittingOf(id).rotation[1]).toBeCloseTo(((altKey ? 50 : 45) * Math.PI) / 180, 6)
    await renderer.unmount()
  }
})

test('a fitting resize steps the diameter in either snapping mode and sizes freely when off', async () => {
  for (const [item, diameter] of [
    ['lines', 3],
    ['grid', 3],
    ['off', null],
  ] as const) {
    const id = seed({ item })
    const renderer = await mount(<Scene />)
    await settle(renderer)
    const sphere = hitArea(
      renderer,
      (p) => near(p.x, CENTER[0]) && near(p.z, CENTER[2]) && p.y > CENTER[1] + 0.1,
    )
    const grip = sphere.instance.getWorldPosition(new Vector3())
    await press(renderer, sphere, [grip.x, grip.y, grip.z])
    // 0.013 m along the diameter axis is 1.02 in of diameter (both sides grow).
    const pulled: Point = [grip.x, grip.y + 0.013, grip.z]
    await pointer('pointermove', pulled)
    await pointer('pointerup', pulled)
    const result = fittingOf(id).diameter
    if (diameter === null) {
      expect(result).toBeGreaterThan(3)
      expect(result).toBeLessThan(3.1)
    } else expect(result).toBe(diameter)
    await renderer.unmount()
  }
})
