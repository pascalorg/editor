import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  type CameraPose,
  containsPoint,
  DoorNode,
  emitter,
  ItemNode,
  LevelNode,
  type NodeEvent,
  SlabNode,
  sceneRegistry,
  UnitNode,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { resolveGlbPick, useViewer } from '@pascal-app/viewer'
import { CameraControlsImpl } from '@react-three/drei'
import { createElement } from 'react'
import * as THREE from 'three'
import { Group, Vector3 } from 'three'
import { ViewerSelectionManager } from '../components/viewer/viewer-selection-manager'
import { publishCameraPose } from '../store/camera-pose-store'
import useEditor, { takePreviewCameraRestore } from '../store/use-editor'
import { withSelectionHarness } from '../test-utils/selection-harness'
import {
  frameViewerCamera,
  resolveViewerClick,
  resolveViewerHover,
  type ViewerSelection,
  viewerBreadcrumb,
  viewerPickFromNodeEvent,
  viewerSidebarSections,
} from './viewer-selection'

const buildingId = 'building_viewer'
const levelId = 'level_viewer'
const upperId = 'level_viewer_upper'

function wall(id: string, start: [number, number], end: [number, number]) {
  return WallNode.parse({ id: `wall_${id}`, parentId: levelId, start, end, thickness: 0.2 })
}

const walls = [
  wall('south', [0, 0], [8, 0]),
  wall('east', [8, 0], [8, 4]),
  wall('north', [8, 4], [0, 4]),
  wall('west', [0, 4], [0, 0]),
  wall('shared', [4, 0], [4, 4]),
]
const slab = SlabNode.parse({
  id: 'slab_kitchen',
  parentId: levelId,
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
})
const sofa = ItemNode.parse({
  id: 'item_sofa',
  parentId: levelId,
  position: [2, 0, 2],
  asset: {
    id: 'asset:sofa',
    category: 'furniture',
    name: 'Sofa',
    thumbnail: '/sofa.jpg',
    src: '/sofa.glb',
  },
})

/** Two rooms side by side (x 0–4 and 4–8), a slab under the first, a sofa in it. */
function scene(extra: AnyNode[] = [], upperChildren: AnyNode[] = []) {
  const raw: Record<string, AnyNode> = Object.fromEntries(
    [
      BuildingNode.parse({ id: buildingId, name: 'House', children: [levelId, upperId] }),
      LevelNode.parse({
        id: levelId,
        parentId: buildingId,
        level: 0,
        children: [...walls, slab, sofa, ...extra].map((node) => node.id),
      }),
      LevelNode.parse({
        id: upperId,
        parentId: buildingId,
        level: 1,
        children: upperChildren.map((node) => node.id),
      }),
      ...walls,
      slab,
      sofa,
      ...extra,
      ...upperChildren,
    ].map((node) => [node.id, node]),
  )
  const nodes = migrateRoomZones(raw).nodes as Record<string, AnyNode>
  const roomAt = (point: [number, number]) =>
    Object.values(nodes).find(
      (node): node is ZoneNode =>
        node.type === 'zone' && containsPoint([{ outer: node.polygon, holes: [] }], point),
    )!
  const kitchen = roomAt([2, 2])
  const living = roomAt([6, 2])
  nodes[kitchen.id] = { ...kitchen, name: 'Kitchen' }
  nodes[living.id] = { ...living, name: 'Living' }
  return { nodes, kitchen: kitchen.id, living: living.id }
}

const nothing: ViewerSelection = { buildingId: null, levelId: null, zoneId: null, selectedIds: [] }
const alt = { alt: true, ctrl: false, meta: false, shift: false }
const shift = { alt: false, ctrl: false, meta: false, shift: true }

afterEach(() => {
  sceneRegistry.nodes.clear()
  useEditor.getState().setPreviewMode(false)
  useViewer.getState().resetSelection()
  useViewer.getState().setFocusedUnit(null)
})

