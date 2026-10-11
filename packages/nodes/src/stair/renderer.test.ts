import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  emitter,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  planStairPreset,
  resolveStairWalkingPaths,
  SceneMaterial,
  SlabNode,
  StairNode,
  StairSegmentNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { StairEditSystem, ToolManager, useAlignmentGuides, useEditor } from '@pascal-app/editor'
import { OVERLAY_LAYER, StairSystem, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import {
  Box3,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
} from 'three'
import { builtinPlugin, stairDefinition } from '../index'

async function mountStair(stair: StairNode) {
  await loadPlugin(builtinPlugin)
  if (stairDefinition.renderer?.kind !== 'parametric') throw new Error('Missing stair renderer')
  const Root = (await stairDefinition.renderer.module()).default
  return create(
    createElement(
      'group',
      null,
      createElement(Root, { node: stair }),
      createElement(StairSystem),
      createElement(StairEditSystem),
    ),
  )
}

function meshesMatching(root: Object3D, predicate: (mesh: Mesh) => boolean): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && predicate(object)) meshes.push(object)
  })
  return meshes
}
const mergedBody = (root: Object3D) =>
  meshesMatching(root, (mesh) => Array.isArray(mesh.userData.surfaceNodeIds))[0]!
const railingMeshes = (root: Object3D) =>
  meshesMatching(root, (mesh) => ['railing', 'infill'].includes(mesh.userData.slotId))
function walkingLine(root: Object3D) {
  let line: import('three').Line | undefined
  root.traverse((object) => {
    if ((object as import('three').Line).isLine && object.userData.pascalExport === 'strip')
      line = object as import('three').Line
  })
  return line
}

test('painted flights retain parent slots and per-flight finishes in selected and merged bodies', async () => {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousRaf = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
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
    const definition = stairDefinition
    const segmentDefinition = builtinPlugin.nodes.find((node) => node.kind === 'stair-segment')!
    if (
      definition.renderer?.kind !== 'parametric' ||
      segmentDefinition.renderer?.kind !== 'parametric'
    )
      throw Error('Missing renderer')
    renderer = await mountStair(stair)
    await renderer.advanceFrames(4, 1 / 60)
    const merged = mergedBody(sceneRegistry.nodes.get(stair.id)!)
    await act(async () =>
      useViewer.setState({
        selection: { ...useViewer.getState().selection, selectedIds: [stair.id] },
      }),
    )
    await renderer.advanceFrames(4, 1 / 60)
    const firstMesh = sceneRegistry.nodes.get(first.id) as import('three').Mesh
    const secondMesh = sceneRegistry.nodes.get(second.id) as import('three').Mesh
    const slotMaterial = (mesh: Mesh, slot: string, surfaceId?: string) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const index =
        mesh.userData.slotIds?.findIndex(
          (id: string, i: number) =>
            id === slot && (!surfaceId || mesh.userData.surfaceNodeIds?.[i] === surfaceId),
        ) ?? 0
      return materials[index] as import('three').MeshStandardMaterial
    }
    expect(slotMaterial(merged, 'treads', first.id).color.getHexString()).toBe(
      slotMaterial(firstMesh, 'treads').color.getHexString(),
    )
    expect(slotMaterial(merged, 'body', first.id).color.getHexString()).toBe(
      slotMaterial(firstMesh, 'body').color.getHexString(),
    )
    expect(slotMaterial(merged, 'treads', second.id).color.getHexString()).toBe(
      slotMaterial(secondMesh, 'treads').color.getHexString(),
    )
    expect(slotMaterial(merged, 'body', second.id).color.getHexString()).toBe(
      slotMaterial(secondMesh, 'body').color.getHexString(),
    )
    const parentPreview = definition.capabilities!.paint!.applyPreview({
      nodes: useScene.getState().nodes,
      materials: useScene.getState().materials,
      node: stair,
      root: sceneRegistry.nodes.get(stair.id)!,
      role: 'treads',
      material: undefined,
      materialPreset: 'library:preset-white',
    })!
    expect(slotMaterial(merged, 'treads', second.id).color.getHexString()).toBe('0000ff')
    expect(slotMaterial(secondMesh, 'treads').color.getHexString()).toBe('0000ff')
    parentPreview()
    const paint = segmentDefinition.capabilities!.paint!
    expect(
      paint.getEffectiveMaterial!({
        materials: useScene.getState().materials,
        node: first,
        role: 'treads',
        nodes: useScene.getState().nodes,
      })?.material?.properties?.color,
    ).toBe('#ff0000')
    await act(async () =>
      useScene.getState().updateNode(first.id, { slots: { treads: `scene:${blue.id}` } }),
    )
    const paintedFirst = useScene.getState().nodes[first.id]!
    const erase = paint.applyPreview({
      nodes: useScene.getState().nodes,
      materials: useScene.getState().materials,
      node: paintedFirst,
      root: firstMesh,
      role: 'treads',
      material: undefined,
      materialPreset: undefined,
    })!
    expect(slotMaterial(firstMesh, 'treads').color.getHexString()).toBe('ff0000')
    erase()
    expect(slotMaterial(firstMesh, 'treads').color.getHexString()).toBe('0000ff')
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
    const originalColor = slotMaterial(orphanMesh, 'body').color.getHexString()
    const originalRoughness = slotMaterial(orphanMesh, 'body').roughness
    const eraseOrphan = paint.applyPreview({
      nodes: useScene.getState().nodes,
      materials: useScene.getState().materials,
      node: orphan,
      root: orphanMesh,
      role: 'body',
      material: undefined,
      materialPreset: undefined,
    })!
    const previewMaterial = slotMaterial(orphanMesh, 'body')
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
      phase: 'building',
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
      expect(flight.height / flight.stepCount).toBeLessThanOrEqual(0.18)
      expect(flight.length / flight.stepCount).toBeGreaterThanOrEqual(0.25)
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
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    const original = StairNode.parse({ totalRise: 3 })
    const plan = planStairPreset(original, { [original.id]: original }, { layout: 'u' })
    const nodes: Record<string, AnyNode> = { [plan.stair.id]: plan.stair }
    for (const segment of plan.segments) nodes[segment.id] = segment
    useScene.setState({ nodes, rootNodeIds: [plan.stair.id], readOnly: false })
    useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [plan.stair.id] } })
    renderer = await mountStair(plan.stair)
    const line = walkingLine(sceneRegistry.nodes.get(plan.stair.id)!)!
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
    expect(walkingLine(sceneRegistry.nodes.get(plan.stair.id)!)).toBeUndefined()
    expect(disposals).toBe(1)
  } finally {
    await renderer?.unmount()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
  }
})

