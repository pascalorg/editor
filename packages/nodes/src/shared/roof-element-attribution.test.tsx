import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  BoxVentNode,
  BuildingNode,
  clearSceneHistory,
  emitter,
  getRoofSegmentCoveringSeat,
  LevelNode,
  type RoofElementKind,
  type RoofEvent,
  RoofGlazing,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useOpeningGuides, usePlacementPreview } from '@pascal-app/editor'
import { generateRoofSegmentGeometry, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import type { ComponentType } from 'react'
import {
  DoubleSide,
  type Intersection,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  Vector3,
} from 'three'
import { installMountedScene, LevelScene, mount, SceneSystems, settle } from '../__tests__/harness'
import { builtinPlugin } from '../index'
import RoofSystems from '../roof/system'
import { roofElementAtClick } from './roof-segment-hit'

installMountedScene()
beforeEach(() => {
  useOpeningGuides.getState().clear()
  usePlacementPreview.getState().clear()
})
afterEach(() => {
  useOpeningGuides.getState().clear()
  usePlacementPreview.getState().clear()
})

type Variant = 'opaque' | 'custom-gap' | 'trim-gap' | 'glazed-gap' | 'curved-gap'
const query = (variant: Variant): [number, number] =>
  variant === 'trim-gap' ? [3.7, 2.7] : variant === 'curved-gap' ? [3.5, 2.8] : [0, 0]
async function fixture(
  variant: Variant,
  reversed: boolean,
  transformed: boolean,
  extras: {
    accessory?: boolean
    single?: boolean
    host?: Partial<RoofSegmentNode>
    competitor?: Partial<RoofSegmentNode>
  } = {},
) {
  const accessory = extras.accessory ?? false
  const building = BuildingNode.parse({
    id: 'building_b',
    position: transformed ? [21, 7, -13] : [0, 0, 0],
    rotation: transformed ? [0, 0.43, 0] : [0, 0, 0],
    children: ['level_l'],
  })
  const level = LevelNode.parse({
    id: 'level_l',
    parentId: building.id,
    level: 0,
    children: ['roof_r'],
  })
  const roof = RoofNode.parse({
    id: 'roof_r',
    parentId: level.id,
    position: transformed ? [-2, 3, 1] : [0, 0, 0],
    rotation: transformed ? -0.31 : 0,
    children: extras.single ? ['rseg_a'] : reversed ? ['rseg_b', 'rseg_a'] : ['rseg_a', 'rseg_b'],
  })
  const a = RoofSegmentNode.parse({
    id: 'rseg_a',
    parentId: roof.id,
    roofType: 'shed',
    pitch: 0,
    width: 8,
    depth: 6,
    position: transformed ? [1, 0.7, -1] : [0, 0, 0],
    rotation: transformed ? 0.27 : 0,
    wallHeight: 2,
    wallThickness: extras.single ? 0.2 : 0,
    wallShell: extras.single ? 'include' : 'auto',
    deckThickness: 1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: accessory ? ['bvent_child'] : [],
    ...extras.host,
  })
  // In transformed cases B has its OWN distinct frame. Preserve the chosen
  // point's B-local gap membership by rotating B around that physical point.
  const delta = transformed ? 0.41 : 0
  const [qx, qz] = query(variant)
  const [bx, bz]: [number, number] = transformed && variant === 'opaque' ? [0.4, -0.3] : [qx, qz]
  const dx = qx - (Math.cos(delta) * bx + Math.sin(delta) * bz)
  const dz = qz - (-Math.sin(delta) * bx + Math.cos(delta) * bz)
  const b = RoofSegmentNode.parse({
    ...a,
    id: 'rseg_b',
    wallHeight: 2.9,
    deckThickness: 0.01,
    shingleThickness: 0.01,
    children: [],
    rotation: a.rotation + delta,
    position: [
      a.position[0] + Math.cos(a.rotation) * dx + Math.sin(a.rotation) * dz,
      a.position[1],
      a.position[2] - Math.sin(a.rotation) * dx + Math.cos(a.rotation) * dz,
    ],
    ...(variant === 'custom-gap'
      ? {
          managedByParent: false,
          shedFootprintPieces: [
            [
              [-4, -3],
              [-1, -3],
              [-1, 3],
              [-4, 3],
            ],
            [
              [1, -3],
              [4, -3],
              [4, 3],
              [1, 3],
            ],
          ],
        }
      : {}),
    ...(variant === 'trim-gap' ? { trim: { ...a.trim, frontRightX: 1, frontRightZ: 1 } } : {}),
    ...(variant === 'glazed-gap'
      ? {
          roofSystem: 'glazed',
          glazing: RoofGlazing.parse({
            across: { layout: 'count', count: 1 },
            along: { layout: 'count', count: 1 },
            panelType: 'empty',
            glazedEnds: false,
          }),
        }
      : {}),
    ...(variant === 'curved-gap' ? { arc: { centerX: 0, centerZ: -10, radius: 10 } } : {}),
    ...extras.competitor,
  })
  const child = BoxVentNode.parse({
    id: 'bvent_child',
    parentId: a.id,
    roofSegmentId: a.id,
    position: [0, 3.05, 0],
    width: 0.6,
    depth: 0.6,
    height: 0.5,
  })
  const entries: AnyNode[] = [
    building,
    level,
    roof,
    a,
    ...(extras.single ? [] : [b]),
    ...(accessory ? [child] : []),
  ]
  useScene.setState({
    nodes: Object.fromEntries(entries.map((node) => [node.id, node])),
    rootNodeIds: [building.id],
    readOnly: false,
    dirtyNodes: new Set(entries.map((node) => node.id)),
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [] })
  const renderer = await mount(
    <>
      <LevelScene building={building} level={level} posed />
      <SceneSystems />
      <RoofSystems />
    </>,
  )
  await settle(renderer, 5)
  clearSceneHistory()
  return { renderer, building, level, roof, a, b, child }
}
function roofMeshes(roof: RoofNode) {
  const object = sceneRegistry.nodes.get(roof.id)!
  object.updateWorldMatrix(true, true)
  const meshes: Mesh[] = []
  for (const name of ['merged-roof', 'painted-segments'])
    object.getObjectByName(name)?.traverseVisible((child) => {
      if ((child as Mesh).isMesh && (child as Mesh).geometry.getAttribute('position')?.count)
        meshes.push(child as Mesh)
    })
  expect(meshes.length).toBeGreaterThan(0)
  return meshes
}
function covering(f: Awaited<ReturnType<typeof fixture>>, point: [number, number]) {
  const segment = sceneRegistry.nodes.get(f.a.id)!
  segment.updateWorldMatrix(true, false)
  const origin = segment.localToWorld(new Vector3(point[0], 100, point[1]))
  const ray = new Raycaster(origin, new Vector3(0, -1, 0))
  const hit = ray
    .intersectObjects(roofMeshes(f.roof), false)
    .find((entry) => (entry.face?.normal.y ?? 0) > 0.1)
  if (!hit) throw new Error('Expected an actual committed native roof covering triangle')
  return { ray, hit, local: segment.worldToLocal(hit.point.clone()) }
}
function proveCompetitor(segment: RoofSegmentNode, point: [number, number], present: boolean) {
  // Separate native B construction proves that its gap is intrinsic, not
  // merely hidden/clipped by A in the committed merged scene.
  const geometry = generateRoofSegmentGeometry(segment)
  const materials = Array.from({ length: 8 }, () => new MeshBasicMaterial({ side: DoubleSide }))
  const mesh = new Mesh(geometry, materials)
  mesh.updateMatrixWorld(true)
  try {
    const hit = new Raycaster(new Vector3(point[0], 100, point[1]), new Vector3(0, -1, 0))
      .intersectObject(mesh)
      .find((entry) => (entry.face?.normal.y ?? 0) > 0.1)
    expect(Boolean(hit)).toBe(present)
    if (hit) expect(Math.abs(hit.point.y - 2.92)).toBeLessThan(0.00002)
  } finally {
    geometry.dispose()
    for (const material of materials) material.dispose()
  }
}
function event(roof: RoofNode, hit: Intersection<Object3D>, ray: Raycaster): RoofEvent {
  // All spatial witness data comes from the actual native-mesh Raycaster hit.
  // The event wrapper follows useNodeEvents; it is not a fabricated face/index.
  return {
    node: roof,
    position: hit.point.toArray(),
    localPosition: hit.object.worldToLocal(hit.point.clone()).toArray(),
    object: hit.object,
    normal: hit.face?.normal.toArray(),
    faceIndex: hit.faceIndex ?? undefined,
    stopPropagation() {},
    nativeEvent: {
      ...hit,
      ray: ray.ray,
      eventObject: sceneRegistry.nodes.get(roof.id),
      stopPropagation() {},
    } as RoofEvent['nativeEvent'],
  }
}
async function send(type: 'roof:move' | 'roof:click', payload: RoofEvent) {
  await act(async () => {
    emitter.emit(type, payload)
  })
}

for (const variant of ['opaque', 'custom-gap', 'trim-gap', 'glazed-gap', 'curved-gap'] as const) {
  for (const reversed of [false, true]) {
    for (const transformed of [false, true]) {
      test(`actual supplier ${variant}, reversed=${reversed}, transformed=${transformed}`, async () => {
        const f = await fixture(variant, reversed, transformed)
        proveCompetitor(
          f.b,
          transformed && variant === 'opaque' ? [0.4, -0.3] : query(variant),
          variant === 'opaque',
        )
        const { hit, local } = covering(f, query(variant))
        // Horizontal native SHED A: 2+1+.05=3.05; B:2.9+.01+.01=2.92.
        // The old nominal scorer prefers B (distance .15 versus1.05) although
        // A supplied the actual triangle. B's gap variants additionally prove
        // bbox/nominal coverage is insufficient, regardless of child order.
        expect(Math.abs(local.y - 3.05)).toBeLessThan(0.00002)
        if (transformed) expect(Math.abs(hit.point.y - 13.75)).toBeLessThan(0.00002)
        const before = structuredClone(useScene.getState().nodes)
        const manual = roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)
        if (!manual) throw new Error('A measured actual covering hit must be manually accepted')
        expect(manual.segmentId).toBe(f.a.id)
        expect(manual.node.parentId).toBe(f.a.id)
        expect(manual.node.roofSegmentId).toBe(f.a.id)
        manual.node.position.forEach((value, i) => {
          expect(Math.abs(value - local.toArray()[i]!)).toBeLessThan(0.00002)
        })
        if (variant === 'opaque' && !transformed) {
          expect(roofElementAtClick('box-vent', f.roof, hit.point.toArray())?.segmentId).toBe(
            f.a.id,
          )
        }
        expect(useScene.getState().nodes).toEqual(before)
        await f.renderer.unmount()
      })
    }
  }
}