describe('viewer selection rules', () => {
  test('a floor or a wall selects its room on its floor; inside that room it picks the element', () => {
    const { nodes, kitchen, living } = scene()
    const onFloor = resolveViewerClick(nothing, { nodeId: slab.id, point: [2, 2] }, nodes)
    expect(onFloor).toEqual({
      buildingId,
      levelId,
      zoneId: kitchen as ZoneNode['id'],
      selectedIds: [],
    })

    // The kitchen face of the shared wall drills into the wall; its living face is the next room.
    const onWall = resolveViewerClick(onFloor, { nodeId: 'wall_shared', point: [3.85, 2] }, nodes)
    expect(onWall).toMatchObject({ zoneId: kitchen, selectedIds: ['wall_shared'] })
    const otherSide = resolveViewerClick(onWall, { nodeId: 'wall_shared', point: [4.15, 2] }, nodes)
    expect(otherSide).toMatchObject({ zoneId: living, selectedIds: [] })
  })

  test('an item selects itself, wherever the selection was', () => {
    const { nodes, kitchen } = scene()
    const inRoom: ViewerSelection = {
      buildingId,
      levelId,
      zoneId: kitchen as never,
      selectedIds: [],
    }
    for (const from of [nothing, inRoom]) {
      expect(resolveViewerClick(from, { nodeId: sofa.id, point: [2, 2] }, nodes)).toEqual({
        buildingId,
        levelId,
        zoneId: null,
        selectedIds: [sofa.id],
      })
    }
  })

  test('empty space clears the room and the element and keeps the floor', () => {
    const { nodes, kitchen } = scene()
    const drilled: ViewerSelection = {
      buildingId,
      levelId,
      zoneId: kitchen as never,
      selectedIds: ['wall_shared'],
    }
    expect(resolveViewerClick(drilled, null, nodes)).toEqual({
      buildingId,
      levelId,
      zoneId: null,
      selectedIds: [],
    })
  })

  test('Alt picks the wall itself; Shift adds elements on the same floor', () => {
    const { nodes } = scene()
    const wallPick = { nodeId: 'wall_shared', point: [3.85, 2] as [number, number] }
    expect(resolveViewerClick(nothing, wallPick, nodes, alt)).toMatchObject({
      zoneId: null,
      selectedIds: ['wall_shared'],
    })
    const one = resolveViewerClick(nothing, { nodeId: sofa.id, point: null }, nodes)
    expect(resolveViewerClick(one, wallPick, nodes, shift).selectedIds).toEqual([
      sofa.id,
      'wall_shared',
    ])
  })

  test('hover shows what the click would select: the room, then inside it the element', () => {
    const { nodes, kitchen } = scene()
    const pick = { nodeId: 'wall_shared', point: [3.85, 2] as [number, number] }
    expect(resolveViewerHover(nothing, pick, nodes)).toBe(kitchen)
    expect(resolveViewerHover({ zoneId: kitchen as never }, pick, nodes)).toBe('wall_shared')
    expect(resolveViewerHover(nothing, null, nodes)).toBeNull()
  })

  test('kinds that only frame are not picked', () => {
    const { nodes, kitchen } = scene()
    for (const nodeId of [levelId, buildingId, kitchen]) {
      expect(resolveViewerClick(nothing, { nodeId, point: [2, 2] }, nodes)).toEqual(nothing)
    }
  })
})

describe('viewer hit sources', () => {
  test('a parametric node event picks in its level frame, and a hidden floor is no pick', () => {
    const { nodes } = scene()
    const level = new Group()
    level.position.set(10, 3, -5)
    sceneRegistry.nodes.set(levelId, level)
    const event = { node: nodes.wall_shared, position: [13.85, 4, -3] } as unknown as NodeEvent
    const pick = viewerPickFromNodeEvent(event, nodes)
    expect(pick?.nodeId).toBe('wall_shared')
    expect(pick?.point?.[0]).toBeCloseTo(3.85)
    expect(pick?.point?.[1]).toBeCloseTo(2)
    level.visible = false
    expect(viewerPickFromNodeEvent(event, nodes)).toBeNull()
  })
})

