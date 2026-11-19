import { expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DormerNode,
  getDormerWindowExposure,
  LevelNode,
  planDormerCreation,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { csgEvaluator, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { type Mesh, Raycaster, Vector3 } from 'three'
import { installMountedScene, LevelScene, mount, SceneSystems, settle } from '../__tests__/harness'
import RoofSystems from '../roof/system'
import WindowSystems from '../window/system'

installMountedScene()

// R4b physical acceptance: the approved native curved-host positives, not a new
// own-conical dormer shape. The cone HOST carries an ordinary flat dormer.
// Expected covering comes from the uncut, mounted native renderer, independently
// of the placement/exposure readers and of the candidate's accessory-cut path.
// This is CPU Three/R3F geometry evidence, not a GPU or browser acceptance test.
const witnesses = [
  {
    label: 'seven-facet barrel crossing the crown',
    host: { roofType: 'barrel', width: 8, depth: 8, barrelRise: 2, barrelSegments: 7 },
    centre: [0, 1],
    width: 1.21,
    height: 1,
    ownRoof: 'gable',
    yaw: 0,
    extraInterior: [0, -1],
    seamZ: -1,
  },
  {
    label: 'twelve-facet barrel crossing the crown',
    host: { roofType: 'barrel', width: 8, depth: 8, barrelRise: 2, barrelSegments: 12 },
    centre: [0, 1],
    width: 1.21,
    height: 1,
    ownRoof: 'gable',
    yaw: 0,
    extraInterior: [0, -1],
    seamZ: -1,
  },
  {
    label: 'cone apex inside the footprint',
    host: { roofType: 'conical', width: 8, depth: 8, pitch: 45 },
    centre: [1, 0],
    width: 1,
    height: 2,
    ownRoof: 'flat',
    yaw: Math.PI / 2,
    extraInterior: [0, -1],
    seamZ: -1,
  },
  {
    label: 'curved shed across native bend facets',
    host: {
      roofType: 'shed',
      width: 8,
      depth: 6,
      pitch: 30,
      arc: { centerX: 0, centerZ: -10, radius: 10 },
    },
    centre: [0, 0],
    width: 1.4,
    height: 2,
    ownRoof: 'gable',
    yaw: 0,
    extraInterior: [0.3, -0.4],
    seamZ: -1,
  },
] as const

type Witness = (typeof witnesses)[number]
type PlanPoint = readonly [number, number]
const DEPTH = 3
const PHYSICAL_EPSILON = 0.00002 // Float32/CSG evidence only; never a support allowance.
const SEAM_PROBE_HEIGHT = 0.001 // Two occupancy witnesses, not a relaxed placement tolerance.

function inSegment(witness: Witness, x: number, z: number): [number, number] {
  const c = Math.cos(witness.yaw)
  const s = Math.sin(witness.yaw)
  return [witness.centre[0] + c * x + s * z, witness.centre[1] - s * x + c * z]
}

function roofMeshes(roof: RoofNode): Mesh[] {
  const root = sceneRegistry.nodes.get(roof.id)
  if (!root) throw new Error('Missing mounted native roof')
  root.updateWorldMatrix(true, true)
  const meshes: Mesh[] = []
  // Barrel/independent segments live in painted-segments even without paint.
  // Never raycast the accessory children or hidden edit-mode placeholders.
  for (const name of ['merged-roof', 'painted-segments']) {
    root.getObjectByName(name)?.traverseVisible((object) => {
      const mesh = object as Mesh
      if (
        mesh.isMesh &&
        !mesh.geometry.userData.placeholder &&
        mesh.geometry.getAttribute('position')?.count
      ) {
        meshes.push(mesh)
      }
    })
  }
  expect(meshes.length).toBeGreaterThan(0)
  return meshes
}

function downward(meshes: Mesh[], [x, z]: PlanPoint, minimumNormalY = 0.1) {
  return new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0))
    .intersectObjects(meshes, false)
    .filter((hit) => (hit.face?.normal.y ?? 0) > minimumNormalY)
}

function coveringY(meshes: Mesh[], point: PlanPoint, minimumNormalY = 0.1) {
  const hit = downward(meshes, point, minimumNormalY)[0]
  if (!hit) throw new Error(`Native uncut covering precondition absent at ${point.join(', ')}`)
  return hit.point.y
}

function expectPosition(actual: Vector3, expected: Vector3) {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(Math.abs(actual[axis] - expected[axis])).toBeLessThan(PHYSICAL_EPSILON)
  }
}

