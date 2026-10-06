import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  getFloorPlacedElevation,
  getFloorStackedPosition,
  getStairFloorPlacedFootprints,
  getStairSegmentFloorPlacedFootprints,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  spatialGridManager,
} from '@pascal-app/core'
import { stairDefinition } from './definition'

const LEVEL_ID = 'level_test'

function makeLevel(): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: 0,
  } as AnyNode
}

function addSlab(polygon: Array<[number, number]>, elevation: number, id = `slab_${elevation}`) {
  const slab = {
    id,
    type: 'slab',
    object: 'node',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    children: [],
    polygon,
    holes: [],
    holeMetadata: [],
    elevation,
    autoFromWalls: false,
  } as SlabNode
  spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)
}

describe('stair floor-stack footprints', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
  })

  test('derives a rotated segment footprint from stair position and rotation', () => {
    const segment = StairSegmentNode.parse({
      id: 'sseg_single',
      width: 2,
      length: 4,
      height: 1,
      thickness: 0.25,
    })
    const stair = StairNode.parse({
      id: 'stair_single',
      parentId: LEVEL_ID,
      position: [10, 0, 20],
      rotation: Math.PI / 2,
      children: [segment.id],
    })

    const [footprint] = getStairSegmentFloorPlacedFootprints(stair, [segment])

    expect(footprint?.position?.[0]).toBeCloseTo(12)
    expect(footprint?.position?.[1]).toBeCloseTo(0)
    expect(footprint?.position?.[2]).toBeCloseTo(20)
    expect(footprint?.dimensions).toEqual([2, 1, 4])
    expect(footprint?.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  test('emits one footprint per chained stair segment', () => {
    const first = StairSegmentNode.parse({
      id: 'sseg_first',
      width: 2,
      length: 4,
      height: 1,
      thickness: 0.25,
    })
    const second = StairSegmentNode.parse({
      id: 'sseg_second',
      attachmentSide: 'left',
      width: 1.5,
      length: 3,
      height: 0.8,
      thickness: 0.2,
    })
    const stair = StairNode.parse({
      id: 'stair_multi',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [first.id, second.id],
    })

    const footprints = getStairSegmentFloorPlacedFootprints(stair, [first, second])

    expect(footprints).toHaveLength(2)
    expect(footprints[0]?.position).toEqual([0, 0, 2])
    expect(footprints[0]?.rotation[1]).toBeCloseTo(0)
    expect(footprints[1]?.position?.[0]).toBeCloseTo(2.5)
    expect(footprints[1]?.position?.[1]).toBeCloseTo(1)
    expect(footprints[1]?.position?.[2]).toBeCloseTo(2)
    expect(footprints[1]?.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  test('derives spiral footprints from the parent instead of retained straight segments', () => {
    const retainedSegment = StairSegmentNode.parse({
      id: 'sseg_retained_after_spiral_conversion',
      width: 1,
      length: 4,
      height: 2.8,
    })
    const spiral = StairNode.parse({
      id: 'stair_spiral_preset',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [3, 0, 4],
      innerRadius: 0.3,
      width: 1,
      stepCount: 12,
      sweepAngle: Math.PI * 2,
      children: [retainedSegment.id],
    })
    const footprints = getStairFloorPlacedFootprints(spiral, {
      [spiral.id]: spiral,
      [retainedSegment.id]: retainedSegment,
    })

    expect(footprints.length).toBeGreaterThanOrEqual(24)
    expect(
      footprints.some((footprint) => (footprint.position?.[0] ?? 0) < spiral.position[0]),
    ).toBe(true)
    expect(
      footprints.some((footprint) => (footprint.position?.[2] ?? 0) < spiral.position[2]),
    ).toBe(true)
  })

  test('keeps a columnless spiral center hole out of the support footprint', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)
    addSlab(
      [
        [-0.08, -0.08],
        [0.08, -0.08],
        [0.08, 0.08],
        [-0.08, 0.08],
      ],
      0.8,
      'slab_inside_spiral_hole',
    )

    const level = makeLevel()
    const spiral = StairNode.parse({
      id: 'stair_spiral_hole',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [0, 0, 0],
      innerRadius: 0.5,
      width: 0.8,
      stepCount: 16,
      showCenterColumn: false,
    })
    const footprints = getStairFloorPlacedFootprints(spiral, { [spiral.id]: spiral })

    expect(
      footprints.some((footprint) => {
        const position = footprint.position ?? spiral.position
        const radialDistance = Math.hypot(position[0], position[2])
        return radialDistance < spiral.innerRadius
      }),
    ).toBe(false)
    expect(
      getFloorPlacedElevation({
        node: spiral,
        nodes: { [level.id]: level, [spiral.id]: spiral },
        position: spiral.position,
        rotation: spiral.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0)
  })

  test('uses the max slab elevation across stair segment footprints', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    addSlab(
      [
        [-0.6, 1.4],
        [0.6, 1.4],
        [0.6, 2.6],
        [-0.6, 2.6],
      ],
      0.25,
      'slab_low',
    )
    addSlab(
      [
        [2.2, 1.7],
        [2.8, 1.7],
        [2.8, 2.3],
        [2.2, 2.3],
      ],
      0.75,
      'slab_high',
    )

    const level = makeLevel()
    const first = StairSegmentNode.parse({
      id: 'sseg_resolver_first',
      width: 2,
      length: 4,
      height: 1,
    })
    const second = StairSegmentNode.parse({
      id: 'sseg_resolver_second',
      attachmentSide: 'left',
      width: 1.5,
      length: 3,
      height: 0.8,
    })
    const stair = StairNode.parse({
      id: 'stair_resolver',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [first.id, second.id],
    })
    const nodes = {
      [level.id]: level,
      [stair.id]: stair,
      [first.id]: first,
      [second.id]: second,
    }

    expect(
      getFloorPlacedElevation({
        node: stair,
        nodes,
        position: stair.position,
        rotation: stair.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0.75)
  })

  test('persists the pointer-elected base across stacked slabs', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    const polygon: Array<[number, number]> = [
      [-2, -1],
      [2, -1],
      [2, 5],
      [-2, 5],
    ]
    addSlab(polygon, 0, 'slab_floor')
    addSlab(polygon, 0.8, 'slab_deck')

    const level = makeLevel()
    const segment = StairSegmentNode.parse({
      id: 'sseg_pointer_support',
      width: 1,
      length: 3,
      height: 2.8,
    })
    const stair = StairNode.parse({
      id: 'stair_pointer_support',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [segment.id],
    })
    const nodes = {
      [level.id]: level,
      [stair.id]: stair,
      [segment.id]: { ...segment, parentId: stair.id },
    }

    const underDeckPatch = resolveSupportSlabPatch(stair, nodes, { maxElevation: 0 })
    const onDeckPatch = resolveSupportSlabPatch(stair, nodes, { maxElevation: 0.8 })

    expect(underDeckPatch.supportSlabId).toBe('slab_floor')
    expect(onDeckPatch.supportSlabId).toBe('slab_deck')
    expect(
      getFloorStackedPosition({
        node: { ...stair, ...underDeckPatch },
        nodes,
        position: stair.position,
        rotation: stair.rotation,
      })[1],
    ).toBeCloseTo(0)
    expect(
      getFloorStackedPosition({
        node: { ...stair, ...onDeckPatch },
        nodes,
        position: stair.position,
        rotation: stair.rotation,
      })[1],
    ).toBeCloseTo(0.8)
  })

  test('elects a raised slab under a spiral preset footprint', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    addSlab(
      [
        [0.65, -0.35],
        [1.35, -0.35],
        [1.35, 0.35],
        [0.65, 0.35],
      ],
      0.8,
      'slab_under_spiral',
    )

    const level = makeLevel()
    const retainedSegment = StairSegmentNode.parse({
      id: 'sseg_spiral_support_retained',
      width: 0.4,
      length: 0.4,
      height: 2.8,
    })
    const spiral = StairNode.parse({
      id: 'stair_spiral_support',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [0, 0, 0],
      innerRadius: 0.3,
      width: 1,
      stepCount: 12,
      sweepAngle: Math.PI * 2,
      children: [retainedSegment.id],
    })
    const nodes = {
      [level.id]: level,
      [spiral.id]: spiral,
      [retainedSegment.id]: { ...retainedSegment, parentId: spiral.id },
    }

    expect(
      getFloorPlacedElevation({
        node: spiral,
        nodes,
        position: spiral.position,
        rotation: spiral.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0.8)
  })
})

test('painted flights retain parent slots and per-flight finishes in selected and merged bodies', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, SceneMaterial, useScene, sceneRegistry } = await import('@pascal-app/core')
  const { StairSystem, useViewer } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { act, create } = await import('@react-three/test-renderer')
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousRaf = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const red = SceneMaterial.parse({
      id: 'mat_stair_red',
      name: 'Red',
      material: { properties: { color: '#ff0000' } },
    })
    const blue = SceneMaterial.parse({
      id: 'mat_stair_blue',
      name: 'Blue',
      material: { properties: { color: '#0000ff' } },
    })
    const first = StairSegmentNode.parse({ height: 1, stepCount: 5 })
    const second = StairSegmentNode.parse({
      height: 1,
      stepCount: 5,
      slots: { treads: `scene:${blue.id}` },
      material: { properties: { color: '#00ff00' } },
    })
    const stair = StairNode.parse({
      totalRise: 2,
      children: [first.id, second.id],
      slots: { treads: `scene:${red.id}`, body: `scene:${blue.id}` },
    })
    first.parentId = stair.id
    second.parentId = stair.id
    useScene.setState({
      nodes: { [stair.id]: stair, [first.id]: first, [second.id]: second },
      rootNodeIds: [stair.id],
      dirtyNodes: new Set([stair.id, first.id, second.id]),
      materials: { mat_stair_red: red, mat_stair_blue: blue },
      readOnly: false,
    })
    useViewer.setState({ textures: true, shading: 'rendered' })
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    const segmentDefinition = builtinPlugin.nodes.find((node) => node.kind === 'stair-segment')!
    if (
      definition.renderer?.kind !== 'parametric' ||
      segmentDefinition.renderer?.kind !== 'parametric'
    )
      throw Error('Missing renderer')
    const Root = (await definition.renderer.module()).default
    renderer = await create(
      createElement(
        'group',
        null,
        createElement(Root, { node: stair }),
        createElement(StairSystem),
      ),
    )
    await renderer.advanceFrames(4, 1 / 60)
    const merged = sceneRegistry.nodes
      .get(stair.id)!
      .getObjectByName('merged-stair') as import('three').Mesh
    const materials = merged.material as import('three').MeshStandardMaterial[]
    sceneRegistry.nodes.get(stair.id)!.getObjectByName('segments-wrapper')!.visible = true
    const firstMesh = sceneRegistry.nodes.get(first.id) as import('three').Mesh
    const secondMesh = sceneRegistry.nodes.get(second.id) as import('three').Mesh
    const selectedFirst = firstMesh.material as import('three').MeshStandardMaterial[]
    const selectedSecond = secondMesh.material as import('three').MeshStandardMaterial[]
    expect(materials.map((material) => material.color.getHexString())).toEqual([
      'ff0000',
      '0000ff',
      '0000ff',
      '00ff00',
    ])
    expect(selectedFirst.map((material) => material.color.getHexString())).toEqual([
      'ff0000',
      '0000ff',
    ])
    expect(selectedSecond.map((material) => material.color.getHexString())).toEqual([
      '0000ff',
      '00ff00',
    ])
    expect(new Set(merged.geometry.groups.map((group) => group.materialIndex))).toEqual(
      new Set([0, 1, 2, 3]),
    )
    for (const group of merged.geometry.groups) {
      const role = definition.capabilities?.paint?.resolveRole?.({
        node: stair,
        hitObject: merged,
        materialIndex: group.materialIndex,
      })
      expect(role).toBe(group.materialIndex! % 2 === 0 ? 'treads' : 'body')
    }
    expect(firstMesh.userData.slotIds).toEqual(['treads', 'body'])
    const parentPreview = definition.capabilities!.paint!.applyPreview({
      node: stair,
      root: sceneRegistry.nodes.get(stair.id)!,
      role: 'treads',
      material: undefined,
      materialPreset: 'library:preset-white',
    })!
    expect(
      (merged.material as import('three').MeshStandardMaterial[])[2]!.color.getHexString(),
    ).toBe('0000ff')
    expect(
      (secondMesh.material as import('three').MeshStandardMaterial[])[0]!.color.getHexString(),
    ).toBe('0000ff')
    parentPreview()
    const paint = segmentDefinition.capabilities!.paint!
    expect(
      paint.getEffectiveMaterial!({ node: first, role: 'treads', nodes: useScene.getState().nodes })
        ?.material?.properties?.color,
    ).toBe('#ff0000')
    await act(async () =>
      useScene.getState().updateNode(first.id, { slots: { treads: `scene:${blue.id}` } }),
    )
    const paintedFirst = useScene.getState().nodes[first.id]!
    const erase = paint.applyPreview({
      node: paintedFirst,
      root: firstMesh,
      role: 'treads',
      material: undefined,
      materialPreset: undefined,
    })!
    expect(
      (firstMesh.material as import('three').MeshStandardMaterial[])[0]!.color.getHexString(),
    ).toBe('ff0000')
    erase()
    expect(
      (firstMesh.material as import('three').MeshStandardMaterial[])[0]!.color.getHexString(),
    ).toBe('0000ff')
    const orphan = StairSegmentNode.parse({})
    await act(async () =>
      useScene.setState({
        nodes: { [orphan.id]: orphan },
        rootNodeIds: [orphan.id],
        dirtyNodes: new Set([orphan.id]),
      }),
    )
    const Flight = (await segmentDefinition.renderer.module()).default
    await renderer.update(
      createElement(
        'group',
        null,
        createElement(Flight, { node: orphan }),
        createElement(StairSystem),
      ),
    )
    const orphanMesh = sceneRegistry.nodes.get(orphan.id) as import('three').Mesh
    const fallback = orphanMesh.material as import('three').MeshStandardMaterial[]
    const originalColor = fallback[1]!.color.getHexString()
    const originalRoughness = fallback[1]!.roughness
    const eraseOrphan = paint.applyPreview({
      node: orphan,
      root: orphanMesh,
      role: 'body',
      material: undefined,
      materialPreset: undefined,
    })!
    const previewMaterial = (orphanMesh.material as import('three').MeshStandardMaterial[])[1]!
    expect(previewMaterial.color.getHexString()).toBe(originalColor)
    expect(previewMaterial.roughness).toBe(originalRoughness)
    eraseOrphan()
  } finally {
    await renderer?.unmount()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    globalThis.requestAnimationFrame = previousRaf
    globalThis.cancelAnimationFrame = previousCancel
  }
})

test('stair placement preview follows raised support, survives level switches, and disposes its geometry', async () => {
  const { emitter, loadPlugin, SlabNode, spatialGridManager, useScene, BuildingNode, LevelNode } =
    await import('@pascal-app/core')
  const { ToolManager, useEditor, useAlignmentGuides } = await import('@pascal-app/editor')
  const { useViewer } = await import('@pascal-app/viewer')
  const { builtinPlugin } = await import('@pascal-app/nodes')
  const { act, create } = await import('@react-three/test-renderer')
  const { createElement } = await import('react')
  const { PerspectiveCamera } = await import('three')
  const oldScene = useScene.getState()
  const oldViewer = useViewer.getState()
  const oldEditor = useEditor.getState()
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalRaf = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const clearGuides = useAlignmentGuides.subscribe((state) => {
    if (state.guides.length) useAlignmentGuides.getState().clear()
  })
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const building = BuildingNode.parse({})
    const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
    const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
    const invalid = LevelNode.parse({ parentId: building.id, level: 2, height: 0 })
    building.children = [ground.id, upper.id, invalid.id]
    const slab = SlabNode.parse({
      parentId: ground.id,
      elevation: 0.6,
      autoFromWalls: false,
      polygon: [
        [-8, -8],
        [8, -8],
        [8, 8],
        [-8, 8],
      ],
    })
    const destination = SlabNode.parse({
      parentId: upper.id,
      elevation: 0.3,
      plateRole: 'base',
      autoFromWalls: false,
      polygon: slab.polygon,
    })
    useScene.setState({
      nodes: Object.fromEntries(
        [building, ground, upper, invalid, slab, destination].map((node) => [node.id, node]),
      ),
      rootNodeIds: [building.id],
    })
    spatialGridManager.clear()
    spatialGridManager.handleNodeCreated(slab, ground.id)
    useViewer.setState({
      selection: { buildingId: building.id, levelId: ground.id, zoneId: null, selectedIds: [] },
    })
    useEditor.setState({
      phase: 'structure',
      mode: 'build',
      tool: 'stair',
      isFloorplanHovered: true,
    })
    useEditor.getState().setSnappingMode('stair', 'off')
    useEditor.getState().setContinuation('point', 'repeat')
    const camera = new PerspectiveCamera()
    camera.position.set(0, 10, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    renderer = await create(createElement(ToolManager), { camera })
    const move = { position: [0, 0, 0], localPosition: [0, 0, 0], nativeEvent: {} } as Parameters<
      typeof emitter.emit<'grid:move'>
    >[1]
    const ghost = () =>
      renderer!.scene
        .findAll((node) => node.type === 'Mesh')
        .find((node) => node.instance.material?.opacity === 0.35)!.instance
    const rise = () => {
      ghost().geometry.computeBoundingBox()
      return ghost().geometry.boundingBox.max.y
    }
    await act(async () => {
      emitter.emit('grid:move', move)
    })
    expect(rise()).toBeCloseTo(2.7)
    expect(ghost().parent.position.y).toBeCloseTo(0.6)
    await act(async () => {
      emitter.emit('grid:click', move)
    })
    const flight = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'stair-segment',
    )
    expect(flight?.type).toBe('stair-segment')
    if (flight?.type === 'stair-segment') {
      expect(flight.height).toBeCloseTo(2.7)
      expect(flight.stepCount).toBe(15)
      expect(flight.length).toBeCloseTo(4.2)
    }
    await act(async () => {
      const nodes = { ...useScene.getState().nodes }
      delete nodes[destination.id]
      useScene.setState({ nodes })
      useViewer.setState({ selection: { ...useViewer.getState().selection, levelId: upper.id } })
    })
    await act(async () => {
      emitter.emit('grid:move', move)
    })
    expect(rise()).toBeCloseTo(3)
    let disposed = 0
    ghost().geometry.addEventListener('dispose', () => disposed++)
    await act(async () => {
      useViewer.setState({ selection: { ...useViewer.getState().selection, levelId: invalid.id } })
    })
    await act(async () => {
      emitter.emit('grid:move', move)
    })
    expect(ghost().parent.visible).toBe(false)
    await renderer.unmount()
    renderer = undefined
    expect(disposed).toBe(1)
  } finally {
    clearGuides()
    await renderer?.unmount()
    useScene.setState(oldScene)
    useViewer.setState(oldViewer)
    useEditor.setState(oldEditor)
    spatialGridManager.clear()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCancel
  }
})

test('selected walking lines share geometry with the core path and stay out of portable exports', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry, resolveStairWalkingPaths, planStairPreset } =
    await import('@pascal-app/core')
  const { useViewer, OVERLAY_LAYER } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { act, create } = await import('@react-three/test-renderer')
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const original = StairNode.parse({ totalRise: 3 })
    const plan = planStairPreset(original, { [original.id]: original }, { layout: 'u' })
    const nodes: Record<string, AnyNode> = { [plan.stair.id]: plan.stair }
    for (const segment of plan.segments) nodes[segment.id] = segment
    useScene.setState({ nodes, rootNodeIds: [plan.stair.id], readOnly: false })
    useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [plan.stair.id] } })
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing renderer')
    const Root = (await definition.renderer.module()).default
    renderer = await create(createElement(Root, { node: plan.stair }))
    const line = sceneRegistry.nodes
      .get(plan.stair.id)!
      .getObjectByName('stair-walking-line') as import('three').Line<
      import('three').BufferGeometry,
      import('three').LineBasicMaterial
    >
    const expected = resolveStairWalkingPaths(plan.stair, plan.segments, 3)[0]!
    const positions = line.geometry.getAttribute('position')
    expect(positions.count).toBe(expected.length)
    for (const [index, point] of expected.entries()) {
      expect(positions.getX(index)).toBeCloseTo(point[0], 5)
      expect(positions.getY(index)).toBeCloseTo(point[1] + 0.02, 5)
      expect(positions.getZ(index)).toBeCloseTo(point[2], 5)
    }
    expect(line.layers.isEnabled(OVERLAY_LAYER)).toBe(true)
    expect(line.layers.isEnabled(0)).toBe(false)
    expect(line.userData.pascalExport).toBe('strip')
    let disposals = 0
    line.geometry.addEventListener('dispose', () => disposals++)
    await act(async () =>
      useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [] } }),
    )
    expect(
      sceneRegistry.nodes.get(plan.stair.id)!.getObjectByName('stair-walking-line'),
    ).toBeUndefined()
    expect(disposals).toBe(1)
  } finally {
    await renderer?.unmount()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
  }
})