describe('viewer breadcrumb', () => {
  test('an item reads floor › room › item; the room is shown, not selected', () => {
    const { nodes, kitchen } = scene()
    const selection = { buildingId, levelId, zoneId: null, selectedIds: [sofa.id] }
    const crumbs = viewerBreadcrumb(selection as ViewerSelection, null, nodes, (id) =>
      id === sofa.id ? kitchen : null,
    )
    expect(crumbs.map((crumb) => [crumb.kind, crumb.label])).toEqual([
      ['building', 'House'],
      ['level', 'Ground floor'],
      ['room', 'Kitchen'],
      ['node', 'Sofa'],
    ])
  })

  test('a selected room, a focused unit, and the floor alone', () => {
    const unit = UnitNode.parse({ id: 'unit_a', name: 'Apartment A', parentId: buildingId })
    const { nodes, living } = scene([unit])
    const room = { buildingId, levelId, zoneId: living, selectedIds: [] } as ViewerSelection
    expect(viewerBreadcrumb(room, null, nodes).map((crumb) => crumb.label)).toEqual([
      'House',
      'Ground floor',
      'Living',
    ])
    const floor = { ...room, zoneId: null }
    expect(viewerBreadcrumb(floor, 'unit_a', nodes).map((crumb) => crumb.label)).toEqual([
      'House',
      'Ground floor',
      'Apartment A',
    ])
    expect(viewerBreadcrumb(nothing, null, nodes).map((crumb) => crumb.kind)).toEqual(['building'])
  })
})

describe('viewer sidebar', () => {
  test('lists units, rooms and zones of the floor, leaving out empty sections', () => {
    const terrace = ZoneNode.parse({
      id: 'zone_terrace',
      name: 'Terrace',
      parentId: levelId,
      polygon: [
        [10, 0],
        [12, 0],
        [12, 2],
      ],
    })
    const plain = scene([terrace])
    expect(viewerSidebarSections(levelId, plain.nodes).map((section) => section.kind)).toEqual([
      'rooms',
      'zones',
    ])
    expect(viewerSidebarSections(levelId, plain.nodes)[0]!.rows.map((row) => row.label)).toEqual([
      'Kitchen',
      'Living',
    ])
    expect(viewerSidebarSections(upperId, plain.nodes)).toEqual([])

    const unit = UnitNode.parse({ id: 'unit_a', name: 'Apartment A', parentId: buildingId })
    const withUnit = scene([unit, terrace])
    withUnit.nodes.unit_a = { ...unit, members: [withUnit.kitchen as ZoneNode['id']] }
    expect(viewerSidebarSections(levelId, withUnit.nodes).map((section) => section.kind)).toEqual([
      'units',
      'rooms',
      'zones',
    ])
    expect(viewerSidebarSections(upperId, withUnit.nodes)).toEqual([])
  })
})

describe('editor Preview', () => {
  test('leaves the editor selection as it was', () => {
    const unit = UnitNode.parse({ id: 'unit_a', name: 'Apartment A', parentId: buildingId })
    const { nodes, kitchen } = scene([unit])
    useScene.setState({ nodes })
    const editing: ViewerSelection = {
      buildingId,
      levelId: levelId as never,
      zoneId: null,
      selectedIds: ['wall_north'],
    }
    useViewer.getState().setSelection(editing)
    useViewer.getState().setFocusedUnit('unit_a' as never)

    useEditor.getState().setPreviewMode(true)
    expect(useViewer.getState().selection).toEqual({ ...editing, selectedIds: [] })
    expect(useViewer.getState().focusedUnitId).toBeNull()
    // The visitor walks around: another floor, a room, an item.
    useViewer
      .getState()
      .setSelection(resolveViewerClick(nothing, { nodeId: slab.id, point: [2, 2] }, nodes))
    expect(useViewer.getState().selection.zoneId).toBe(kitchen as never)

    useEditor.getState().setPreviewMode(false)
    expect(useViewer.getState().selection).toEqual(editing)
    expect(useViewer.getState().focusedUnitId).toBe('unit_a' as never)
  })
})