test('a genuine lower covering hit remains placeable under a vertically separated shed', async () => {
  // Native shed siblings do not subtract interior cutters. The two disjoint
  // assemblies therefore retain both coverings in the actual merged mesh.
  const f = await fixture('opaque', true, false, { competitor: { position: [0, 20, 0] } })
  const segment = sceneRegistry.nodes.get(f.a.id)!
  segment.updateWorldMatrix(true, false)
  // Start below B (22.92m) and above A (3.05m), as an oblique/under-roof click can.
  const ray = new Raycaster(segment.localToWorld(new Vector3(0, 10, 0)), new Vector3(0, -1, 0))
  const hit = ray
    .intersectObjects(roofMeshes(f.roof), false)
    .find((entry) => (entry.face?.normal.y ?? 0) > 0.1)
  if (!hit) throw new Error('The committed native mesh must retain the lower shed covering')
  const local = segment.worldToLocal(hit.point.clone())
  expect(Math.abs(local.y - 3.05)).toBeLessThan(0.00002)
  expect(getRoofSegmentCoveringSeat(f.roof, f.a, [0, 0], useScene.getState().nodes)).toEqual({
    status: 'unmeasured',
    reason: 'roof-intersection',
    nodeIds: [f.b.id],
  })
  const before = structuredClone(useScene.getState().nodes)
  expect(roofElementAtClick('box-vent', f.roof, hit.point.toArray())).toBeNull()
  const manual = roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)
  if (!manual) throw new Error('A genuine surviving lower covering witness must remain placeable')
  expect(manual.segmentId).toBe(f.a.id)
  expect(manual.node).toMatchObject({ parentId: f.a.id, roofSegmentId: f.a.id })
  manual.node.position.forEach((value, i) => {
    expect(value).toBeCloseTo(local.toArray()[i]!, 8)
  })
  expect(useScene.getState().nodes).toEqual(before)
  await f.renderer.unmount()
})