async function fixture(
  witness: Witness,
  hostOverrides: Partial<RoofSegmentNode> = {},
  minimumNormalY = 0.1,
) {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({
    id: 'level_l',
    parentId: building.id,
    children: ['roof_r'],
  })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: [],
    ...witness.host,
    ...hostOverrides,
  })
  const nodes: Record<string, AnyNode> = {
    [building.id]: building,
    [level.id]: level,
    [roof.id]: roof,
    [segment.id]: segment,
  }
  useScene.setState({
    nodes,
    rootNodeIds: [building.id],
    dirtyNodes: new Set([segment.id, roof.id]),
    readOnly: false,
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [] })
  const renderer = await mount(
    <>
      <LevelScene building={building} level={level} />
      <SceneSystems />
      <RoofSystems />
      <WindowSystems />
    </>,
  )
  await settle(renderer, 5)

  // All reference heights are captured BEFORE the candidate pair is committed.
  // The third witness is the actual crown/apex for the barrel/cone cases.
  const before = roofMeshes(roof)
  const interior = ([[0.1, 0.1], [-0.2, 0.35], witness.extraInterior] as const).map(([x, z]) => {
    const point = inSegment(witness, x, z)
    return { point, y: coveringY(before, point, minimumNormalY) }
  })
  // Preserve the exact seam witness, its neighborhood, and the other cone
  // axes. Every point is outside the rotated dormer's actual cut footprint.
  const outsidePoints: PlanPoint[] =
    witness.host.roofType === 'conical'
      ? [
          [3, 0],
          [3, -0.01],
          [3, 0.01],
          [-3, 0],
          [0, 3],
          [0, -3],
        ]
      : [[3, 0]]
  const outside = outsidePoints.map((point) => ({
    point,
    y: coveringY(before, point, minimumNormalY),
  }))
  // Native dormer walls are 0.05m thick about the authored footprint. Probe the
  // exterior of the right wall, well away from the front opening and corners.
  const seamPoint = inSegment(witness, witness.width / 2 + 0.025, witness.seamZ)
  const seamY = coveringY(before, seamPoint, minimumNormalY)

  const result = planDormerCreation(nodes, segment, witness.centre, {
    width: witness.width,
    depth: DEPTH,
    height: witness.height,
    roofType: witness.ownRoof,
    rotation: witness.yaw,
  })
  if (!result.ok) throw new Error(`Approved physical fixture was refused: ${result.message}`)
  const { dormer, window } = result.value
  expect(dormer).toMatchObject({
    width: witness.width,
    depth: DEPTH,
    height: witness.height,
    roofType: witness.ownRoof,
    rotation: witness.yaw,
    children: [window.id],
  })
  expect(dormer.position[0]).toBe(witness.centre[0])
  expect(dormer.position[2]).toBe(witness.centre[1])
  expect(window).toMatchObject({
    parentId: dormer.id,
    dormerId: dormer.id,
    dormerFace: 'front',
    width: 0.76,
    height: 0.68,
    position: [0.02, -0.375, 0],
  })
  // Native front-face mounting, not an exposure helper's reported coordinates.
  const [wx, wz] = inSegment(witness, 0.02, DEPTH / 2)
  const windowCentre = new Vector3(wx, dormer.position[1] - 0.375, wz)
  const windowCoveringY = coveringY(before, [wx, wz], minimumNormalY)
  expect(windowCentre.y - windowCoveringY).toBeGreaterThan(0.01)

  async function commit() {
    await act(async () => {
      useScene.setState({
        nodes: {
          ...nodes,
          [segment.id]: { ...segment, children: [dormer.id] },
          [dormer.id]: dormer,
          [window.id]: window,
        },
      })
      for (const id of [segment.id, roof.id, window.id]) useScene.getState().markDirty(id)
    })
    await settle(renderer, 5)
  }
  return {
    renderer,
    building,
    level,
    nodes,
    segment,
    roof,
    dormer,
    window,
    interior,
    outside,
    seamPoint,
    seamY,
    windowCentre,
    windowCoveringY,
    commit,
  }
}

