import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test'
import {
  DoorNode,
  emitter,
  type GeometryContext,
  type GridEvent,
  getWallBodyLine,
  ItemNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { createElement, type ReactNode } from 'react'
import { Box3, type Mesh, Vector3 } from 'three'
import { resolveCabinetWallSnapPlacement } from '../cabinet/wall-snap'
import { wallLocalToWorld as doorWorldPosition } from '../door/door-math'
import { buildDoorFloorplan } from '../door/floorplan'
import DoorPreview from '../door/preview'
import { resolveItemTransform } from '../item/floorplan'
import { buildWindowFloorplan } from '../window/floorplan'
import WindowPreview from '../window/preview'
import { wallLocalToWorld as windowWorldPosition } from '../window/window-math'
import { buildWallFloorplan } from './floorplan'
import { wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { MoveWallEndpointTool } from './move-endpoint-tool'
import { buildBridgeWallCreates, buildBridgeWallPreviews } from './move-shared'
import { wallReferenceModel, wallSettings } from './panel-model'
import { wallParametrics } from './parametrics'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const originalState = useScene.getState()
afterEach(() => {
  useScene.setState(originalState)
  useLiveNodeOverrides.getState().clearAll()
})
const makeWall = () =>
  WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, justification: 'a' })
const context = (wall: WallNode): GeometryContext => ({
  parent: wall,
  children: [],
  siblings: [],
  resolve: (id) => (id === wall.id ? wall : undefined),
  viewState: { selected: true },
  extensions: createFloorplanContextExtensions({ automaticDimensions: false, purpose: 'document' }),
})

test('door and window plan symbols and move handles sit on the body centre', () => {
  const wall = makeWall()
  for (const geometry of [
    buildDoorFloorplan(DoorNode.parse({ position: [2, 1, 0] }), context(wall)),
    buildWindowFloorplan(WindowNode.parse({ position: [2, 1, 0] }), context(wall)),
  ]) {
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') throw Error('Expected group')
    const polygon = geometry.children.find((child) => child.kind === 'polygon')
    if (polygon?.kind !== 'polygon') throw Error('Expected polygon')
    expect(Math.min(...polygon.points.map((p) => p[1]))).toBeCloseTo(0)
    expect(Math.max(...polygon.points.map((p) => p[1]))).toBeCloseTo(0.2)
    expect(geometry.children.find((child) => child.kind === 'move-handle')).toMatchObject({
      point: [2, 0.1],
    })
  }
})

test('floorplan wall body, hover polygon, face dots and side arrows follow justification', () => {
  const wall = makeWall()
  for (const selected of [false, true]) {
    const geometry = buildWallFloorplan(wall, {
      ...context(wall),
      parent: null,
      viewState: { selected, hovered: true },
    })
    if (geometry?.kind !== 'group') throw Error('Expected group')
    const polygon = geometry.children[0]!
    if (polygon.kind !== 'polygon') throw Error('Expected polygon')
    expect(Math.min(...polygon.points.map((p) => p[1]))).toBe(0)
    expect(Math.max(...polygon.points.map((p) => p[1]))).toBe(0.2)
    if (selected) {
      const dots = geometry.children.filter(
        (child) => child.kind === 'endpoint-handle' && child.affordance === 'thickness',
      )
      expect(dots.map((dot) => dot.kind === 'endpoint-handle' && dot.point[1])).toEqual([0.2, 0])
      const arrows = geometry.children.filter((child) => child.kind === 'move-arrow')
      expect(arrows).toHaveLength(2)
      expect(arrows[0]).toMatchObject({ point: [2, 0.28500000000000003] })
      expect(arrows[1]).toMatchObject({ point: [2, -0.05] })
    }
  }
})