test('a genuine lower gable ridge witness survives unchanged snapping under a raised shed', async () => {
  const f = await fixture('opaque', true, false, {
    host: { roofType: 'gable', pitch: 45, deckThickness: 0.25, shingleThickness: 0.05 },
    competitor: { roofType: 'shed', pitch: 0, position: [0, 20, 0] },
  })
  try {
    // Shed siblings do not cut the lower gable. Start between the assemblies:
    // the lower finished ridge is 2 + 3 + .30/cos(45), the upper shed 22.92m.
    const ray = new Raycaster(new Vector3(0.5, 10, 0), new Vector3(0, -1, 0))
    const hit = ray
      .intersectObjects(roofMeshes(f.roof), false)
      .find((entry) => (entry.face?.normal.y ?? 0) > 0.1)
    if (!hit) throw new Error('Expected a surviving native lower gable ridge triangle')
    const local = sceneRegistry.nodes.get(f.a.id)!.worldToLocal(hit.point.clone())
    expect(local.x).toBeCloseTo(0.5, 8)
    expect(local.z).toBeCloseTo(0, 8)
    expect(Math.abs(local.y - (5 + 0.3 * Math.SQRT2))).toBeLessThan(0.00002)
    const before = structuredClone(useScene.getState().nodes)
    const hidden = {
      status: 'unmeasured',
      reason: 'roof-intersection',
      nodeIds: [f.b.id],
    }
    expect(getRoofSegmentCoveringSeat(f.roof, f.a, [0.5, 0], before)).toEqual(hidden)
    expect(roofElementAtClick('ridge-vent', f.roof, hit.point.toArray())).toBeNull()
    expect(
      roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)?.segmentId,
    ).toBe(f.a.id)

    const def = builtinPlugin.nodes!.find((entry) => entry.kind === 'ridge-vent')!
    const Tool = (await def.tool!()).default as ComponentType
    const tool = await mount(<Tool />)
    try {
      const payload = event(f.roof, hit, ray)
      await send('roof:move', payload)
      expect(useOpeningGuides.getState().guides.length).toBeGreaterThan(0)
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      await send('roof:click', payload)
      const created = Object.values(useScene.getState().nodes).filter((node) => !before[node.id])
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({
        type: 'ridge-vent',
        parentId: f.a.id,
        roofSegmentId: f.a.id,
        position: [0.5, 0, 0],
      })
      expect(useOpeningGuides.getState().guides).toEqual([])
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => {
        useScene.temporal.getState().undo()
      })
      expect(useScene.getState().nodes).toEqual(before)
    } finally {
      await tool.unmount()
    }
    const manual = roofElementAtClick('ridge-vent', f.roof, hit.point.toArray(), undefined, hit)
    expect(manual?.node).toMatchObject({
      parentId: f.a.id,
      roofSegmentId: f.a.id,
      position: [0.5, 0, 0],
    })
    // A witnessed human hit is not permission to relax pure covering queries.
    expect(getRoofSegmentCoveringSeat(f.roof, f.a, [0.5, 0], useScene.getState().nodes)).toEqual(
      hidden,
    )
  } finally {
    await f.renderer.unmount()
  }
})