for (const witness of witnesses) {
  test(`native host cut / outside control: ${witness.label}`, async () => {
    const f = await fixture(witness)
    await f.commit()
    const after = roofMeshes(f.roof)
    for (const sample of f.interior) {
      const oldCoveringSurvives = downward(after, sample.point).some(
        (hit) => Math.abs(hit.point.y - sample.y) < PHYSICAL_EPSILON,
      )
      expect(oldCoveringSurvives).toBe(false)
    }
    // Deleting the roof, or cutting its whole face, cannot satisfy this test.
    for (const sample of f.outside) {
      expect(Math.abs(coveringY(after, sample.point) - sample.y)).toBeLessThan(PHYSICAL_EPSILON)
    }
    await f.renderer.unmount()
  })

  test(`native body seam / mounted window: ${witness.label}`, async () => {
    const f = await fixture(witness)
    const exposure = getDormerWindowExposure(f.dormer, f.window, f.segment, { nodes: f.nodes })
    expect(exposure.status).toBe('exposed')
    expect(exposure.coveringY).not.toBeNull()
    expectPosition(new Vector3(...exposure.position), f.windowCentre)
    expect(Math.abs(exposure.coveringY! - f.windowCoveringY)).toBeLessThan(PHYSICAL_EPSILON)
    await f.commit()

    const root = sceneRegistry.nodes.get(f.dormer.id)
    if (!root) throw new Error('Missing mounted native dormer')
    root.updateWorldMatrix(true, true)
    const body = root.getObjectByName('dormer-body') as Mesh | undefined
    if (!body?.isMesh) throw new Error('Missing actual committed dormer body mesh')
    expect(body.geometry.getAttribute('position').count).toBeGreaterThan(0)

    // A generic/nominal host carve must not leave a floating seam or a skirt
    // protruding under the ACTUAL curved covering. Narrow distance brackets
    // isolate the exterior wall skin, not the back wall or the sloping cut face.
    const right = new Vector3(Math.cos(witness.yaw), 0, -Math.sin(witness.yaw))
    for (const [dy, present] of [
      [SEAM_PROBE_HEIGHT, true],
      [-SEAM_PROBE_HEIGHT, false],
    ] as const) {
      const origin = new Vector3(f.seamPoint[0], f.seamY + dy, f.seamPoint[1]).addScaledVector(
        right,
        0.3,
      )
      const ray = new Raycaster(
        origin,
        right.clone().negate(),
        0.3 - PHYSICAL_EPSILON,
        0.3 + PHYSICAL_EPSILON,
      )
      expect(ray.intersectObject(body, false).length > 0).toBe(present)
    }

    const windowMesh = sceneRegistry.nodes.get(f.window.id) as Mesh | undefined
    if (!windowMesh?.isMesh) throw new Error('Missing actual mounted native child window')
    expect(windowMesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    windowMesh.updateWorldMatrix(true, true)
    expectPosition(windowMesh.getWorldPosition(new Vector3()), f.windowCentre)
    const outward = new Vector3(Math.sin(witness.yaw), 0, Math.cos(witness.yaw))
    const windowRay = new Raycaster(
      f.windowCentre.clone().addScaledVector(outward, 0.3),
      outward.clone().negate(),
      0,
      0.6,
    )
    expect(windowRay.intersectObject(windowMesh, true).length).toBeGreaterThan(0)
    // Only the front wall depth: a legitimate interior/base behind the window
    // is not an obstruction. The body must actually have its window opening.
    windowRay.near = 0.25
    windowRay.far = 0.35
    expect(windowRay.intersectObject(body, false)).toHaveLength(0)
    // Positive jamb controls prevent a missing front wall from passing as a hole.
    for (const sign of [-1, 1]) {
      const [x, z] = inSegment(witness, 0.02 + sign * (0.76 / 2 + 0.08), DEPTH / 2)
      windowRay.ray.origin.set(x, f.windowCentre.y, z).addScaledVector(outward, 0.3)
      expect(windowRay.intersectObject(body, false).length).toBeGreaterThan(0)
    }
    await f.renderer.unmount()
  })
}

test('an 85-degree full cone preserves outside covering after a localized cut', async () => {
  // cos(85 degrees) is below .1: these steep but upward-facing triangles are
  // still covering. Other fixtures retain their original normal threshold.
  const f = await fixture(witnesses[2], { pitch: 85 }, 0.01)
  await f.commit()
  const after = roofMeshes(f.roof)
  const interior = f.interior[0]!
  expect(
    downward(after, interior.point, 0.01).some(
      (hit) => Math.abs(hit.point.y - interior.y) < PHYSICAL_EPSILON,
    ),
  ).toBe(false)
  for (const sample of f.outside) {
    expect(Math.abs(coveringY(after, sample.point, 0.01) - sample.y)).toBeLessThan(PHYSICAL_EPSILON)
  }
  await f.renderer.unmount()
})

test('a full cone with an omitted wall shell stays open below the roof after a cut', async () => {
  const f = await fixture(witnesses[2], { wallShell: 'omit', wallThickness: 0.2 })
  // The whole ray is outside the dormer footprint; y1 is below the y2 wall
  // plate. Nonzero authored wall thickness must not override explicit omission.
  const ray = new Raycaster(new Vector3(5, 1, 0.2), new Vector3(-1, 0, 0), 0, 1.5)
  expect(ray.intersectObjects(roofMeshes(f.roof), false)).toHaveLength(0)
  await f.commit()
  expect(ray.intersectObjects(roofMeshes(f.roof), false)).toHaveLength(0)
  // The absence must not be achieved by dropping the actual covering.
  for (const sample of f.outside) {
    expect(Math.abs(coveringY(roofMeshes(f.roof), sample.point) - sample.y)).toBeLessThan(
      PHYSICAL_EPSILON,
    )
  }
  await f.renderer.unmount()
})

function nativeOutsideDeckEdge(meshes: Mesh[]) {
  // Native roof material contract: 0 wall/trim, 1 deck/edge, 2 interior,
  // 3 shingle. Derive a real uncut circumferential edge point and outward
  // normal, not a triangle index that tessellation could legitimately change.
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    const positions = geometry.getAttribute('position')
    for (const group of geometry.groups) {
      if (group.materialIndex !== 1) continue
      for (let offset = group.start; offset + 2 < group.start + group.count; offset += 3) {
        const vertices = [0, 1, 2].map((corner) =>
          new Vector3()
            .fromBufferAttribute(
              positions,
              geometry.index?.getX(offset + corner) ?? offset + corner,
            )
            .applyMatrix4(mesh.matrixWorld),
        )
        const [a, b, c] = vertices as [Vector3, Vector3, Vector3]
        const point = a.clone().add(b).add(c).divideScalar(3)
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
        const radial = new Vector3(point.x, 0, point.z).normalize()
        if (point.x < -3 && Math.abs(normal.y) < 0.01 && normal.dot(radial) > 0.99) {
          return { point, normal }
        }
      }
    }
  }
  throw new Error('Missing native outward-facing deck-edge precondition outside the cut')
}