test('hosted items and cabinet snaps follow the two faces and body centre', () => {
  const wall = makeWall()
  for (const side of ['front', 'back'] as const) {
    const expectedZ = side === 'front' ? 0.2 : 0
    const item = ItemNode.parse({
      parentId: wall.id,
      position: [2, 1, 0],
      side,
      asset: {
        id: 'test',
        name: 'test',
        category: 'test',
        thumbnail: '/test.png',
        src: '/test.glb',
        dimensions: [1, 1, 0.5],
        attachTo: 'wall-side',
      },
    })
    expect(resolveItemTransform(item, context(wall))?.y).toBeCloseTo(expectedZ)
    const placement = resolveCabinetWallSnapPlacement({
      width: 1,
      depth: 0.6,
      hit: {
        wall,
        side,
        localX: 2,
        wallLength: 4,
        dirX: 1,
        dirY: 0,
        perpDistance: 0,
        itemRotation: 0,
      },
    })!
    expect(placement.position[2]).toBeCloseTo(expectedZ + (side === 'front' ? 0.3 : -0.3))
    expect(placement.guide.start[2]).toBeCloseTo(expectedZ)
    const embedded = { ...item, asset: { ...item.asset, attachTo: 'wall' as const } }
    expect(resolveItemTransform(embedded, context(wall))?.y).toBeCloseTo(0.1)
  }
})

