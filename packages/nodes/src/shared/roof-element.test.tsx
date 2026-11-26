import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  buildRoofElementNode,
  clearSceneHistory,
  emitter,
  LevelNode,
  type RoofElementKind,
  type RoofEvent,
  RoofGlazing,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { addRoofElement } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { useOpeningGuides, usePlacementPreview } from '@pascal-app/editor'
import { generateRoofSegmentGeometry, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import type { ComponentType } from 'react'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { builtinPlugin } from '../index'
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

const kinds: RoofElementKind[] = [
  'chimney',
  'skylight',
  'solar-panel',
  'cupola',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
]
const forms = [
  'hip',
  'gable',
  'shed',
  'gambrel',
  'dutch',
  'mansard',
  'flat',
  'conical',
  'barrel',
] as const

function fixture(overrides: Partial<RoofSegmentNode> = {}) {
  const building = BuildingNode.parse({
    id: 'building_native',
    position: [31, 8, -19],
    rotation: [0, 0.35, 0],
    children: ['level_roof'],
  })
  const level = LevelNode.parse({
    id: 'level_roof',
    parentId: building.id,
    children: ['roof_native'],
  })
  const roof = RoofNode.parse({
    id: 'roof_native',
    parentId: level.id,
    position: [2, 1, -3],
    rotation: -0.4,
    children: ['rseg_native'],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_native',
    parentId: roof.id,
    position: [-1, 0.7, 2],
    rotation: 0.6,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 30,
    wallHeight: 2,
    children: [],
    ...overrides,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment].map((node) => [node.id, node]),
  )
  useScene.setState({ nodes, rootNodeIds: [building.id], readOnly: false, dirtyNodes: new Set() })
  const buildingObject = new Group()
  buildingObject.position.fromArray(building.position)
  buildingObject.rotation.set(...building.rotation)
  const levelObject = new Group()
  levelObject.position.y = 6
  const roofObject = new Group()
  roofObject.position.fromArray(roof.position)
  roofObject.rotation.y = roof.rotation
  const segmentObject = new Group()
  segmentObject.position.fromArray(segment.position)
  segmentObject.rotation.y = segment.rotation
  buildingObject.add(levelObject)
  levelObject.add(roofObject)
  roofObject.add(segmentObject)
  buildingObject.updateMatrixWorld(true)
  for (const [id, object] of [
    [building.id, buildingObject],
    [level.id, levelObject],
    [roof.id, roofObject],
    [segment.id, segmentObject],
  ] as const)
    sceneRegistry.nodes.set(id, object)
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [] })
  clearSceneHistory()
  return { building, level, roof, segment, segmentObject }
}

// Native rendered covering triangles, not the new core seat helper, supply the
// physical click. The gable normal also has an independent trigonometric check.
// This CPU geometry observation is not browser/GPU evidence.
function coveringHit(segment: RoofSegmentNode, x = 0.75, z = 1.5) {
  const geometry = generateRoofSegmentGeometry(segment)
  const materials = Array.from({ length: 8 }, () => new MeshBasicMaterial({ side: DoubleSide }))
  const mesh = new Mesh(geometry, materials)
  mesh.updateMatrixWorld(true)
  try {
    const hits = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObject(mesh)
    const hit = hits.find((entry) => entry.face?.materialIndex === 3 && entry.face.normal.y > 0)
    if (!hit?.face) throw new Error(`No actual ${segment.roofType} covering at [${x}, ${z}]`)
    return { point: hit.point.clone(), normal: hit.face.normal.clone() }
  } finally {
    geometry.dispose()
    for (const material of materials) material.dispose()
  }
}

function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 8)
  })
}

function closeRenderedPosition(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(3)
  expect(actual[0]).toBeCloseTo(expected[0]!, 8)
  expect(actual[2]).toBeCloseTo(expected[2]!, 8)
  // Native BufferGeometry stores Float32 vertices. For this bounded (<100 m)
  // fixture, 20 micrometres covers representation/intersection roundoff, not a
  // physical seating offset, trim allowance or configurable production epsilon.
  expect(Math.abs(actual[1]! - expected[1]!)).toBeLessThanOrEqual(0.00002)
}

function comparable(node: AnyNode) {
  const { id: _id, ...rest } = node
  // Compare position separately: world/local matrix arithmetic is double precision.
  return { ...rest, position: undefined }
}

async function send(type: 'roof:move' | 'roof:click', roof: RoofNode, world: Vector3) {
  await act(async () => {
    emitter.emit(type, {
      node: roof,
      position: world.toArray(),
      nativeEvent: {},
      stopPropagation() {},
    } as RoofEvent)
  })
}