test('a full-circle landing keeps its complete support footprint beside a tiny flight sweep', () => {
  const stair = StairNode.parse({
    stairType: 'spiral',
    sweepAngle: 0.0001,
    innerRadius: 1,
    width: 1,
    topLandingMode: 'integrated',
    topLandingDepth: 3 * Math.PI,
    showCenterColumn: false,
  })
  const footprints = getStairFloorPlacedFootprints(stair, { [stair.id]: stair })
  expect(footprints).toHaveLength(25)
  for (const [x, z] of [
    [1.5, 0],
    [-1.5, 0],
    [0, 1.5],
    [0, -1.5],
  ]) {
    expect(
      footprints.some((footprint) => {
        const dx = x - footprint.position![0],
          dz = z - footprint.position![2]
        const angle = footprint.rotation![1]
        const localX = dx * Math.cos(angle) + dz * Math.sin(angle)
        const localZ = -dx * Math.sin(angle) + dz * Math.cos(angle)
        return (
          Math.abs(localX) <= footprint.dimensions[0] / 2 + 1e-8 &&
          Math.abs(localZ) <= footprint.dimensions[2] / 2 + 1e-8
        )
      }),
    ).toBe(true)
  }
})

test('oversized stair counts mount safely and explicitly refuse portable geometry export', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry } = await import('@pascal-app/core')
  const { exportSceneToGlb } = await import('@pascal-app/editor')
  const { StairSystem } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing renderer')
    const Root = (await definition.renderer.module()).default
    const cases = [
      { stairType: 'straight' as const, stepCount: 4294967296 },
      { stairType: 'spiral' as const, stepCount: 4294967296 },
      {
        stairType: 'straight' as const,
        stepCount: 10,
        length: 1e9,
        railingStyle: 'post-and-rail' as const,
      },
      {
        stairType: 'straight' as const,
        stepCount: 10,
        railingHeight: 1e9,
        railingStyle: 'cable' as const,
      },
      {
        stairType: 'straight' as const,
        stepCount: 10,
        railingTopReach: 1e9,
        railingStyle: 'boards' as const,
      },
    ]
    for (const entry of cases) {
      const segment = StairSegmentNode.parse(entry)
      const stair = StairNode.parse({
        ...entry,
        railingMode: entry.railingStyle ? 'both' : 'none',
        totalRise: 3,
        children: [segment.id],
      })
      segment.parentId = stair.id
      const nodes = { [stair.id]: stair, [segment.id]: segment }
      useScene.setState({
        nodes,
        rootNodeIds: [stair.id],
        dirtyNodes: new Set([stair.id, segment.id]),
        readOnly: false,
      })
      renderer = await create(
        createElement(
          'group',
          null,
          createElement(Root, { node: stair }),
          createElement(StairSystem),
        ),
      )
      await renderer.advanceFrames(2, 1 / 60)
      const root = sceneRegistry.nodes.get(stair.id)!
      expect(root.userData.pascalExportRefusal).toContain('computation budget')
      await expect(exportSceneToGlb(root, nodes)).rejects.toThrow('computation budget')
      expect((useScene.getState().nodes[stair.id] as typeof stair).stepCount).toBe(entry.stepCount)
      await renderer.unmount()
      renderer = undefined
    }
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
  }
})