describe('reference control', () => {
  // A 4 x 3 room drawn counter-clockwise: every wall has the room on its a side.
  const room = () => {
    const points: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    return points.map((start, i) =>
      WallNode.parse({ start, end: points[(i + 1) % 4], thickness: 0.2 }),
    )
  }
  const asNodes = (walls: WallNode[]) => Object.fromEntries(walls.map((w) => [w.id, w]))
  const labels = (walls: WallNode[], nodes = asNodes(walls)) =>
    wallReferenceModel(walls, nodes).options.map((option) => option.label)

  test('a room on exactly one side reads outside / inside; otherwise left / right', () => {
    const walls = room()
    expect(labels([walls[0]!], asNodes(walls))).toEqual(['Outside face', 'Center', 'Inside face'])
    const lone = makeWall()
    expect(labels([lone])).toEqual(['Left', 'Center', 'Right'])
    // justification a puts the body on the left, so face b (right) sits on the line.
    expect(wallReferenceModel([lone], asNodes([lone])).value).toBe('right')
    const inside = { ...walls[0]!, justification: 'b' as const }
    expect(wallReferenceModel([inside], asNodes([inside, ...walls.slice(1)])).value).toBe('inside')
  })

  test('picking a face keeps the drawn line and undoes in one step', () => {
    const walls = room()
    const nodes = asNodes(walls)
    useScene.setState({ nodes, rootNodeIds: [] })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    wallReferenceModel([walls[0]!], nodes).apply('outside')
    const updated = useScene.getState().nodes[walls[0]!.id] as WallNode
    // Face b (outside) on the line: the body lies on the a side.
    expect(updated.justification).toBe('a')
    expect([updated.start, updated.end]).toEqual([walls[0]!.start, walls[0]!.end])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(nodes)
  })

  test('the settings row cycles the same choices and batches into one step', () => {
    const walls = room()
    const nodes = asNodes(walls)
    useScene.setState({ nodes, rootNodeIds: [] })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    const row = wallSettings(walls[0]!, nodes, () => {
      throw Error('Reference must not patch through the single-node update')
    }).find((entry) => entry.id === 'wall-reference')!
    if (row.kind !== 'cycle') throw Error('Expected reference cycle')
    expect(row.value).toBe('Center')
    row.next()
    expect((useScene.getState().nodes[walls[0]!.id] as WallNode).justification).toBe('b')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('a selection applies each wall its own inside / outside and shows no active mixed option', () => {
    const walls = room()
    // Redraw one wall backwards: its room now lies on its b side.
    const reversed = { ...walls[2]!, start: walls[2]!.end, end: walls[2]!.start }
    const all = [walls[0]!, walls[1]!, reversed, walls[3]!]
    const nodes = asNodes(all)
    useScene.setState({ nodes, rootNodeIds: [] })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    const model = wallReferenceModel([walls[0]!, reversed], nodes)
    expect(model.options.map((option) => option.label)).toEqual([
      'Outside face',
      'Center',
      'Inside face',
    ])
    model.apply('outside')
    const after = useScene.getState().nodes
    expect((after[walls[0]!.id] as WallNode).justification).toBe('a')
    expect((after[reversed.id] as WallNode).justification).toBe('b')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const again = wallReferenceModel(
      [after[walls[0]!.id] as WallNode, after[reversed.id] as WallNode],
      after,
    )
    expect(again.value).toBe('outside')
    const mixed = wallReferenceModel(
      [
        after[walls[0]!.id] as WallNode,
        { ...(after[reversed.id] as WallNode), justification: undefined },
      ],
      after,
    )
    expect(mixed.value).toBeNull()
  })

  test('a selection mixing room walls and free walls falls back to left / right', () => {
    const walls = room()
    const lone = WallNode.parse({ start: [10, 0], end: [14, 0], thickness: 0.2 })
    expect(labels([walls[0]!, lone], asNodes([...walls, lone]))).toEqual([
      'Left',
      'Center',
      'Right',
    ])
  })

  test('generic inspectors never see the stored a / b value', () => {
    expect(
      wallParametrics.groups
        .flatMap((group) => group.fields)
        .find((field) => field.key === 'justification'),
    ).toBeUndefined()
    expect('justification' in WallNode.parse({ start: [0, 0], end: [4, 0] })).toBe(false)
  })
})

test('2D endpoint crossing keeps stored orientation', () => {
  const wall = makeWall()
  useScene.setState({ nodes: { [wall.id]: wall } })
  const session = wallMoveEndpointAffordance.start({
    node: wall,
    payload: { wallId: wall.id, endpoint: 'start' },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [0, 0],
    gridSnapStep: 0.1,
  })
  session.apply({
    planPoint: [6, 0],
    modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  const preview = { ...wall, ...useLiveNodeOverrides.getState().get(wall.id) } as WallNode
  expect(preview.justification).toBe('a')
  expect(getWallBodyLine(preview).start.y).toBeCloseTo(-0.1)
  session.apply({
    planPoint: [-2, 0],
    modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  const returned = { ...wall, ...useLiveNodeOverrides.getState().get(wall.id) } as WallNode
  expect(returned.justification).toBe('a')
  expect(getWallBodyLine(returned).start.y).toBeCloseTo(0.1)
  session.apply({
    planPoint: [6, 0],
    modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  session.commit?.()
  const committed = useScene.getState().nodes[wall.id] as WallNode
  expect(getWallBodyLine(committed)).toEqual(getWallBodyLine(preview))
})

test('bridge preview and creation inherit source orientation', () => {
  const wall = makeWall()
  const args = {
    bridgePlans: [
      { wall, originalPoint: [0, 0] as [number, number], movedEndpoint: 'start' as const },
    ],
    nextStart: [-2, 0] as [number, number],
    nextEnd: [2, 0] as [number, number],
    existingWalls: [wall],
    wallCount: 1,
  }
  const created = buildBridgeWallCreates(args)[0]!.node
  const preview = buildBridgeWallPreviews(args)[0]!.wall
  expect(created.justification).toBe('a')
  expect(getWallBodyLine(created).start.y).toBeCloseTo(-0.1)
  expect(getWallBodyLine(preview)).toEqual(getWallBodyLine(created))
})

test('whole-wall move leaves linked wall orientation fields unchanged', () => {
  const wall = makeWall()
  const consumed = WallNode.parse({ start: [0, 0], end: [0, 2] })
  const linked = WallNode.parse({
    start: [0, 2],
    end: [0, 2.5],
    thickness: 0.2,
    justification: 'a',
  })
  useScene.setState({ nodes: { [wall.id]: wall, [consumed.id]: consumed, [linked.id]: linked } })
  const session = wallFloorplanMoveTarget({ node: wall, nodes: useScene.getState().nodes })
  const modifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }
  session.apply({ planPoint: [2, 0], modifiers })
  session.apply({ planPoint: [2, 3], modifiers })
  const preview = { ...linked, ...useLiveNodeOverrides.getState().get(linked.id) } as WallNode
  expect(preview.justification).toBe('a')
  expect(getWallBodyLine(preview).start.x).toBeCloseTo(0.1)
  session.commit?.()
  const committed = useScene.getState().nodes[linked.id] as WallNode
  expect(getWallBodyLine(committed)).toEqual(getWallBodyLine(preview))
})

test('opening world cursor uses the body centre on rotated justified walls', () => {
  const wall = { ...makeWall(), end: [0, 4] as [number, number] }
  for (const position of [doorWorldPosition, windowWorldPosition]) {
    const point = position(wall, 2, 1, 3, 0.2)
    expect(point[0]).toBeCloseTo(-0.1)
    expect(point[1]).toBeCloseTo(4.2)
    expect(point[2]).toBeCloseTo(2)
  }
})

test('3D endpoint rotation across 90 degrees preserves orientation fields', async () => {
  // The release arms a click-swallow cleanup timer on `window`; drain it before `window` goes.
  jest.useFakeTimers()
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = new EventTarget() as Window & typeof globalThis
  const html = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
    () => null,
  )
  try {
    for (const justification of [undefined, 'a', 'b'] as const) {
      const wall = {
        ...makeWall(),
        justification,
        frontSide: 'interior' as const,
        backSide: 'exterior' as const,
        curveOffset: 0.25,
      }
      useScene.setState({ nodes: { [wall.id]: wall } })
      const renderer = await create(
        createElement(MoveWallEndpointTool, { target: { wall, endpoint: 'end' } }),
      )
      try {
        for (const angle of [89, 91]) {
          const radians = (angle * Math.PI) / 180
          await act(async () => {
            emitter.emit('grid:move', {
              localPosition: [4 * Math.cos(radians), 0, 4 * Math.sin(radians)],
              nativeEvent: { altKey: true },
            } as GridEvent)
          })
          const preview = { ...wall, ...useLiveNodeOverrides.getState().get(wall.id) }
          expect(preview.justification).toBe(justification)
          expect(preview.frontSide).toBe('interior')
          expect(preview.backSide).toBe('exterior')
          expect(preview.curveOffset).toBe(0.25)
        }
        await act(async () => {
          window.dispatchEvent(new Event('pointerup'))
        })
        expect(useScene.getState().nodes[wall.id]).toMatchObject({
          frontSide: 'interior',
          backSide: 'exterior',
          curveOffset: 0.25,
        })
        expect((useScene.getState().nodes[wall.id] as WallNode).justification).toBe(justification)
      } finally {
        await renderer.unmount()
      }
    }
  } finally {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    html.mockRestore()
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

for (const justification of [undefined, 'a', 'b'] as const)
  test(`endpoint rotation across 90 degrees preserves orientation fields: ${justification ?? 'center'}`, () => {
    const wall = {
      ...makeWall(),
      justification,
      frontSide: 'interior' as const,
      backSide: 'exterior' as const,
      curveOffset: 0.25,
    }
    useScene.setState({ nodes: { [wall.id]: wall } })
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      payload: { wallId: wall.id, endpoint: 'end' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: wall.end,
      gridSnapStep: 0.1,
    })
    for (const angle of [89, 91]) {
      const radians = (angle * Math.PI) / 180
      session.apply({
        planPoint: [4 * Math.cos(radians), 4 * Math.sin(radians)],
        modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
      })
      const preview = { ...wall, ...useLiveNodeOverrides.getState().get(wall.id) }
      expect(preview.justification).toBe(justification)
      expect(preview.frontSide).toBe('interior')
      expect(preview.backSide).toBe('exterior')
      expect(preview.curveOffset).toBe(0.25)
    }
    session.commit?.()
    expect(useScene.getState().nodes[wall.id]).toMatchObject({
      frontSide: 'interior',
      backSide: 'exterior',
      curveOffset: 0.25,
    })
    expect((useScene.getState().nodes[wall.id] as WallNode).justification).toBe(justification)
  })

test('opening previews keep host thickness while suppressing only their placement offset', async () => {
  const wall = { ...makeWall(), thickness: 0.4 }
  useScene.setState({ nodes: { [wall.id]: wall } })
  const props = { parentId: wall.id, position: [0, 0, 0] }
  for (const element of [
    createElement(DoorPreview, { node: DoorNode.parse(props) }),
    createElement(WindowPreview, { node: WindowNode.parse(props) }),
  ]) {
    const renderer = await create(element)
    try {
      const mesh = renderer.scene.children[0]!.instance as Mesh
      expect(mesh.position.z).toBe(0)
      mesh.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(mesh.getObjectByName('cutout')!)
      expect(bounds.getSize(new Vector3()).z).toBeCloseTo(0.48, 6)
      expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(0)
    } finally {
      await renderer.unmount()
    }
  }
})