test('downstream editable bodies follow the live upstream rise and return to the original floor', async () => {
  const previous = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousOverrides = useLiveNodeOverrides.getState().overrides
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
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
    useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [stair.id] } })
    renderer = await mountStair(stair)
    const root = sceneRegistry.nodes.get(stair.id)!
    await renderer.advanceFrames(4, 1 / 60)
    const selected = sceneRegistry.nodes.get(second.id) as import('three').Mesh
    const merged = mergedBody(root)
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
      await act(async () =>
        useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [] } }),
      )
      await renderer.advanceFrames(4, 1 / 60)
      merged.geometry.computeBoundingBox()
      expect(merged.geometry.boundingBox!.min.y).toBeCloseTo(0)
      expect(merged.geometry.boundingBox!.max.y).toBeCloseTo((height ?? 2) + 2)
      expect(JSON.stringify(useScene.getState().nodes)).toBe(persisted)
      await act(async () =>
        useViewer.setState({ selection: { ...previousViewer.selection, selectedIds: [stair.id] } }),
      )
    }
  } finally {
    await renderer?.unmount()
    useLiveNodeOverrides.setState({ overrides: previousOverrides })
    useScene.setState(previous)
    useViewer.setState(previousViewer)
  }
})

test('arc construction renders finite finished bodies and continuous metre UVs for both windings', async () => {
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
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
        renderer = await mountStair(stair)
        const root = sceneRegistry.nodes.get(stair.id)!
        root.updateMatrixWorld(true)
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
        expect(meshes).toBeGreaterThan(0)
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
  const previous = useScene.getState(),
    previousViewer = useViewer.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    useViewer.setState({ textures: true })
    const definition = stairDefinition
    if (definition.renderer?.kind !== 'parametric') throw new Error('Missing stair renderer')
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
        renderer = await mountStair(stair)
        const meshes = railingMeshes(sceneRegistry.nodes.get(stair.id)!)
        expect(meshes.length).toBeGreaterThan(0)
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
    renderer = await mountStair(stair)
    expect(railingMeshes(sceneRegistry.nodes.get(stair.id)!).length).toBeGreaterThan(0)
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
    useViewer.setState(previousViewer)
  }
})

test('merged stairs omit hidden bodies without shifting downstream flights or material ownership', async () => {
  const previous = useScene.getState()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
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
      renderer = await mountStair(stair)
      await renderer.advanceFrames(2, 1 / 60)
      const merged = mergedBody(sceneRegistry.nodes.get(stair.id)!)
      expect(merged).toBeDefined()
      merged!.geometry.computeBoundingBox()
      expect(merged!.geometry.boundingBox!.max.y).toBeCloseTo(downstream ? 6 : 2)
      expect(merged!.userData.surfaceNodeIds).toContain(segments[0]!.id)
      if (downstream) expect(merged!.userData.surfaceNodeIds).toContain(segments.at(-1)!.id)
      await renderer.unmount()
      renderer = undefined
    }
  } finally {
    await renderer?.unmount()
    useScene.setState(previous)
  }
})