async function mountTool(kind: RoofElementKind) {
  const definition = builtinPlugin.nodes!.find((entry) => entry.kind === kind)
  if (!definition?.tool) throw new Error(`Missing native placement tool for ${kind}`)
  const Tool = (await definition.tool()).default as ComponentType
  return mount(<Tool />)
}

describe('roof element manual adapter', () => {
  for (const roofType of forms) {
    test(`${roofType} consumes a real native covering hit in the registered world frame`, () => {
      const f = fixture({ roofType, ...(roofType === 'barrel' ? { barrelSegments: 7 } : {}) })
      const hit = coveringHit(f.segment)
      const world = f.segmentObject.localToWorld(hit.point.clone())
      const before = structuredClone(useScene.getState().nodes)
      const result = roofElementAtClick('chimney', f.roof, world.toArray())
      expect(result).not.toBeNull()
      if (!result) throw new Error('A witnessed native top hit must construct its accessory')
      expect(result.segmentId).toBe(f.segment.id)
      expect(result.node).toMatchObject({ parentId: f.segment.id, roofSegmentId: f.segment.id })
      closeRenderedPosition(result.node.position, hit.point.toArray())
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })
  }

  test('forwards the optional name and both solar array limits', () => {
    const f = fixture()
    const world = f.segmentObject.localToWorld(coveringHit(f.segment).point)
    const result = roofElementAtClick('solar-panel', f.roof, world.toArray(), {
      name: 'North array',
      rows: 20,
      columns: 1,
    })
    expect(result?.node).toMatchObject({ name: 'North array', rows: 20, columns: 1 })
  })

  test('does not invent a host when the clicked roof has no segments', () => {
    const f = fixture()
    const empty = { ...f.roof, children: [] }
    useScene.setState({ nodes: { ...useScene.getState().nodes, [empty.id]: empty } })
    const before = structuredClone(useScene.getState().nodes)
    expect(roofElementAtClick('chimney', empty, [0, 0, 0])).toBeNull()
    expect(useScene.getState().nodes).toEqual(before)
  })
})