test('a full cone keeps its outside deck-edge material role after a localized cut', async () => {
  const f = await fixture(witnesses[2])
  const before = roofMeshes(f.roof)
  const { point, normal } = nativeOutsideDeckEdge(before)
  const ray = new Raycaster(
    point.clone().addScaledVector(normal, 0.1),
    normal.clone().negate(),
    0,
    0.2,
  )
  const original = ray.intersectObjects(before, false)[0]
  if (!original?.face) throw new Error('Native deck edge must be actually ray-visible')
  expectPosition(original.point, point)
  expect(original.face.materialIndex).toBe(1)

  await f.commit()
  const retained = ray.intersectObjects(roofMeshes(f.roof), false)[0]
  if (!retained?.face) throw new Error('Unrelated native deck edge disappeared after the cut')
  expectPosition(retained.point, point)
  expect(retained.face.normal.dot(normal)).toBeGreaterThan(0.999)
  expect(retained.face.materialIndex).toBe(1)
  await f.renderer.unmount()
})

test('dormer CSG ignores other-building roof edits and rebuilds after its host preview commits', async () => {
  const f = await fixture(witnesses[0])
  await f.commit()
  const unrelatedBuilding = BuildingNode.parse({
    id: 'building_unrelated',
    children: ['level_unrelated'],
  })
  const unrelatedLevel = LevelNode.parse({
    id: 'level_unrelated',
    parentId: unrelatedBuilding.id,
    children: ['roof_unrelated'],
  })
  const unrelatedRoof = RoofNode.parse({
    id: 'roof_unrelated',
    parentId: unrelatedLevel.id,
    position: [30, 0, 0],
    children: ['rseg_unrelated'],
  })
  const unrelatedSegment = RoofSegmentNode.parse({
    id: 'rseg_unrelated',
    parentId: unrelatedRoof.id,
    roofType: 'gable',
    width: 8,
    depth: 8,
    wallHeight: 2,
    pitch: 35,
    wallThickness: 0,
    overhang: 0,
    gableOverhang: 0,
    children: [],
  })
  await act(async () => {
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [unrelatedBuilding.id]: unrelatedBuilding,
        [unrelatedLevel.id]: unrelatedLevel,
        [unrelatedRoof.id]: unrelatedRoof,
        [unrelatedSegment.id]: unrelatedSegment,
      },
      rootNodeIds: [...state.rootNodeIds, unrelatedBuilding.id],
    }))
    useScene.getState().markDirty(unrelatedRoof.id)
    useScene.getState().markDirty(unrelatedSegment.id)
  })
  await f.renderer.update(
    <>
      <LevelScene building={f.building} level={f.level} />
      <LevelScene building={unrelatedBuilding} level={unrelatedLevel} />
      <SceneSystems />
      <RoofSystems />
      <WindowSystems />
    </>,
  )
  await settle(f.renderer, 5)

  const body = () => {
    const mesh = sceneRegistry.nodes.get(f.dormer.id)?.getObjectByName('dormer-body') as
      | Mesh
      | undefined
    if (!mesh?.isMesh) throw new Error('Missing committed dormer body')
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    mesh.updateWorldMatrix(true, false)
    return mesh
  }
  const originalGeometry = body().geometry
  const unrelatedPoint: PlanPoint = [30, 2]
  const unrelatedBeforeY = coveringY(roofMeshes(unrelatedRoof), unrelatedPoint)
  const skinRay = new Raycaster(
    new Vector3(f.seamPoint[0] + 0.3, f.seamY + SEAM_PROBE_HEIGHT, f.seamPoint[1]),
    new Vector3(-1, 0, 0),
    0.3 - PHYSICAL_EPSILON,
    0.3 + PHYSICAL_EPSILON,
  )
  expect(skinRay.intersectObject(body(), false).length).toBeGreaterThan(0)

  // Call-through observer on the public evaluator used by native dormer CSG.
  // The roof system owns a different evaluator. Nothing is stubbed/replaced;
  // real changed covering proves the unrelated edits actually reached rendering.
  const evaluate = spyOn(csgEvaluator, 'evaluate')
  try {
    await act(async () => {
      useScene.getState().updateNode(unrelatedSegment.id, { pitch: 40 })
    })
    await settle(f.renderer, 5)
    const unrelatedCommittedY = coveringY(roofMeshes(unrelatedRoof), unrelatedPoint)
    expect(unrelatedCommittedY - unrelatedBeforeY).toBeGreaterThan(0.01)
    expect(evaluate).not.toHaveBeenCalled()
    expect(body().geometry).toBe(originalGeometry)

    evaluate.mockClear()
    await act(async () => {
      useLiveNodeOverrides.getState().set(unrelatedSegment.id, { pitch: 45 })
      // Native roof affordances publish the override and dirty the segment.
      useScene.getState().markDirty(unrelatedSegment.id)
    })
    await settle(f.renderer, 5)
    expect(
      coveringY(roofMeshes(unrelatedRoof), unrelatedPoint) - unrelatedCommittedY,
    ).toBeGreaterThan(0.01)
    expect(evaluate).not.toHaveBeenCalled()
    expect(body().geometry).toBe(originalGeometry)

    evaluate.mockClear()
    await act(async () => {
      useLiveNodeOverrides.getState().clear(unrelatedSegment.id)
      useScene.getState().markDirty(unrelatedSegment.id)
      useLiveNodeOverrides.getState().set(f.segment.id, {
        wallHeight: f.segment.wallHeight + 0.2,
      })
      useScene.getState().markDirty(f.segment.id)
    })
    await settle(f.renderer, 5)
    // Relevant live edits use the existing cheap preview, not per-frame CSG.
    expect(evaluate).not.toHaveBeenCalled()

    evaluate.mockClear()
    await act(async () => {
      useScene.getState().updateNode(f.segment.id, { wallHeight: f.segment.wallHeight + 0.2 })
      useLiveNodeOverrides.getState().clear(f.segment.id)
    })
    await settle(f.renderer, 5)
    expect(evaluate.mock.calls.length).toBeGreaterThan(0)
    expect(body().geometry).not.toBe(originalGeometry)
    expect(skinRay.intersectObject(body(), false)).toHaveLength(0)
    skinRay.ray.origin.y += 0.2
    expect(skinRay.intersectObject(body(), false).length).toBeGreaterThan(0)
  } finally {
    evaluate.mockRestore()
    await f.renderer.unmount()
  }
})