test('explicit construction has the same finished bounds and slots in merged and editable views', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry, StairConstruction } = await import(
    '@pascal-app/core'
  )
  const { StairSystem } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing stair renderer')
    const Root = (await definition.renderer.module()).default
    for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
      const segment = StairSegmentNode.parse({ width: 1, length: 3, height: 2, stepCount: 10 })
      const stair = StairNode.parse({
        children: [segment.id],
        totalRise: 2,
        construction: StairConstruction.parse({
          mode,
          nosing: 0.04,
          finishThickness: 0.03,
          closedRisers: true,
        }),
      })
      segment.parentId = stair.id
      const nodes = { [stair.id]: stair, [segment.id]: segment }
      useScene.setState({
        nodes,
        rootNodeIds: [stair.id],
        dirtyNodes: new Set([stair.id, segment.id]),
        readOnly: false,
      })
      renderer = await create(
        createElement(
          'group',
          null,
          createElement(Root, { node: stair }),
          createElement(StairSystem),
        ),
      )
      const root = sceneRegistry.nodes.get(stair.id)!
      root.getObjectByName('segments-wrapper')!.visible = true
      await renderer.advanceFrames(4, 1 / 60)
      const merged = root.getObjectByName('merged-stair') as import('three').Mesh
      const selected = sceneRegistry.nodes.get(segment.id) as import('three').Mesh
      for (const mesh of [merged, selected]) {
        mesh.geometry.computeBoundingBox()
        expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(2)
        expect(mesh.geometry.boundingBox!.min.z).toBeCloseTo(-0.04)
        expect(mesh.geometry.boundingBox!.max.z).toBeCloseTo(3)
        expect(new Set(mesh.geometry.groups.map((group) => group.materialIndex))).toEqual(
          new Set([0, 1]),
        )
      }
      expect(merged.geometry.getAttribute('uv').count).toBe(
        merged.geometry.getAttribute('position').count,
      )
      expect(root.userData.pascalExportRefusal).toBeNull()
      await renderer.unmount()
      renderer = undefined
    }
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
  }
})

