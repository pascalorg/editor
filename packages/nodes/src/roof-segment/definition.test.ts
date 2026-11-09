import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  getActiveRoofHeight,
  type HandleDescriptor,
  LevelNode,
  type LinearResizeHandle,
  nodeRegistry,
  type RadialResizeHandle,
  RoofNode,
  type RoofSegmentNode,
  registerNode,
  type SceneApi,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { roofSegmentDefinition } from './definition'

function segment(overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return {
    object: 'node',
    id: 'rseg_test',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [10, 0, 20],
    rotation: 0,
    roofType: 'shed',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: 30,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    gambrelLowerWidthRatio: 0.5,
    gambrelLowerHeightRatio: 0.6,
    mansardSteepWidthRatio: 0.15,
    mansardSteepHeightRatio: 0.7,
    dutchHipWidthRatio: 0.25,
    dutchHipHeightRatio: 0.5,
    dutchWaistLengthRatio: 1,
    children: [],
    ...overrides,
  } as RoofSegmentNode
}

function handles(node: RoofSegmentNode = segment()): HandleDescriptor<RoofSegmentNode>[] {
  const descriptors = roofSegmentDefinition.handles
  return (
    typeof descriptors === 'function' ? descriptors(node, undefined as never) : descriptors
  ) as HandleDescriptor<RoofSegmentNode>[]
}

function linear(axis: 'x' | 'z', anchor: 'min' | 'max'): LinearResizeHandle<RoofSegmentNode> {
  const handle = handles().find(
    (h): h is LinearResizeHandle<RoofSegmentNode> =>
      h.kind === 'linear-resize' && h.axis === axis && h.anchor === anchor,
  )
  if (!handle) throw new Error(`Missing ${axis}/${anchor} handle`)
  return handle
}

function pitchHandle(): LinearResizeHandle<RoofSegmentNode> {
  const handle = handles().find(
    (h): h is LinearResizeHandle<RoofSegmentNode> =>
      h.kind === 'linear-resize' && h.axis === 'y' && typeof h.min === 'function',
  )
  if (!handle) throw new Error('Missing pitch handle')
  return handle
}

describe('roof-segment resize handles', () => {
  test('versions the persisted roof segment schema', () => {
    expect(roofSegmentDefinition.schemaVersion).toBe(7)
  })

  test('uses one center-anchored radius handle for a conical segment', () => {
    const node = segment({ roofType: 'conical', width: 6, depth: 6 })
    const conicalHandles = handles(node)
    const radiusHandles = conicalHandles.filter(
      (handle): handle is RadialResizeHandle<RoofSegmentNode> => handle.kind === 'radial-resize',
    )
    const sideHandles = conicalHandles.filter(
      (handle) => handle.kind === 'linear-resize' && (handle.axis === 'x' || handle.axis === 'z'),
    )
    const radiusHandle = radiusHandles[0]

    expect(radiusHandles).toHaveLength(1)
    expect(sideHandles).toHaveLength(0)
    expect(radiusHandle?.currentValue(node)).toBe(3)
    expect({ ...node, ...radiusHandle?.apply(node, 4, undefined as never) }).toMatchObject({
      width: 8,
      depth: 8,
      position: [10, 0, 20],
    })
    expect(conicalHandles.some((handle) => handle.kind === 'arc-resize')).toBe(false)
  })

  test('place shed side handles at roof level', () => {
    const node = segment()
    const roofHeight = getActiveRoofHeight(node)

    expect(linear('x', 'min').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + roofHeight / 2 + 0.15,
    )
    expect(linear('z', 'min').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + 0.15,
    )
    expect(linear('z', 'max').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + roofHeight + 0.15,
    )
  })

  test('right and left width handles resize only the dragged side', () => {
    const node = segment()
    const rightPatch = linear('x', 'min').apply(node, 10, undefined as never)
    const leftPatch = linear('x', 'max').apply(node, 10, undefined as never)

    expect(rightPatch).toMatchObject({ width: 10, position: [11, 0, 20] })
    expect(leftPatch).toMatchObject({ width: 10, position: [9, 0, 20] })
  })

  test('front and back depth handles resize only the dragged side', () => {
    const node = segment()
    const frontPatch = linear('z', 'min').apply(node, 8, undefined as never)
    const backPatch = linear('z', 'max').apply(node, 8, undefined as never)

    expect(frontPatch).toMatchObject({ depth: 8, position: [10, 0, 21] })
    expect(backPatch).toMatchObject({ depth: 8, position: [10, 0, 19] })
  })

  test('hides the pitch handle for parent-managed roof segments', () => {
    const handle = pitchHandle()
    const managed = segment({ managedByParent: true })

    expect(handle.visible?.(segment(), undefined as never)).not.toBe(false)
    expect(handle.visible?.(managed, undefined as never)).toBe(false)
  })

  test('hides all direct handles for parent-managed roof segments', () => {
    expect(handles(segment({ managedByParent: true }))).toEqual([])
  })
})