describe('strict operation against actual native covering triangles', () => {
  for (const roofType of forms) {
    test(`${roofType} stores the physical covering seat through the strict operation`, () => {
      const f = fixture({ roofType, ...(roofType === 'barrel' ? { barrelSegments: 7 } : {}) })
      const hit = coveringHit(f.segment)
      const world = f.segmentObject.localToWorld(hit.point.clone())
      const levelObject = sceneRegistry.nodes.get(f.level.id)
      if (!levelObject) throw new Error('Expected registered roof-parent frame')
      const levelPoint = levelObject.worldToLocal(world)
      const outcome = addRoofElement(
        useScene.getState().nodes,
        {
          kind: 'chimney',
          id: f.segment.id,
          point: [levelPoint.x, levelPoint.z],
        },
        { activeLevelId: null },
      )
      const node = outcome.changes?.create?.[0]?.node
      if (node?.type !== 'chimney') throw new Error('Expected one native chimney construction')
      expect(outcome.changes?.create).toHaveLength(1)
      expect(node).toMatchObject({ parentId: f.segment.id, roofSegmentId: f.segment.id })
      closeRenderedPosition(node.position, hit.point.toArray())
    })
  }

  test('a stored shed piece physically ends before the nominal high-eave snap', () => {
    const f = fixture({
      roofType: 'shed',
      width: 8,
      depth: 6,
      managedByParent: false,
      wallThickness: 0,
      overhang: 0,
      gableOverhang: 0,
      shedFootprintPieces: [
        [
          [-4, -1],
          [4, -1],
          [4, 3],
          [-4, 3],
        ],
      ],
    })
    const geometry = generateRoofSegmentGeometry(f.segment)
    const materials = Array.from({ length: 8 }, () => new MeshBasicMaterial({ side: DoubleSide }))
    const mesh = new Mesh(geometry, materials)
    mesh.updateMatrixWorld(true)
    try {
      for (const [z, supported] of [
        [1, true],
        [-3, false],
      ] as const) {
        const hits = new Raycaster(new Vector3(0.5, 100, z), new Vector3(0, -1, 0))
          .intersectObject(mesh)
          .filter((entry) => (entry.face?.normal.y ?? 0) > 0.1)
        expect(hits.length > 0).toBe(supported)
        if (supported) {
          const world = f.segmentObject.localToWorld(hits[0]!.point.clone())
          expect(roofElementAtClick('ridge-vent', f.roof, world.toArray())).toBeNull()
        }
      }
    } finally {
      geometry.dispose()
      for (const material of materials) material.dispose()
    }
  })

  test('bare lower XYZ cannot bypass covering exposure while roof targeting chooses the highest', () => {
    const f = fixture()
    const upper = RoofSegmentNode.parse({
      ...f.segment,
      id: 'rseg_upper',
      position: [f.segment.position[0], f.segment.position[1] + 20, f.segment.position[2]],
    })
    // Vertical separation does not waive the strict covering-exposure guard.
    // Standalone geometry supplies coordinates, not a committed scene witness;
    // genuine lower rendered-hit acceptance is covered by the mounted suite.
    const roof = { ...f.roof, children: [upper.id, f.segment.id] }
    useScene.setState({
      nodes: { ...useScene.getState().nodes, [roof.id]: roof, [upper.id]: upper },
    })
    const upperObject = new Group()
    upperObject.position.fromArray(upper.position)
    upperObject.rotation.y = upper.rotation
    sceneRegistry.nodes.get(roof.id)!.add(upperObject)
    upperObject.updateWorldMatrix(true, true)
    sceneRegistry.nodes.set(upper.id, upperObject)
    const hit = coveringHit(f.segment)
    const world = f.segmentObject.localToWorld(hit.point.clone())
    const manual = roofElementAtClick('box-vent', roof, world.toArray())
    expect(manual).toBeNull()
    const levelPoint = sceneRegistry.nodes.get(f.level.id)!.worldToLocal(world.clone())
    const agent = addRoofElement(
      useScene.getState().nodes,
      {
        kind: 'box-vent',
        id: roof.id,
        point: [levelPoint.x, levelPoint.z],
      },
      { activeLevelId: null },
    )
    expect(agent.result.segmentId).toBe(upper.id)
  })

  test('mounted ridge preview/click refuse an achieved snap outside the actual custom shed', async () => {
    const f = fixture({
      roofType: 'shed',
      width: 8,
      depth: 6,
      wallHeight: 2,
      wallThickness: 0,
      overhang: 0,
      gableOverhang: 0,
      shedFootprintPieces: [
        [
          [-4, -1],
          [4, -1],
          [4, 3],
          [-4, 3],
        ],
      ],
    })
    const world = f.segmentObject.localToWorld(coveringHit(f.segment, 0.5, 1).point)
    const before = structuredClone(useScene.getState().nodes)
    const renderer = await mountTool('ridge-vent')
    await send('roof:move', f.roof, world)
    expect(useOpeningGuides.getState().guides).toEqual([])
    await send('roof:click', f.roof, world)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await renderer.unmount()
    expect(useOpeningGuides.getState().guides).toEqual([])
  })

  test('empty glazed bay refusal and frame support agree with actual rendered geometry', () => {
    const f = fixture({
      roofType: 'gable',
      roofSystem: 'glazed',
      position: [0, 0, 0],
      rotation: 0,
      wallThickness: 0,
      overhang: 0,
      gableOverhang: 0,
      glazing: RoofGlazing.parse({
        across: { layout: 'count', count: 1 },
        along: { layout: 'count', count: 1 },
        panelType: 'empty',
        glazedEnds: false,
      }),
    })
    const geometry = generateRoofSegmentGeometry(f.segment)
    const materials = Array.from({ length: 8 }, () => new MeshBasicMaterial({ side: DoubleSide }))
    const mesh = new Mesh(geometry, materials)
    mesh.updateMatrixWorld(true)
    try {
      for (const [x, present] of [
        [0, false],
        [-5.99, true],
      ] as const) {
        const hit = new Raycaster(new Vector3(x, 100, 1), new Vector3(0, -1, 0))
          .intersectObject(mesh)
          .find((entry) => (entry.face?.normal.y ?? 0) > 0.1)
        // These are simple 30-degree top faces; the threshold only excludes vertical
        // frame walls. It is not a general roof slope eligibility rule.
        expect(Boolean(hit)).toBe(present)
        const world = f.segmentObject.localToWorld(new Vector3(x, 0, 1))
        const levelObject = sceneRegistry.nodes.get(f.level.id)!
        const levelPoint = levelObject.worldToLocal(world)
        const input = {
          kind: 'chimney' as const,
          id: f.segment.id,
          point: [levelPoint.x, levelPoint.z],
        }
        if (present) {
          const outcome = addRoofElement(useScene.getState().nodes, input, { activeLevelId: null })
          const node = outcome.changes?.create?.[0]?.node
          if (node?.type !== 'chimney' || !hit) throw new Error('Expected a supported frame seat')
          closeRenderedPosition(node.position, hit.point.toArray())
          const humanWorld = f.segmentObject.localToWorld(hit.point.clone())
          const manual = roofElementAtClick('chimney', f.roof, humanWorld.toArray())
          if (!manual) throw new Error('A real glazed frame hit must remain manually placeable')
          expect(manual.segmentId).toBe(f.segment.id)
          closeRenderedPosition(manual.node.position, hit.point.toArray())
        } else {
          // There is no native surface here. A bbox/nominal fallback must not
          // manufacture a manual owner even at the nominal plane's height.
          const phantom = f.segmentObject.localToWorld(
            new Vector3(x, 2 + 3 * Math.tan(Math.PI / 6), 1),
          )
          expect(roofElementAtClick('chimney', f.roof, phantom.toArray())).toBeNull()
          let refused = false
          try {
            addRoofElement(useScene.getState().nodes, input, { activeLevelId: null })
          } catch (error) {
            if (!isAgentRefusal(error)) throw error
            expect(error.code).toBe('roof_point_outside_segment')
            refused = true
          }
          expect(refused).toBe(true)
        }
      }
    } finally {
      geometry.dispose()
      for (const material of materials) material.dispose()
    }
  })
})