test('bare off-surface XYZ is not an exceptional fallback witness', async () => {
  const f = await fixture('opaque', true, true)
  const segment = sceneRegistry.nodes.get(f.a.id)!
  const falsePoint = segment.localToWorld(new Vector3(0, 0.5, 0))
  expect(roofElementAtClick('box-vent', f.roof, falsePoint.toArray())).toBeNull()
  await f.renderer.unmount()
})

test('real registered vertical roof triangle is accepted only with its genuine witness', async () => {
  const f = await fixture('opaque', false, true, { single: true })
  const segment = sceneRegistry.nodes.get(f.a.id)!
  const origin = segment.localToWorld(new Vector3(0, 0.5, 100))
  const end = segment.localToWorld(new Vector3(0, 0.5, 0))
  const ray = new Raycaster(origin, end.sub(origin).normalize())
  const hit = ray
    .intersectObjects(roofMeshes(f.roof), false)
    .find((entry) => Math.abs(entry.face?.normal.y ?? 1) < 0.00001)
  if (!hit) throw new Error('Native merged roof must actually render a vertical outer wall')
  const local = segment.worldToLocal(hit.point.clone())
  // Native wall volume expands the centre-line depth by wallThickness:
  // the positive outer face is 6/2 + .2/2 = 3.1, not the centre line3.
  // Float32 geometry is checked separately from preserving the actual hit.
  ;[0, 0.5, 3.1].forEach((value, i) => {
    expect(Math.abs(local.toArray()[i]! - value)).toBeLessThan(0.00002)
  })
  expect(roofElementAtClick('box-vent', f.roof, hit.point.toArray())).toBeNull()
  const accepted = roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)
  if (!accepted) throw new Error('Native genuine vertical route must remain available')
  expect(accepted.segmentId).toBe(f.a.id)
  expect(accepted.node.position[1]).toBeCloseTo(0.5, 8)
  accepted.node.position.forEach((value, i) => {
    expect(value).toBeCloseTo(local.toArray()[i]!, 8)
  })
  const displaced = hit.point.clone().add(new Vector3(0, 0.2, 0))
  expect(roofElementAtClick('box-vent', f.roof, displaced.toArray(), undefined, hit)).toBeNull()
  expect(
    roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, {
      ...hit,
      faceIndex: Number.MAX_SAFE_INTEGER,
    }),
  ).toBeNull()
  expect(
    roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, {
      ...hit,
      object: hit.object.clone(false),
    }),
  ).toBeNull()
  await f.renderer.unmount()
})