test('barrel handles preserve rise on span resize and adjust the crown without changing pitch', () => {
  const node = segment({ roofType: 'barrel', depth: 4, barrelRise: 1 })
  const resized = { ...node, ...linear('z', 'min').apply(node, 6, undefined as never) }
  expect(resized.depth).toBe(6)
  expect(getActiveRoofHeight(resized)).toBe(1)
  expect(resized.position[2] - resized.depth / 2).toBe(node.position[2] - node.depth / 2)
  const narrowed = { ...node, ...linear('z', 'min').apply(node, 1, undefined as never) }
  expect(getActiveRoofHeight(narrowed)).toBe(0.5)
  const raised = {
    ...node,
    ...pitchHandle().apply(node, node.wallHeight + 1.5, undefined as never),
  }
  expect(getActiveRoofHeight(raised)).toBe(1.5)
  expect(raised.pitch).toBe(node.pitch)
})

describe('roof-segment paint: one gable at a time', () => {
  const paint = roofSegmentDefinition.capabilities!.paint!
  const red = { preset: 'custom', properties: { color: '#aa2222' } } as const

  test('the wall-band slots resolve to the heel band and each gable', () => {
    const node = segment({ roofType: 'gable' })
    const role = (materialIndex: number) => paint.resolveRole({ node, materialIndex })
    expect([role(0), role(4), role(5), role(6)]).toEqual([
      'edge',
      'heel',
      'gable-left',
      'gable-right',
    ])
  })

  test('painting one gable leaves the other gable and the edge role alone', () => {
    const node = segment({ roofType: 'gable' })
    const patch = paint.buildPatch({
      node,
      role: 'gable-left',
      material: red,
    }) as Partial<RoofSegmentNode>
    expect(patch).toEqual({ gableLeftMaterial: red, gableLeftMaterialPreset: undefined })
    const painted = { ...node, ...patch } as RoofSegmentNode
    expect(paint.getEffectiveMaterial?.({ node: painted, role: 'gable-left' })).toEqual({
      material: red,
      materialPreset: undefined,
    })
    // the other gable still shows the edge role (here unpainted)
    expect(paint.getEffectiveMaterial?.({ node: painted, role: 'gable-right' })).toEqual({
      material: undefined,
      materialPreset: undefined,
    })
  })
})

describe('roof-segment 3D side arrows onto the walls below', () => {
  afterEach(() => {
    useInteractionScope.getState().end()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  // A room just off the grid, its roof on the Roof level, wall line x 1..11 by z 0..8.
  function scene(mode: 'grid' | 'off', thickness?: number) {
    const corners: [number, number][] = [
      [0.2, 0],
      [10.2, 0],
      [10.2, 8],
      [0.2, 8],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({ parentId: 'level_g', start, end: corners[(i + 1) % 4], thickness }),
    )
    const node = segment({ parentId: 'roof_w', position: [0, 0, 0], width: 10, depth: 8 })
    const roof = RoofNode.parse({
      id: 'roof_w',
      parentId: 'level_r',
      position: [6, 0, 4],
      children: [node.id],
    })
    const ground = LevelNode.parse({
      id: 'level_g',
      parentId: 'building_w',
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const roofLevel = LevelNode.parse({
      id: 'level_r',
      parentId: 'building_w',
      level: 1,
      children: [roof.id],
    })
    const building = BuildingNode.parse({ id: 'building_w', children: [ground.id, roofLevel.id] })
    const nodes = Object.fromEntries(
      [building, ground, roofLevel, ...walls, roof, node].map((n) => [n.id, n as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({ nodes, rootNodeIds: [building.id] } as never)
    if (!nodeRegistry.has(roofSegmentDefinition.kind)) registerNode(roofSegmentDefinition)
    useEditor.setState((state) => ({
      gridSnapStep: 0.5,
      snappingModeByContext: { ...state.snappingModeByContext, polygon: mode },
    }))
    useInteractionScope.getState().begin({ kind: 'handle-drag', nodeId: node.id, handle: 'resize' })
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
    } as unknown as SceneApi
    return { node, sceneApi }
  }

  test('the left arrow lands its side on the wall centre near it, else on the grid', () => {
    const { node, sceneApi } = scene('grid')
    const snap = linear('x', 'max').connectionSnap!
    expect(snap(node, 10.7, sceneApi)).toBeCloseTo(10.8)
    expect(snap(node, 10.3, sceneApi)).toBeCloseTo(10.5)
  })

  test('with snapping off the side follows the cursor', () => {
    const { node, sceneApi } = scene('off')
    expect(linear('x', 'max').connectionSnap!(node, 10.7, sceneApi)).toBeCloseTo(10.7)
  })

  test('sized onto the walls its gable and heel walls take their thickness, off them its own', () => {
    const { node, sceneApi } = scene('grid', 0.1826)
    const handle = linear('x', 'max')
    expect(handle.apply(node, 10.8, sceneApi).wallThickness).toBeCloseTo(0.1826)
    // A metre off the walls along z, and its left side pulled in off the wall at x 0.2.
    const off = { ...node, position: [0, 0, 1] as [number, number, number] }
    expect(handle.apply(off, 9, sceneApi).wallThickness).toBeCloseTo(0.1)
  })
})