test('downstream editable bodies follow the live upstream rise and return to the original floor', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry, useLiveNodeOverrides } = await import(
    '@pascal-app/core'
  )
  const { StairSystem } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { create, act } = await import('@react-three/test-renderer')
  const previous = useScene.getState()
  const previousOverrides = useLiveNodeOverrides.getState().overrides
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing stair renderer')
    const Root = (await definition.renderer.module()).default
    const first = StairSegmentNode.parse({ height: 2 })
    const second = StairSegmentNode.parse({ height: 2 })
    const stair = StairNode.parse({
      totalRise: 4,
      construction: { mode: 'solid', nosing: 0 },
      children: [first.id, second.id],
    })
    first.parentId = stair.id
    second.parentId = stair.id
    const nodes = { [stair.id]: stair, [first.id]: first, [second.id]: second }
    const persisted = JSON.stringify(nodes)
    useScene.setState({
      nodes,
      rootNodeIds: [stair.id],
      dirtyNodes: new Set([stair.id, first.id, second.id]),
      readOnly: false,
    })
    renderer = await create(
      createElement(
        'group',
        null,
        createElement(Root, { node: stair }),
        createElement(StairSystem),
      ),
    )
    const root = sceneRegistry.nodes.get(stair.id)!
    root.getObjectByName('segments-wrapper')!.visible = true
    await renderer.advanceFrames(4, 1 / 60)
    const selected = sceneRegistry.nodes.get(second.id) as import('three').Mesh
    const merged = root.getObjectByName('merged-stair') as import('three').Mesh
    for (const height of [4, null]) {
      await act(async () => {
        if (height === null) useLiveNodeOverrides.getState().clear(first.id)
        else useLiveNodeOverrides.getState().set(first.id, { height })
        useScene.getState().markDirty(first.id)
      })
      await renderer.advanceFrames(4, 1 / 60)
      selected.geometry.computeBoundingBox()
      merged.geometry.computeBoundingBox()
      expect(selected.position.y).toBe(height ?? 2)
      expect(selected.geometry.boundingBox!.min.y + selected.position.y).toBeCloseTo(0)
      expect(selected.geometry.boundingBox!.max.y + selected.position.y).toBeCloseTo(
        (height ?? 2) + 2,
      )
      expect(merged.geometry.boundingBox!.min.y).toBeCloseTo(0)
      expect(merged.geometry.boundingBox!.max.y).toBeCloseTo((height ?? 2) + 2)
      expect(JSON.stringify(useScene.getState().nodes)).toBe(persisted)
    }
  } finally {
    await renderer?.unmount()
    useLiveNodeOverrides.setState({ overrides: previousOverrides })
    useScene.setState(previous)
  }
})