test('Preview restores the armed wall tool, editor room, display and camera after a walkthrough', () => {
  const { nodes, kitchen } = scene()
  useScene.setState({ nodes })
  const editor = useEditor.getState()
  editor.armToolMode({ mode: 'build', tool: 'wall' })
  const room = { levelId, zoneId: kitchen } as NonNullable<typeof editor.room>
  useEditor.setState({ room })
  const viewer = useViewer.getState()
  viewer.setSelection({ buildingId, levelId, zoneId: kitchen as never, selectedIds: [] })
  viewer.setLevelMode('stacked')
  viewer.setShowZones(false)
  useViewer.setState({ hideLevelsAboveSelection: true })
  const pose: CameraPose = {
    position: [11, 12, 13],
    target: [1, 2, 3],
    projection: 'perspective',
    fov: 65,
  }
  publishCameraPose({ ...pose, position: [...pose.position], target: [...pose.target] })
  editor.setPreviewMode(true)
  editor.setPreviewMode(true)
  editor.setFirstPersonMode(true)
  viewer.setWalkthroughMode(true)
  viewer.setLevelMode('exploded')
  viewer.setShowZones(true)
  viewer.setSelection({ levelId: upperId as never })
  editor.setPreviewMode(false)
  expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'wall' })
  expect(useEditor.getState().room).toEqual(room)
  expect(useEditor.getState().isFirstPersonMode).toBe(false)
  expect(useViewer.getState()).toMatchObject({
    levelMode: 'stacked',
    hideLevelsAboveSelection: true,
    showZones: false,
    walkthroughMode: false,
    selection: { levelId, zoneId: kitchen, selectedIds: [] },
  })
  expect(takePreviewCameraRestore()).toEqual(pose)
  expect(takePreviewCameraRestore()).toBeNull()
  editor.armToolMode({ mode: 'select' })
})

test('Preview drops saved selection and room IDs deleted by a collaborator', () => {
  const unit = UnitNode.parse({ id: 'unit_a', name: 'Apartment A', parentId: buildingId })
  const { nodes, kitchen } = scene([unit])
  useScene.setState({ nodes })
  useEditor.setState({ room: { levelId, zoneId: kitchen } as never })
  useViewer
    .getState()
    .setSelection({ buildingId, levelId, zoneId: kitchen as never, selectedIds: [sofa.id] })
  useViewer.getState().setFocusedUnit(unit.id)
  useEditor.getState().setPreviewMode(true)
  useScene.setState({ nodes: { [buildingId]: nodes[buildingId]! } })
  useEditor.getState().setPreviewMode(false)
  expect(useViewer.getState().selection).toEqual({
    buildingId,
    levelId: null,
    zoneId: null,
    selectedIds: [],
  })
  expect(useViewer.getState().focusedUnitId).toBeNull()
  expect(useEditor.getState().room).toBeNull()
})

test('a queued empty canvas click cannot clear the restored editor selection after Preview unmounts', async () => {
  await withSelectionHarness(async ({ render, canvas }) => {
    const { nodes, kitchen } = scene()
    useScene.setState({ nodes })
    useViewer.getState().setWalkthroughMode(false)
    useViewer
      .getState()
      .setSelection({ buildingId, levelId, zoneId: kitchen as never, selectedIds: [] })
    const pending = new Map<number, FrameRequestCallback>()
    const previousCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = (callback) => {
      pending.set(1, callback)
      return 1
    }
    globalThis.cancelAnimationFrame = (id) => {
      pending.delete(id)
    }
    try {
      await render(createElement(ViewerSelectionManager))
      canvas.dispatchEvent(Object.assign(new Event('click'), { button: 0 }))
      expect(pending.size).toBe(1)
      await render(null)
      expect(pending.size).toBe(0)
      expect(useViewer.getState().selection.zoneId).toBe(kitchen as never)
    } finally {
      globalThis.cancelAnimationFrame = previousCancel
    }
  })
})

test('the parametric manager ignores selections and outlines during walkthrough', async () => {
  await withSelectionHarness(async ({ render }) => {
    const { nodes } = scene()
    useScene.setState({ nodes })
    useViewer.getState().setSelection({ buildingId, levelId, zoneId: null, selectedIds: [sofa.id] })
    sceneRegistry.nodes.set(sofa.id, new Group())
    useViewer.getState().setHoveredId(sofa.id)
    useViewer.getState().setWalkthroughMode(true)
    await render(createElement(ViewerSelectionManager))
    emitter.emit('node:click', {
      node: nodes.wall_shared!,
      position: [3.85, 1, 2],
      stopPropagation() {},
    } as NodeEvent)
    expect(useViewer.getState().selection.selectedIds).toEqual([sofa.id])
    expect(useViewer.getState().outliner.selectedObjects).toEqual([])
    expect(useViewer.getState().outliner.hoveredObjects).toEqual([])
  })
})