test('a genuine native skylight CSG cut face preserves its raw manual hit with a roof witness', async () => {
  const f = await fixture('opaque', false, false, { single: true })
  // Use a .3m finished assembly so the native2m-tall cutter passes through
  // the full roof thickness: bare2, deck top2.25, finished covering2.3.
  const host = RoofSegmentNode.parse({ ...f.a, deckThickness: 0.25, shingleThickness: 0.05 })
  await act(async () => {
    useScene.setState({ nodes: { ...useScene.getState().nodes, [host.id]: host } })
    useScene.getState().markDirty(host.id)
    useScene.getState().markDirty(f.roof.id)
  })
  await settle(f.renderer, 5)
  expect(Math.abs(covering(f, [0, 0]).local.y - 2.3)).toBeLessThan(0.00002)

  // Native buildSkylightRoofCut uses pane +2*frame +2*offset, without yaw
  // or tilt here: width1+.2+.1=1.3, depth1.2+.2+.1=1.5.
  // Its positive-X inner wall is therefore x=.65; y2.15 is inside the
  // physical deck AND inside the cutter interval[1.3,3.3].
  const skylight = SkylightNode.parse({
    id: 'skylight_cut',
    parentId: host.id,
    roofSegmentId: host.id,
    position: [0, 2.3, 0],
    rotation: 0,
    width: 1,
    height: 1.2,
    frameThickness: 0.1,
    cutoutOffset: 0.05,
  })
  const cutHost = { ...host, children: [skylight.id] }
  await act(async () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [host.id]: cutHost,
        [skylight.id]: skylight,
      },
    })
    useScene.getState().markDirty(skylight.id)
    useScene.getState().markDirty(host.id)
    useScene.getState().markDirty(f.roof.id)
  })
  await settle(f.renderer, 5)
  const meshes = roofMeshes(f.roof)
  const centerHits = new Raycaster(new Vector3(0, 100, 0), new Vector3(0, -1, 0)).intersectObjects(
    meshes,
    false,
  )
  expect(centerHits.some((hit) => Math.abs(hit.point.y - 2.3) < 0.00002)).toBe(false)
  expect(Math.abs(covering(f, [2, 0]).local.y - 2.3)).toBeLessThan(0.00002)

  // Intersect the committed roof subtraction, not the accessory's frame,
  // a standalone cutter box or the hidden segment editing placeholder.
  const ray = new Raycaster(new Vector3(0, 2.15, 0), new Vector3(1, 0, 0))
  const hit = ray.intersectObjects(meshes, false)[0]
  if (!hit?.face) throw new Error('Native roof CSG must produce a real inner cut-wall triangle')
  expect(Math.abs(hit.face.normal.y)).toBeLessThan(0.00001)
  expect(hit.face.normal.x).toBeLessThan(-0.99)
  const local = sceneRegistry.nodes.get(host.id)!.worldToLocal(hit.point.clone())
  const anchor = [0.65, 2.15, 0]
  anchor.forEach((value, i) => {
    expect(Math.abs(local.toArray()[i]! - value)).toBeLessThan(0.00002)
  })

  // Query strictly INSIDE the hole, not at a Float32-rounded rim boundary.
  // Strict covering support cannot manufacture a finished top seat there.
  const nodes = useScene.getState().nodes
  const strict = getRoofSegmentCoveringSeat(f.roof, cutHost, [0, 0], nodes)
  expect(['miss', 'unmeasured']).toContain(strict.status)
  if (strict.status === 'unmeasured') {
    expect(strict.reason).toBe('accessory-cut')
    expect(strict.nodeIds).toContain(skylight.id)
  } else if (strict.status === 'miss') {
    expect(strict.reason).toBe('outside-surface')
  }
  const before = structuredClone(nodes)
  const accepted = roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)
  if (!accepted)
    throw new Error('Genuine single-host CSG cut faces must retain the native manual route')
  expect(accepted.segmentId).toBe(host.id)
  expect(accepted.node).toMatchObject({ parentId: host.id, roofSegmentId: host.id })
  accepted.node.position.forEach((value, i) => {
    expect(value).toBeCloseTo(local.toArray()[i]!, 8)
  })
  expect(roofElementAtClick('box-vent', f.roof, hit.point.toArray())).toBeNull()
  expect(useScene.getState().nodes).toEqual(before)
  await f.renderer.unmount()
})