describe('all eight native mounted placement tools', () => {
  for (const kind of kinds) {
    test(`${kind} previews without a write, commits native construction, cleans up, and undoes once`, async () => {
      const f = fixture()
      const hit = coveringHit(f.segment)
      // Independent normal of a thirty-degree gable front, not a helper echo.
      expect(hit.normal.x).toBeCloseTo(0, 5)
      expect(hit.normal.y).toBeCloseTo(Math.sqrt(3) / 2, 5)
      expect(hit.normal.z).toBeCloseTo(0.5, 5)
      const world = f.segmentObject.localToWorld(hit.point.clone())
      const before = structuredClone(useScene.getState().nodes)
      const renderer = await mountTool(kind)
      await send('roof:move', f.roof, world)
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useOpeningGuides.getState().guides.length).toBeGreaterThan(0)

      await send('roof:click', f.roof, world)
      const added = Object.values(useScene.getState().nodes).filter((node) => !before[node.id])
      expect(added).toHaveLength(1)
      const placed = added[0]!
      const built = buildRoofElementNode(kind, f.segment, hit.point.toArray())
      if (!built) throw new Error('The gable fixture supports every native construction')
      expect(comparable(placed)).toEqual(comparable(built))
      if (!('position' in placed)) throw new Error('A roof element must persist its position')
      closeRenderedPosition(
        placed.position as number[],
        kind === 'ridge-vent' ? [0.75, 0, 0] : hit.point.toArray(),
      )
      expect(placed.parentId).toBe(f.segment.id)
      const parent = useScene.getState().nodes[f.segment.id] as RoofSegmentNode
      expect(parent.children.filter((id) => id === placed.id)).toHaveLength(1)
      expect(useScene.getState().dirtyNodes.has(f.segment.id)).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual([placed.id])
      expect(useOpeningGuides.getState().guides).toEqual([])
      if (['chimney', 'skylight', 'solar-panel'].includes(kind))
        expect(usePlacementPreview.getState().node).toBeNull()
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      const after = structuredClone(useScene.getState().nodes)
      await renderer.unmount()
      await send('roof:click', f.roof, world)
      expect(useScene.getState().nodes).toEqual(after)
      expect(useOpeningGuides.getState().guides).toEqual([])
      await act(async () => useScene.temporal.getState().undo())
      expect(useScene.getState().nodes).toEqual(before)
      await act(async () => useScene.temporal.getState().redo())
      expect(useScene.getState().nodes).toEqual(after)
    })

    test(`${kind} unmount cancels its preview and guide state without creating history`, async () => {
      const f = fixture()
      const world = f.segmentObject.localToWorld(coveringHit(f.segment).point)
      const before = structuredClone(useScene.getState().nodes)
      const renderer = await mountTool(kind)
      await send('roof:move', f.roof, world)
      expect(useOpeningGuides.getState().guides.length).toBeGreaterThan(0)
      await renderer.unmount()
      expect(useOpeningGuides.getState().guides).toEqual([])
      expect(usePlacementPreview.getState().node).toBeNull()
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })
  }

  test('back-slope solar placement retains the native analytical normal in a transformed scene', async () => {
    const f = fixture()
    const hit = coveringHit(f.segment, 0.75, -1.5)
    const renderer = await mountTool('solar-panel')
    await send('roof:click', f.roof, f.segmentObject.localToWorld(hit.point.clone()))
    const solar = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'solar-panel',
    )
    if (solar?.type !== 'solar-panel' || !solar.surfaceNormal)
      throw new Error('Expected solar node')
    close(solar.surfaceNormal, [0, Math.sqrt(3) / 2, -0.5])
    closeRenderedPosition(solar.position, hit.point.toArray())
    await renderer.unmount()
  })

  test('ridge tool refuses a flat roof without a node or history step', async () => {
    const f = fixture({ roofType: 'flat' })
    const world = f.segmentObject.localToWorld(coveringHit(f.segment).point)
    const before = structuredClone(useScene.getState().nodes)
    const renderer = await mountTool('ridge-vent')
    await send('roof:move', f.roof, world)
    await send('roof:click', f.roof, world)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useOpeningGuides.getState().guides).toEqual([])
    await renderer.unmount()
  })
})