test('stair railing geometry invalidates for its own live dependencies and resolved rise only', async () => {
  const previousScene = useScene.getState()
  const previousLive = useLiveNodeOverrides.getState()
  const level = LevelNode.parse({ height: 3 })
  const segment = StairSegmentNode.parse({ width: 1, length: 3, height: 3 })
  const stair = StairNode.parse({
    parentId: level.id,
    children: [segment.id],
    stairType: 'straight',
    railingMode: 'both',
    railingPath: 'continuous',
  })
  level.children = [stair.id]
  const unrelated = StairNode.parse({ totalRise: 2 })
  const nodes = Object.fromEntries(
    [level, stair, segment, unrelated].map((node) => [node.id, node]),
  )
  useScene.setState({ nodes })
  useLiveNodeOverrides.setState({ overrides: new Map() })
  if (stairDefinition.renderer?.kind !== 'parametric') throw new Error('Missing renderer')
  const Renderer = (await stairDefinition.renderer.module()).default
  const renderer = await mountStair(stair)
  const geometry = () => railingMeshes(sceneRegistry.nodes.get(stair.id)!)[0]!.geometry
  try {
    const original = geometry()
    await act(async () => {
      useScene.setState({ nodes: { ...nodes, [unrelated.id]: { ...unrelated, totalRise: 4 } } })
    })
    expect(geometry()).toBe(original)
    await act(async () => {
      useLiveNodeOverrides.getState().set(unrelated.id, { totalRise: 5 })
    })
    expect(geometry()).toBe(original)
    await act(async () => {
      useLiveNodeOverrides.getState().set(segment.id, { width: 2 })
    })
    expect(geometry()).not.toBe(original)
    const childPreview = geometry()
    await act(async () => {
      useScene.setState({
        nodes: { ...useScene.getState().nodes, [segment.id]: { ...segment, length: 4 } },
      })
    })
    expect(geometry()).not.toBe(childPreview)
    const arcStair = { ...stair, stairType: 'curved' as const }
    await renderer.update(createElement(Renderer, { node: arcStair }))
    const childEdited = geometry()
    await act(async () => {
      useScene.setState({
        nodes: { ...useScene.getState().nodes, [level.id]: { ...level, height: 4 } },
      })
    })
    expect(geometry()).not.toBe(childEdited)
    const levelEdited = geometry()
    await act(async () => {
      useLiveNodeOverrides.getState().set(level.id, { height: 5 })
    })
    expect(geometry()).not.toBe(levelEdited)
    const beforeParentDrag = geometry()
    await act(async () => {
      useLiveNodeOverrides.getState().set(stair.id, { width: 2 })
    })
    expect(geometry()).not.toBe(beforeParentDrag)
  } finally {
    await renderer.unmount()
    useScene.setState(previousScene, true)
    useLiveNodeOverrides.setState(previousLive, true)
  }
})

test('stair paint resolves inherited finishes from the supplied scene snapshot', async () => {
  const previous = useScene.getState()
  const red = SceneMaterial.parse({
    id: 'mat_stair_context',
    name: 'Snapshot finish',
    material: { properties: { color: '#ff0000' } },
  })
  const blue = { ...red, material: { properties: { color: '#0000ff' } } }
  const stair = StairNode.parse({ slots: { treads: `scene:${red.id}` } })
  const flight = StairSegmentNode.parse({ parentId: stair.id })
  const nodes = { [stair.id]: stair, [flight.id]: flight }
  const materials = { [red.id]: red }
  const original = new MeshStandardMaterial({ color: '#ffffff' })
  const mesh = new Mesh(new BoxGeometry(), original)
  mesh.userData.slotId = 'treads'
  try {
    useScene.setState({ nodes: {}, materials: { [blue.id]: blue } })
    const paint = nodeRegistry.get('stair-segment')!.capabilities!.paint!
    expect(
      paint.getEffectiveMaterial!({ node: flight, role: 'treads', nodes, materials })?.material
        ?.properties?.color,
    ).toBe('#ff0000')
    const restore = paint.applyPreview({
      node: flight,
      role: 'treads',
      nodes,
      materials,
      root: mesh,
      material: undefined,
      materialPreset: undefined,
    })!
    expect((mesh.material as import('three').MeshStandardMaterial).color.getHexString()).toBe(
      'ff0000',
    )
    restore()
    expect(mesh.material).toBe(original)
  } finally {
    mesh.geometry.dispose()
    original.dispose()
    useScene.setState(previous)
  }
})