test('dormer CSG follows a genuinely pinned shed neighbor after its live preview commits', async () => {
  const building = BuildingNode.parse({ id: 'building_pin', children: ['level_pin'] })
  const level = LevelNode.parse({
    id: 'level_pin',
    parentId: building.id,
    children: ['roof_pin'],
  })
  const roof = RoofNode.parse({
    id: 'roof_pin',
    parentId: level.id,
    children: ['rseg_pin', 'rseg_neighbor'],
  })
  const host = RoofSegmentNode.parse({
    id: 'rseg_pin',
    parentId: roof.id,
    roofType: 'shed',
    width: 16,
    depth: 8,
    wallHeight: 2,
    pitch: 0,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    shedJointNeighborIds: ['curved-owner'],
    shedFootprintPieces: [
      [
        [0, -4],
        [0, 4],
        [-8, 0],
      ],
    ],
    children: ['dormer_pin'],
  })
  const neighbor = RoofSegmentNode.parse({
    id: 'rseg_neighbor',
    parentId: roof.id,
    roofType: 'shed',
    width: 8,
    depth: 8,
    wallHeight: 6,
    pitch: 0,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    arc: { centerX: 0, centerZ: 10, radius: 10 },
    shedJointOwnerId: 'curved-owner',
    shedFootprintPieces: [
      [
        [0, -4],
        [4, -4],
        [4, 4],
        [0, 4],
      ],
    ],
    children: [],
  })
  // An existing ordinary flat dormer, not a planner/own-conical extension.
  const dormer = DormerNode.parse({
    id: 'dormer_pin',
    parentId: host.id,
    roofSegmentId: host.id,
    position: [-4, 4, 0],
    rotation: -Math.PI / 2,
    width: 1.21,
    depth: 3,
    height: 2,
    roofType: 'flat',
    wallSkirtHeight: 2.73,
    children: [],
  })
  const entries: AnyNode[] = [building, level, roof, host, neighbor, dormer]
  useScene.setState({
    nodes: Object.fromEntries(entries.map((node) => [node.id, node])),
    rootNodeIds: [building.id],
    dirtyNodes: new Set(entries.map((node) => node.id)),
    readOnly: false,
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [] })
  const renderer = await mount(
    <>
      <LevelScene building={building} level={level} />
      <SceneSystems />
      <RoofSystems />
    </>,
  )
  await settle(renderer, 5)
  const body = () => {
    const mesh = sceneRegistry.nodes.get(dormer.id)?.getObjectByName('dormer-body') as
      | Mesh
      | undefined
    if (!mesh?.isMesh) throw new Error('Missing pinned-host native dormer body')
    mesh.updateWorldMatrix(true, false)
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    return mesh
  }
  const point: PlanPoint = [-4, 1.21 / 2 + 0.025]
  const originalY = coveringY(roofMeshes(roof), point)
  // Native straight-triangle/curved-neighbor pin: two x0 corners sit at 6.15,
  // the x-8 corner at 2.15. At x-4 the actual retained covering must be 4.15.
  expect(Math.abs(originalY - 4.15)).toBeLessThan(PHYSICAL_EPSILON)
  const skinRay = new Raycaster(
    new Vector3(point[0], originalY + SEAM_PROBE_HEIGHT, point[1] + 0.3),
    new Vector3(0, 0, -1),
    0.3 - PHYSICAL_EPSILON,
    0.3 + PHYSICAL_EPSILON,
  )
  expect(skinRay.intersectObject(body(), false).length).toBeGreaterThan(0)
  const originalGeometry = body().geometry
  const evaluate = spyOn(csgEvaluator, 'evaluate')
  try {
    await act(async () => {
      useLiveNodeOverrides.getState().set(neighbor.id, { wallHeight: 6.4 })
      useScene.getState().markDirty(neighbor.id)
    })
    await settle(renderer, 5)
    expect(evaluate).not.toHaveBeenCalled()

    evaluate.mockClear()
    await act(async () => {
      useScene.getState().updateNode(neighbor.id, { wallHeight: 6.4 })
      useLiveNodeOverrides.getState().clear(neighbor.id)
    })
    await settle(renderer, 5)
    expect(evaluate.mock.calls.length).toBeGreaterThan(0)
    const raisedY = coveringY(roofMeshes(roof), point)
    expect(Math.abs(raisedY - originalY - 0.2)).toBeLessThan(PHYSICAL_EPSILON)
    expect(body().geometry).not.toBe(originalGeometry)
    expect(skinRay.intersectObject(body(), false)).toHaveLength(0)
    skinRay.ray.origin.y = raisedY + SEAM_PROBE_HEIGHT
    expect(skinRay.intersectObject(body(), false).length).toBeGreaterThan(0)
  } finally {
    evaluate.mockRestore()
    await renderer.unmount()
  }
})