test('arc construction renders finite finished bodies and continuous metre UVs for both windings', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry } = await import('@pascal-app/core')
  const { createElement } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing renderer')
    const Root = (await definition.renderer.module()).default
    for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const)
      for (const sign of [-1, 1]) {
        const stair = StairNode.parse({
          stairType: 'spiral',
          stepCount: 28,
          sweepAngle: sign * 4 * Math.PI,
          totalRise: 4.2,
          innerRadius: 0.6,
          width: 1.2,
          topLandingMode: 'integrated',
          showCenterColumn: false,
          showStepSupports: false,
          railingMode: 'none',
          construction: { mode, nosing: 0.04, finishThickness: 0.03, closedRisers: true },
        })
        useScene.setState({
          nodes: { [stair.id]: stair },
          rootNodeIds: [stair.id],
          dirtyNodes: new Set([stair.id]),
          readOnly: false,
        })
        renderer = await create(createElement(Root, { node: stair }))
        const root = sceneRegistry.nodes.get(stair.id)!
        root.updateMatrixWorld(true)
        const { Box3, Mesh } = await import('three')
        expect(new Box3().setFromObject(root).max.y).toBeCloseTo(4.2)
        let meshes = 0
        root.traverse((object) => {
          if (!(object instanceof Mesh)) return
          meshes++
          const uv = object.geometry.getAttribute('uv')
          expect(uv.count).toBe(object.geometry.getAttribute('position').count)
          expect(Array.from(uv.array).every(Number.isFinite)).toBe(true)
          const position = object.geometry.getAttribute('position')
          let maximumScaleError = 0
          for (let i = 0; i < position.count; i += 3) {
            for (const [a, b] of [
              [i, i + 1],
              [i + 1, i + 2],
              [i + 2, i],
            ]) {
              const physical = Math.hypot(
                position.getX(a!) - position.getX(b!),
                position.getY(a!) - position.getY(b!),
                position.getZ(a!) - position.getZ(b!),
              )
              const texture = Math.hypot(uv.getX(a!) - uv.getX(b!), uv.getY(a!) - uv.getY(b!))
              maximumScaleError = Math.max(maximumScaleError, Math.abs(physical - texture))
            }
          }
          expect(maximumScaleError).toBeLessThan(0.00001)

          for (let i = 0; i < uv.count; i += 3) {
            expect(
              Math.max(uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)) -
                Math.min(uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)),
            ).toBeLessThan(2)
          }
        })
        expect(meshes).toBeGreaterThan(28)
        expect(root.userData.pascalExportRefusal).toBeNull()
        await renderer.unmount()
        renderer = undefined
      }
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
  }
})