for (const kind of [
  'chimney',
  'skylight',
  'solar-panel',
  'cupola',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
] satisfies RoofElementKind[]) {
  test(`${kind}: the genuine native vertical event survives tool forwarding with one undo`, async () => {
    const f = await fixture('opaque', false, true, { single: true })
    const segment = sceneRegistry.nodes.get(f.a.id)!
    const origin = segment.localToWorld(new Vector3(0, 0.5, 100))
    const target = segment.localToWorld(new Vector3(0, 0.5, 0))
    const ray = new Raycaster(origin, target.sub(origin).normalize())
    const hit = ray
      .intersectObjects(roofMeshes(f.roof), false)
      .find((entry) => Math.abs(entry.face?.normal.y ?? 1) < 0.00001)
    if (!hit) throw new Error('Expected a native vertical roof intersection')
    const local = segment.worldToLocal(hit.point.clone())
    // Independent outer-wall anchor includes the native half-thickness.
    ;[0, 0.5, 3.1].forEach((value, i) => {
      expect(Math.abs(local.toArray()[i]! - value)).toBeLessThan(0.00002)
    })
    const def = builtinPlugin.nodes!.find((entry) => entry.kind === kind)!
    const Tool = (await def.tool!()).default as ComponentType
    const tool = await mount(<Tool />)
    const before = structuredClone(useScene.getState().nodes)
    const payload = event(f.roof, hit, ray)
    await send('roof:move', payload)
    expect(useScene.getState().nodes).toEqual(before)
    await send('roof:click', payload)
    const created = Object.values(useScene.getState().nodes).filter((node) => !before[node.id])
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ type: kind, parentId: f.a.id, roofSegmentId: f.a.id })
    const position = (created[0] as { position: [number, number, number] }).position
    if (kind === 'ridge-vent') {
      // Native shed high eave = -(depth/2 + wallThickness/2) here;
      // zero pitch/overhang/trim add no further plan extension.
      expect(position[0]).toBeCloseTo(local.x, 8)
      expect(position[1]).toBe(0)
      expect(position[2]).toBeCloseTo(-3.1, 8)
    } else {
      // Preserve the actual Float32-intersected point, not an idealized3.1.
      position.forEach((value, i) => {
        expect(value).toBeCloseTo(local.toArray()[i]!, 8)
      })
    }
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => {
      useScene.temporal.getState().undo()
    })
    expect(useScene.getState().nodes).toEqual(before)
    await tool.unmount()
    expect(useOpeningGuides.getState().guides).toEqual([])
    await f.renderer.unmount()
  })
}

