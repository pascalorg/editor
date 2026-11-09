import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  DuctSegmentNode,
  LevelNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, settle } from '../__tests__/harness'
import { ductSegmentDefinition } from './definition'
import DuctSegmentSelectionAffordance from './selection'

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
      <DuctSegmentSelectionAffordance />
    </>
  )
}

/** Two ducts joined end to end at x = 2, the first one selected; or the first alone. */
function seed({ joined = true } = {}) {
  const duct = (path: Point[]) =>
    DuctSegmentNode.parse({ ...ductSegmentDefinition.defaults(), parentId: level.id, path })
  const first = duct(FIRST)
  const second = duct(SECOND)
  const runs = joined ? [first, second] : [first]
  const entries = [
    { ...site, children: [building.id] },
    { ...building, children: [level.id] },
    { ...level, children: runs.map((run) => run.id) },
    ...runs,
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

const pathOf = (id: AnyNodeId) => (useScene.getState().nodes[id] as DuctSegmentNode).path
const previewOf = (id: AnyNodeId) =>
  useLiveNodeOverrides.getState().overrides.get(id) as { path?: Point[] } | undefined

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
  altKey = false,
) {
  await act(async () => {
    window.dispatchEvent(Object.assign(new Event(type), { button: 0, ...client(at), altKey }))
  })
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** Opens the first duct's run-center cluster and presses its along-run (+X) arrow. */
async function grabAlongArrow(renderer: Renderer): Promise<Point> {
  await settle(renderer)
  await press(
    renderer,
    hitArea(renderer, (p) => near(p.x, 1) && near(p.y, 1) && near(p.z, 0)),
    [1, 1, 0],
  )
  const arrow = hitArea(renderer, (p) => p.x > 1.05 && p.x < 1.95 && near(p.y, 1) && near(p.z, 0))
  const grip = arrow.instance.getWorldPosition(new Vector3())
  await press(renderer, arrow, [grip.x, grip.y, grip.z])
  return [grip.x, grip.y, grip.z]
}

test('holding Alt on a duct end drag drops the joined duct from the live preview', async () => {
  const { first, second } = seed()
  const renderer = await mount(<Scene />)
  await settle(renderer)
  await press(
    renderer,
    hitArea(renderer, (p) => near(p.x, 2) && near(p.y, 1) && near(p.z, 0)),
    [2, 1, 0],
  )
  const arrow = hitArea(renderer, (p) => p.x > 2.1 && near(p.y, 1) && near(p.z, 0))
  const grip = arrow.instance.getWorldPosition(new Vector3())
  await press(renderer, arrow, [grip.x, grip.y, grip.z])

  await pointer('pointermove', [3, 1, 0])
  expect(previewOf(second)?.path).toEqual([
    [3, 1, 0],
    [4, 1, 0],
  ])
  await pointer('pointermove', [3.5, 1, 0], true)
  expect(previewOf(first)?.path).toEqual([
    [0, 1, 0],
    [3.5, 1, 0],
  ])
  expect(previewOf(second)).toBeUndefined()

  await pointer('pointerup', [3.5, 1, 0], true)
  expect(pathOf(first)).toEqual([
    [0, 1, 0],
    [3.5, 1, 0],
  ])
  expect(pathOf(second)).toEqual(SECOND)
  expect(previewOf(first)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
})

test('Alt slides a duct run center arrow freely in Grid mode', async () => {
  for (const [altKey, delta] of [
    [false, 0.5],
    [true, 0.37],
  ] as const) {
    const { first } = seed({ joined: false })
    const renderer = await mount(<Scene />)
    const grip = await grabAlongArrow(renderer)
    const to: Point = [grip[0] + 0.37, grip[1], grip[2]]
    await pointer('pointermove', to, altKey)
    expect(previewOf(first)?.path?.[0]?.[0]).toBeCloseTo(delta, 6)
    await pointer('pointerup', to, altKey)

    expect(pathOf(first)[0]![0]).toBeCloseTo(delta, 6)
    expect(pathOf(first)[1]![0]).toBeCloseTo(2 + delta, 6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await renderer.unmount()
  }
})

test('a pointercancel drops a duct run slide', async () => {
  const { first } = seed({ joined: false })
  const renderer = await mount(<Scene />)
  const grip = await grabAlongArrow(renderer)
  const to: Point = [grip[0] + 0.37, grip[1], grip[2]]
  await pointer('pointermove', to)
  expect(previewOf(first)?.path?.[0]?.[0]).toBeCloseTo(0.5, 6)

  await pointer('pointercancel', to)
  expect(previewOf(first)).toBeUndefined()
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  expect(useViewer.getState().inputDragging).toBe(false)
  await pointer('pointerup', to)
  expect(pathOf(first)).toEqual(FIRST)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