test('continuous guard styles batch painted geometry and independently mount handrails', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry, planStairPreset } = await import('@pascal-app/core')
  const { useViewer } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const { Mesh } = await import('three')
  const previous = useScene.getState(),
    previousViewer = useViewer.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    useViewer.setState({ textures: true })
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing stair renderer')
    const Root = (await definition.renderer.module()).default
    for (const stairType of ['straight', 'spiral'] as const)
      for (const railingStyle of [
        'balusters',
        'post-and-rail',
        'cable',
        'boards',
        'glass',
        'metal',
      ] as const) {
        let stair = StairNode.parse({
          stairType,
          totalRise: 3,
          stepCount: 20,
          sweepAngle: -2 * Math.PI,
          topLandingMode: 'integrated',
          railingMode: 'both',
          railingPath: 'continuous',
          railingStyle,
          handrail: {
            mode: 'left',
            bottom: { extension: 0.2, return: 'floor' },
            top: { extension: 0.3, return: 'floor' },
          },
        })
        let nodes: Record<string, AnyNode> = { [stair.id]: stair }
        if (stairType === 'straight') {
          const plan = planStairPreset(stair, nodes, { layout: 'u' })
          stair = plan.stair
          nodes = Object.fromEntries([stair, ...plan.segments].map((node) => [node.id, node]))
        }
        useScene.setState({
          nodes,
          rootNodeIds: [stair.id],
          dirtyNodes: new Set(Object.values(nodes).map((node) => node.id)),
          readOnly: false,
        })
        renderer = await create(createElement(Root, { node: stair }))
        const root = sceneRegistry.nodes.get(stair.id)!,
          guard = root.getObjectByName('stair-continuous-railing')!
        const meshes: import('three').Mesh[] = []
        guard.traverse((object) => {
          if (object instanceof Mesh) meshes.push(object)
        })
        expect(meshes).toHaveLength(railingStyle === 'glass' ? 2 : 1)
        let disposals = 0
        for (const mesh of meshes) {
          mesh.geometry.addEventListener('dispose', () => disposals++)
          expect(
            Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite),
          ).toBe(true)
          expect(Array.from(mesh.geometry.getAttribute('uv').array).every(Number.isFinite)).toBe(
            true,
          )
          expect(mesh.userData.pascalIfcRole).toBe('railing')
        }
        if (railingStyle === 'glass') {
          const glass = meshes.find((mesh) => mesh.userData.slotId === 'infill')!
          expect((glass.material as import('three').Material).transparent).toBe(true)
          expect(
            definition.capabilities?.paint?.resolveRole?.({
              node: stair,
              hitObject: glass,
              materialIndex: 0,
            }),
          ).toBe('infill')
        }
        await renderer.unmount()
        renderer = undefined
        expect(disposals).toBe(meshes.length)
      }
    const stair = StairNode.parse({
      stairType: 'spiral',
      totalRise: 3,
      handrail: { mode: 'both' },
      railingMode: 'none',
    })
    useScene.setState({
      nodes: { [stair.id]: stair },
      rootNodeIds: [stair.id],
      dirtyNodes: new Set([stair.id]),
    })
    renderer = await create(createElement(Root, { node: stair }))
    expect(
      sceneRegistry.nodes
        .get(stair.id)!
        .getObjectByName('stair-continuous-railing')!
        .getObjectByName('stair-railing'),
    ).toBeDefined()
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
    useViewer.setState(previousViewer)
  }
})