test('a genuine covering witness cannot authorize a ridge snap beyond the authored shed', async () => {
  const f = await fixture('opaque', false, false, {
    single: true,
    host: {
      wallThickness: 0,
      managedByParent: false,
      shedFootprintPieces: [
        [
          [-4, -1],
          [4, -1],
          [4, 3],
          [-4, 3],
        ],
      ],
    },
  })
  // The native high-eave snap is z=-3, outside the stored z=[-1,3] piece.
  // A real covering ray hit at z=1 proves only the cursor, not its later snap.
  const { hit, ray, local } = covering(f, [0.5, 1])
  expect(Math.abs(local.y - 3.05)).toBeLessThan(0.00002)
  const missing = new Raycaster(new Vector3(0.5, 100, -3), new Vector3(0, -1, 0)).intersectObjects(
    roofMeshes(f.roof),
    false,
  )
  expect(missing).toHaveLength(0)
  expect(
    roofElementAtClick('box-vent', f.roof, hit.point.toArray(), undefined, hit)?.segmentId,
  ).toBe(f.a.id)
  expect(roofElementAtClick('ridge-vent', f.roof, hit.point.toArray(), undefined, hit)).toBeNull()

  const def = builtinPlugin.nodes!.find((entry) => entry.kind === 'ridge-vent')!
  const Tool = (await def.tool!()).default as ComponentType
  const tool = await mount(<Tool />)
  const before = structuredClone(useScene.getState().nodes)
  const payload = event(f.roof, hit, ray)
  await send('roof:move', payload)
  expect(useOpeningGuides.getState().guides).toEqual([])
  await send('roof:click', payload)
  expect(useScene.getState().nodes).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  await tool.unmount()
  await f.renderer.unmount()
})

for (const kind of ['box-vent', 'chimney'] as const) {
  test(`${kind}: an accessory-child hit clears a prior valid preview and cannot authorize a roof fallback`, async () => {
    const f = await fixture('opaque', true, false, { accessory: true })
    const childObject = sceneRegistry.nodes.get(f.child.id)
    if (!childObject) throw new Error('Expected the actual native accessory renderer')
    childObject.updateWorldMatrix(true, true)
    const ray = new Raycaster(new Vector3(0, 100, 0), new Vector3(0, -1, 0))
    const hit = ray.intersectObject(childObject, true)[0]
    if (!hit) throw new Error('Expected a real accessory surface intersection')
    expect(hit.point.y).toBeGreaterThan(3.05 + 0.01)
    expect(roofElementAtClick(kind, f.roof, hit.point.toArray(), undefined, hit)).toBeNull()
    const def = builtinPlugin.nodes!.find((entry) => entry.kind === kind)!
    const Tool = (await def.tool!()).default as ComponentType
    const tool = await mount(<Tool />)
    const before = structuredClone(useScene.getState().nodes)
    // Establish a real prior preview so "return on invalid hit" cannot pass by
    // leaving an already-empty store untouched. This roof point avoids the child.
    const valid = covering(f, [2, 0])
    await send('roof:move', event(f.roof, valid.hit, valid.ray))
    expect(useOpeningGuides.getState().guides.length).toBeGreaterThan(0)
    if (kind === 'chimney') expect(usePlacementPreview.getState().node?.type).toBe(kind)
    expect(useScene.getState().nodes).toEqual(before)
    const payload = event(f.roof, hit, ray)
    await send('roof:move', payload)
    expect(useOpeningGuides.getState().guides).toEqual([])
    expect(usePlacementPreview.getState().node).toBeNull()
    await send('roof:click', payload)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await tool.unmount()
    await f.renderer.unmount()
  })
}