test('baked and parametric picks agree for room faces, mezzanine plates, doors, upper floors and hosted items', () => {
  const plain = scene()
  const mezzanine = ZoneNode.parse({
    id: 'zone_mezz',
    name: 'Mezzanine',
    parentId: levelId,
    spaceRole: 'room',
    hostZoneId: plain.kitchen,
    polygon: [
      [0.5, 0.5],
      [3, 0.5],
      [3, 3],
      [0.5, 3],
    ],
    floor: { support: 'open' },
  })
  const plate = SlabNode.parse({
    ...slab,
    id: 'slab_mezz',
    support: 'open',
    zoneIds: [mezzanine.id],
  })
  const door = DoorNode.parse({ id: 'door_viewer', parentId: 'wall_shared' })
  const child = ItemNode.parse({ ...sofa, id: 'item_book', parentId: sofa.id })
  const upper = ItemNode.parse({ ...sofa, id: 'item_upper', parentId: upperId })
  const nodes: Record<string, AnyNode> = {
    ...plain.nodes,
    [mezzanine.id]: mezzanine,
    [plate.id]: plate,
    [door.id]: door,
    [child.id]: child,
    [upper.id]: upper,
  }
  const identity = new Map<string, Group>()
  const object = (id: string): Group => {
    const cached = identity.get(id)
    if (cached) return cached
    const node = nodes[id]!
    const group = new Group()
    group.userData = { pascalId: id, kind: node.type }
    identity.set(id, group)
    if (node.parentId) object(node.parentId).add(group)
    if (node.type === 'level') {
      group.position.set(10, id === upperId ? 8 : 3, -5)
      sceneRegistry.nodes.set(id, group)
    }
    return group
  }
  const cases: [string, [number, number], string | null][] = [
    ['wall_shared', [3.85, 2], plain.kitchen],
    [slab.id, [2, 2], plain.kitchen],
    [plate.id, [2, 2], mezzanine.id],
    [door.id, [4, 2], null],
    [child.id, [2, 2], null],
    [upper.id, [2, 2], null],
  ]
  for (const [id, point, roomId] of cases) {
    const hit = object(id)
    const level = identity.get(id === upper.id ? upperId : levelId)!
    const world = level.localToWorld(new Vector3(point[0], 1, point[1]))
    const baked = resolveGlbPick([{ object: hit, point: world }], identity)
    const parametric = viewerPickFromNodeEvent(
      { node: nodes[id], position: world.toArray() } as NodeEvent,
      nodes,
    )
    const selected = resolveViewerClick(nothing, baked, nodes)
    expect(selected).toEqual(resolveViewerClick(nothing, parametric, nodes))
    expect(selected.zoneId).toBe(roomId as never)
    expect(selected.selectedIds).toEqual(roomId ? [] : [id])
  }
  const foreign = new Group()
  foreign.userData = { pascalId: 'item_unpublished', kind: 'item', label: 'Unpublished name' }
  object(levelId).add(foreign)
  const baked = resolveGlbPick([{ object: foreign, point: new Vector3() }], identity)
  expect(resolveViewerClick(nothing, baked, nodes)).toEqual(nothing)
  expect(
    viewerBreadcrumb(nothing, null, nodes).some((crumb) => crumb.label === 'Unpublished name'),
  ).toBe(false)
})

test('orthographic sidebar framing fits every corner of a wide room at 45 degrees', () => {
  const previous = globalThis.DOMRect
  globalThis.DOMRect ??= class {} as typeof DOMRect
  CameraControlsImpl.install({ THREE })
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000)
  const control = new CameraControlsImpl(camera)
  try {
    control.setLookAt(6, 6, 6, 0, 0, 0, false)
    frameViewerCamera(control, camera, { bounds: { min: [-40, -2, -5], max: [40, 2, 5] } })
    for (let step = 0; step < 120; step++) control.update(1 / 60)
    camera.updateMatrixWorld(true)
    for (const x of [-40, 40])
      for (const y of [-2, 2])
        for (const z of [-5, 5]) {
          const projected = new Vector3(x, y, z).project(camera)
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(1)
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(1)
        }
    const offset = control.getPosition(new Vector3()).sub(control.getTarget(new Vector3()))
    expect(offset.y / Math.hypot(offset.x, offset.z)).toBeCloseTo(1, 2)
  } finally {
    control.dispose()
    globalThis.DOMRect = previous
  }
})