test('merged stairs omit hidden bodies without shifting downstream flights or material ownership', async () => {
  const { builtinPlugin } = await import('../index')
  const { loadPlugin, useScene, sceneRegistry } = await import('@pascal-app/core')
  const { StairSystem } = await import('@pascal-app/viewer')
  const { createElement } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    await loadPlugin(builtinPlugin)
    const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing renderer')
    const Root = (await definition.renderer.module()).default
    for (const downstream of [false, true]) {
      const segments = [
        StairSegmentNode.parse({ height: 2 }),
        StairSegmentNode.parse({ height: 2, visible: false }),
        ...(downstream ? [StairSegmentNode.parse({ height: 2 })] : []),
      ]
      const stair = StairNode.parse({
        totalRise: segments.length * 2,
        children: segments.map((segment) => segment.id),
      })
      for (const segment of segments) segment.parentId = stair.id
      const nodes = Object.fromEntries([stair, ...segments].map((node) => [node.id, node]))
      useScene.setState({
        nodes,
        rootNodeIds: [stair.id],
        dirtyNodes: new Set([stair.id, ...stair.children]),
        readOnly: false,
      })
      renderer = await create(
        createElement(
          'group',
          null,
          createElement(Root, { node: stair }),
          createElement(StairSystem),
        ),
      )
      await renderer.advanceFrames(2, 1 / 60)
      const root = sceneRegistry.nodes.get(stair.id)!
      let merged: import('three').Mesh | undefined
      root.traverse((object) => {
        const mesh = object as import('three').Mesh
        if (mesh.isMesh && mesh.userData.surfaceNodeIds?.length === segments.length * 2)
          merged = mesh
      })
      expect(merged).toBeDefined()
      merged!.geometry.computeBoundingBox()
      expect(merged!.geometry.boundingBox!.max.y).toBeCloseTo(downstream ? 6 : 2)
      const indices = merged!.geometry.groups.map((group) => group.materialIndex)
      expect(indices.includes(2)).toBe(false)
      expect(indices.includes(3)).toBe(false)
      if (downstream) expect(indices.includes(4)).toBe(true)
      expect(merged!.userData.surfaceNodeIds).toEqual(
        segments.flatMap((segment) => [segment.id, segment.id]),
      )
      await renderer.unmount()
      renderer = undefined
    }
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
  }
})
