import { describe, expect, mock, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  HandleDescriptor,
  LinearResizeHandle,
  SceneApi,
} from '@pascal-app/core'
import { CabinetModuleNode, CabinetNode } from '../schema'

mock.module('../floorplan-move', () => ({ cabinetModuleFloorplanMoveTarget: () => null }))
mock.module('../floorplan', () => ({
  buildCabinetFloorplan: () => null,
  buildCabinetModuleFloorplan: () => null,
}))
mock.module('../geometry', () => ({ buildCabinetGeometry: () => null }))
mock.module('../paint', () => ({ cabinetPaint: {} }))

const { cabinetDefinition, cabinetModuleDefinition } = await import('../definition')

function wallDepthFixture() {
  const root = {
    ...CabinetNode.parse({
      id: 'cabinet_wall-depth-root',
      depth: 0.58,
      children: ['cabinet-module_wall-depth-a'],
    }),
    children: ['cabinet-module_wall-depth-a', 'cabinet_wall-depth-leg-b'],
  } as CabinetNodeType
  const baseA = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-a',
    parentId: root.id,
    children: ['cabinet-module_wall-depth-top-a', 'cabinet_wall-depth-bridge'],
  })
  const wallA = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-top-a',
    name: 'Wall Cabinet',
    parentId: baseA.id,
    position: [0, 1.35, -0.13],
    depth: 0.32,
  })
  const bridge = CabinetNode.parse({
    id: 'cabinet_wall-depth-bridge',
    parentId: baseA.id,
    runTier: 'wall',
    position: [0.43, 1.35, -0.13],
    depth: 0.32,
    metadata: {
      cabinetCornerDerivedRun: {
        role: 'bridge',
        side: 'right',
        turnSide: 'right',
        sourceModuleId: baseA.id,
        sourceRunId: root.id,
      },
    },
    children: ['cabinet-module_wall-depth-bridge'],
  })
  const bridgeModule = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-bridge',
    parentId: bridge.id,
    name: 'Wall Bridge Filler',
    width: 0.36,
    openSide: 'left',
    depth: 0.32,
  })
  const legB = {
    ...CabinetNode.parse({
      id: 'cabinet_wall-depth-leg-b',
      parentId: root.id,
      depth: 0.68,
      rotation: -Math.PI / 2,
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'right',
          turnSide: 'right',
          sourceModuleId: baseA.id,
          sourceRunId: root.id,
        },
      },
      children: ['cabinet-module_wall-depth-b'],
    }),
    children: ['cabinet-module_wall-depth-b', 'cabinet_wall-depth-leg-c'],
  } as CabinetNodeType
  const baseB = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-b',
    parentId: legB.id,
    name: 'Base Cabinet',
    children: ['cabinet-module_wall-depth-top-b'],
  })
  const wallB = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-top-b',
    name: 'Wall Cabinet',
    parentId: baseB.id,
    position: [0, 1.35, -0.13],
    depth: 0.32,
  })
  const wallLegB = CabinetNode.parse({
    id: 'cabinet_wall-depth-wall-leg-b',
    runTier: 'wall',
    metadata: {
      cabinetCornerDerivedRun: {
        role: 'wall-leg',
        side: 'right',
        turnSide: 'right',
        sourceModuleId: baseA.id,
        sourceRunId: root.id,
      },
    },
  })
  const legC = CabinetNode.parse({
    id: 'cabinet_wall-depth-leg-c',
    parentId: legB.id,
    rotation: -Math.PI / 2,
    metadata: {
      cabinetCornerDerivedRun: {
        role: 'base-leg',
        side: 'right',
        turnSide: 'right',
        sourceModuleId: baseB.id,
        sourceRunId: legB.id,
      },
    },
    children: ['cabinet-module_wall-depth-c'],
  })
  const baseC = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-c',
    parentId: legC.id,
    children: ['cabinet-module_wall-depth-top-c'],
  })
  const wallC = CabinetModuleNode.parse({
    id: 'cabinet-module_wall-depth-top-c',
    name: 'Wall Cabinet',
    parentId: baseC.id,
    position: [0, 1.35, -0.13],
    depth: 0.32,
  })
  const nodes = Object.fromEntries(
    [
      root,
      baseA,
      wallA,
      bridge,
      bridgeModule,
      legB,
      baseB,
      wallB,
      wallLegB,
      legC,
      baseC,
      wallC,
    ].map((node) => [node.id as AnyNodeId, node as AnyNode]),
  ) as Record<AnyNodeId, AnyNode>
  const sceneApi = {
    get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    nodes: () => nodes,
    update: (id: AnyNodeId, patch: Partial<AnyNode>) => {
      nodes[id] = { ...nodes[id], ...patch } as AnyNode
    },
    markDirty: () => {},
  } as SceneApi
  return { baseA, bridge, bridgeModule, nodes, root, sceneApi, wallA, wallB, wallC }
}

describe('wall cabinet depth handles', () => {
  test('shows side width arrows and one depth arrow when a single cabinet is selected', () => {
    const { baseA, nodes, root, sceneApi, wallA } = wallDepthFixture()
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]

    for (const cabinet of [baseA, wallA]) {
      const handles = buildModuleHandles(cabinet, sceneApi)
      expect(handles).toHaveLength(3)
      expect(handles.map((handle) => handle.kind)).toEqual([
        'linear-resize',
        'linear-resize',
        'linear-resize',
      ])
      expect(handles.map((handle) => handle.axis)).toEqual(['x', 'x', 'z'])

      const widthHandles = handles.filter(
        (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
          handle.kind === 'linear-resize' && handle.axis === 'x',
      )
      const leftHandle = widthHandles.find((handle) => handle.anchor === 'max')!
      const rightHandle = widthHandles.find((handle) => handle.anchor === 'min')!
      const depthHandle = handles.find(
        (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
          handle.kind === 'linear-resize' && handle.axis === 'z',
      )!
      const nextWidth = cabinet.width + 0.2
      expect(leftHandle.apply(cabinet, nextWidth, sceneApi).position?.[0]).toBeCloseTo(
        cabinet.position[0] - 0.1,
      )
      expect(rightHandle.apply(cabinet, nextWidth, sceneApi).position?.[0]).toBeCloseTo(
        cabinet.position[0] + 0.1,
      )
      const nextDepth = cabinet.depth + 0.1
      const depthPatch = depthHandle.apply(cabinet, nextDepth, sceneApi)
      expect(depthPatch.depth).toBeCloseTo(nextDepth)
      expect(depthPatch.position?.[2]).toBeCloseTo(cabinet.position[2] + 0.05)
    }

    const rightCornerRun = sceneApi.get<CabinetNodeType>('cabinet_wall-depth-leg-b' as AnyNodeId)!
    const rightCornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-filler-right',
      parentId: rightCornerRun.id,
      moduleKind: 'corner-filler',
      name: 'Corner Filler',
    })
    nodes[rightCornerFiller.id as AnyNodeId] = rightCornerFiller as AnyNode
    nodes[rightCornerRun.id as AnyNodeId] = {
      ...rightCornerRun,
      children: [rightCornerFiller.id, ...(rightCornerRun.children ?? [])],
    } as AnyNode
    const besideRightGeneratedCorner = buildModuleHandles(baseA, sceneApi).filter(
      (handle) => handle.visible?.(baseA, sceneApi) !== false,
    ) as LinearResizeHandle<CabinetModuleNodeType>[]
    expect(besideRightGeneratedCorner.map((handle) => handle.axis)).toEqual(['x', 'z'])
    expect(
      besideRightGeneratedCorner
        .filter((handle) => handle.axis === 'x')
        .map((handle) => handle.anchor),
    ).toEqual(['max'])

    const leftCornerRun = CabinetNode.parse({
      id: 'cabinet_wall-depth-leg-left',
      parentId: root.id,
      children: ['cabinet-module_wall-depth-filler-left'],
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'left',
          turnSide: 'left',
          sourceModuleId: baseA.id,
          sourceRunId: root.id,
        },
      },
    })
    const leftCornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-filler-left',
      parentId: leftCornerRun.id,
      moduleKind: 'corner-filler',
      name: 'Corner Filler',
    })
    nodes[leftCornerRun.id as AnyNodeId] = leftCornerRun as AnyNode
    nodes[leftCornerFiller.id as AnyNodeId] = leftCornerFiller as AnyNode
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: [...root.children, leftCornerRun.id],
    } as AnyNode
    const betweenGeneratedCorners = buildModuleHandles(baseA, sceneApi).filter(
      (handle) => handle.visible?.(baseA, sceneApi) !== false,
    )
    expect(betweenGeneratedCorners.map((handle) => handle.axis)).toEqual(['z'])

    const adjacent = CabinetModuleNode.parse({
      id: 'cabinet-module_width-adjacent',
      parentId: root.id,
      position: [baseA.position[0] + baseA.width, baseA.position[1], baseA.position[2]],
      width: baseA.width,
    })
    nodes[adjacent.id as AnyNodeId] = adjacent as AnyNode
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: [baseA.id, adjacent.id],
    } as AnyNode
    const visibleHandles = buildModuleHandles(baseA, sceneApi).filter(
      (handle) => handle.visible?.(baseA, sceneApi) !== false,
    )

    expect(visibleHandles.map((handle) => handle.axis)).toEqual(['x', 'x', 'z'])

    nodes[adjacent.id as AnyNodeId] = {
      ...adjacent,
      moduleKind: 'corner-filler',
    } as AnyNode
    const besideRightFiller = buildModuleHandles(baseA, sceneApi).filter(
      (handle) => handle.visible?.(baseA, sceneApi) !== false,
    ) as LinearResizeHandle<CabinetModuleNodeType>[]
    expect(
      besideRightFiller.filter((handle) => handle.axis === 'x').map((handle) => handle.anchor),
    ).toEqual(['max'])

    nodes[adjacent.id as AnyNodeId] = {
      ...adjacent,
      moduleKind: 'corner-filler',
      position: [baseA.position[0] - baseA.width, baseA.position[1], baseA.position[2]],
    } as AnyNode
    const besideLeftFiller = buildModuleHandles(baseA, sceneApi).filter(
      (handle) => handle.visible?.(baseA, sceneApi) !== false,
    ) as LinearResizeHandle<CabinetModuleNodeType>[]
    expect(
      besideLeftFiller.filter((handle) => handle.axis === 'x').map((handle) => handle.anchor),
    ).toEqual(['min'])

    const filler = sceneApi.get<CabinetModuleNodeType>(adjacent.id as AnyNodeId)!
    const fillerHandles = buildModuleHandles(filler, sceneApi).filter(
      (handle) => handle.visible?.(filler, sceneApi) !== false,
    )
    expect(fillerHandles).toHaveLength(0)
  })

  test('changes only the selected module depth and keeps its back edge fixed', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_local-depth-run',
      depth: 0.58,
      children: ['cabinet-module_local-depth-a', 'cabinet-module_local-depth-b'],
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_local-depth-a',
      parentId: run.id,
      depth: 0.5,
      position: [-0.25, 0.1, 0.25],
    })
    const sibling = CabinetModuleNode.parse({
      id: 'cabinet-module_local-depth-b',
      parentId: run.id,
      depth: 0.7,
      position: [0.25, 0.1, 0.35],
    })
    const nodes = Object.fromEntries(
      [run, selected, sibling].map((node) => [node.id as AnyNodeId, node as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
      nodes: () => nodes,
      update: (id: AnyNodeId, patch: Partial<AnyNode>) => {
        nodes[id] = { ...nodes[id], ...patch } as AnyNode
      },
      markDirty: () => {},
    } as SceneApi
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const depthHandle = buildModuleHandles(selected, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'z',
    )!
    const selectedBack = selected.position[2] - selected.depth / 2
    const nextDepth = selected.depth + 0.1
    const preview = new Map(depthHandle.previewOverrides?.(selected, nextDepth, sceneApi) ?? [])
    const nextPreview = new Map(
      depthHandle.previewOverrides?.(selected, nextDepth + 0.05, sceneApi) ?? [],
    )

    expect(preview.get(run.id as AnyNodeId)).toEqual({})
    expect(nextPreview.get(run.id as AnyNodeId)).toEqual({})

    depthHandle.commit?.(selected, depthHandle.apply(selected, nextDepth, sceneApi), sceneApi)

    const resized = sceneApi.get<CabinetModuleNodeType>(selected.id as AnyNodeId)!
    expect(resized.depth).toBeCloseTo(nextDepth)
    expect(resized.position[2] - resized.depth / 2).toBeCloseTo(selectedBack)
    expect(sceneApi.get<CabinetModuleNodeType>(sibling.id as AnyNodeId)?.depth).toBeCloseTo(
      sibling.depth,
    )
    expect(sceneApi.get<CabinetModuleNodeType>(sibling.id as AnyNodeId)?.position).toEqual(
      sibling.position,
    )
    expect(sceneApi.get<CabinetNodeType>(run.id as AnyNodeId)?.depth).toBeCloseTo(run.depth)
  })

  test('magnetically snaps an individual base cabinet depth to a connected neighbor', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_depth-snap-run',
      children: ['cabinet-module_depth-snap-a', 'cabinet-module_depth-snap-b'],
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_depth-snap-a',
      parentId: run.id,
      depth: 0.3,
      position: [-0.25, 0.1, 0.15],
    })
    const sibling = CabinetModuleNode.parse({
      id: 'cabinet-module_depth-snap-b',
      parentId: run.id,
      depth: 0.6,
      position: [0.25, 0.1, 0.3],
    })
    const nodes = Object.fromEntries(
      [run, selected, sibling].map((node) => [node.id as AnyNodeId, node as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
      nodes: () => nodes,
    } as SceneApi
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const depthHandle = buildModuleHandles(selected, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'z',
    )!

    expect(depthHandle.magneticSnap?.(selected, 0.585, sceneApi)).toBeCloseTo(0.6)
    expect(depthHandle.magneticSnap?.(selected, 0.57, sceneApi)).toBeCloseTo(0.57)
    const patch = depthHandle.apply(
      selected,
      depthHandle.magneticSnap?.(selected, 0.585, sceneApi) ?? 0.585,
      sceneApi,
    )
    expect(patch.depth).toBeCloseTo(0.6)
    expect(patch.position?.[2]).toBeCloseTo(0.3)
  })

  test('magnetically snaps an individual wall cabinet depth to a connected neighbor', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_wall-depth-snap-run',
      children: ['cabinet-module_wall-depth-host-a', 'cabinet-module_wall-depth-host-b'],
    })
    const leftHost = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-host-a',
      parentId: run.id,
      children: ['cabinet-module_wall-depth-snap-a'],
      position: [-0.25, 0.1, 0.25],
    })
    const rightHost = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-host-b',
      parentId: run.id,
      children: ['cabinet-module_wall-depth-snap-b'],
      position: [0.25, 0.1, 0.25],
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-snap-a',
      parentId: leftHost.id,
      depth: 0.3,
      position: [0, 1.25, -0.1],
    })
    const sibling = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-snap-b',
      parentId: rightHost.id,
      depth: 0.6,
      position: [0, 1.25, 0.05],
    })
    const nodes = Object.fromEntries(
      [run, leftHost, rightHost, selected, sibling].map((node) => [
        node.id as AnyNodeId,
        node as AnyNode,
      ]),
    ) as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
      nodes: () => nodes,
    } as SceneApi
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const depthHandle = buildModuleHandles(selected, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'z',
    )!

    expect(depthHandle.magneticSnap?.(selected, 0.59, sceneApi)).toBeCloseTo(0.6)
  })

  test('shows a bottom depth arrow when a plain cabinet group is selected', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_plain-depth-group',
      children: ['cabinet-module_plain-depth-group'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_plain-depth-group',
      parentId: run.id,
    })
    const nodes = {
      [run.id as AnyNodeId]: run as AnyNode,
      [module.id as AnyNodeId]: module as AnyNode,
    } as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
      nodes: () => nodes,
    } as SceneApi
    const buildGroupHandles = cabinetDefinition.handles as (
      node: CabinetNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetNodeType>[]
    const handles = buildGroupHandles(run, sceneApi)
    const depthHandles = handles.filter(
      (handle): handle is LinearResizeHandle<CabinetNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'z',
    )

    expect(depthHandles).toHaveLength(1)
    expect(depthHandles[0]?.overrideTarget?.(run, sceneApi)).toBe(run.id)
  })

  test('adds one shared depth delta to differently sized modules on group resize', () => {
    const { baseA, nodes, root, sceneApi } = wallDepthFixture()
    const sibling = CabinetModuleNode.parse({
      id: 'cabinet-module_group-depth-sibling',
      parentId: root.id,
      depth: 0.7,
      position: [baseA.width, baseA.position[1], 0.35],
    })
    nodes[baseA.id as AnyNodeId] = {
      ...baseA,
      depth: 0.5,
      position: [baseA.position[0], baseA.position[1], 0.25],
    } as AnyNode
    nodes[sibling.id as AnyNodeId] = sibling as AnyNode
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: [baseA.id, sibling.id, ...root.children.filter((id) => id !== baseA.id)],
    } as AnyNode
    const buildGroupHandles = cabinetDefinition.handles as (
      node: CabinetNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetNodeType>[]
    const depthHandle = buildGroupHandles(root, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetNodeType> =>
        handle.kind === 'linear-resize' && handle.overrideTarget?.(root, sceneApi) === root.id,
    )!
    const nextReferenceDepth = root.depth + 0.1
    const preview = new Map(
      depthHandle.previewOverrides?.(root, nextReferenceDepth, sceneApi) ?? [],
    )

    expect(preview.get(baseA.id as AnyNodeId)?.depth).toBeCloseTo(0.6)
    expect(preview.get(sibling.id as AnyNodeId)?.depth).toBeCloseTo(0.8)

    depthHandle.commit?.(root, depthHandle.apply(root, nextReferenceDepth, sceneApi), sceneApi)

    const resizedBase = sceneApi.get<CabinetModuleNodeType>(baseA.id as AnyNodeId)!
    const resizedSibling = sceneApi.get<CabinetModuleNodeType>(sibling.id as AnyNodeId)!
    expect(resizedBase.depth).toBeCloseTo(0.6)
    expect(resizedSibling.depth).toBeCloseTo(0.8)
    expect(resizedSibling.depth - resizedBase.depth).toBeCloseTo(0.2)
    expect(resizedBase.position[2] - resizedBase.depth / 2).toBeCloseTo(0)
    expect(resizedSibling.position[2] - resizedSibling.depth / 2).toBeCloseTo(0)
  })

  test('preserves wall cabinet depth differences on group resize', () => {
    const { bridge, bridgeModule, nodes, root, sceneApi, wallA } = wallDepthFixture()
    nodes[bridge.id as AnyNodeId] = { ...bridge, depth: 0.42 } as AnyNode
    nodes[bridgeModule.id as AnyNodeId] = { ...bridgeModule, depth: 0.42 } as AnyNode
    const buildGroupHandles = cabinetDefinition.handles as (
      node: CabinetNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetNodeType>[]
    const depthHandle = buildGroupHandles(root, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetNodeType> =>
        handle.kind === 'linear-resize' && handle.overrideTarget?.(root, sceneApi) === wallA.id,
    )!
    const nextReferenceDepth = wallA.depth + 0.1
    const preview = new Map(
      depthHandle.previewOverrides?.(root, nextReferenceDepth, sceneApi) ?? [],
    )

    expect(preview.get(wallA.id as AnyNodeId)?.depth).toBeCloseTo(0.42)
    expect(preview.get(bridge.id as AnyNodeId)?.depth).toBeCloseTo(0.52)
    expect(preview.get(bridgeModule.id as AnyNodeId)?.depth).toBeCloseTo(0.52)

    depthHandle.commit?.(root, depthHandle.apply(root, nextReferenceDepth, sceneApi), sceneApi)

    expect(sceneApi.get<CabinetModuleNodeType>(wallA.id as AnyNodeId)?.depth).toBeCloseTo(0.42)
    expect(sceneApi.get<CabinetNodeType>(bridge.id as AnyNodeId)?.depth).toBeCloseTo(0.52)
    expect(sceneApi.get<CabinetModuleNodeType>(bridgeModule.id as AnyNodeId)?.depth).toBeCloseTo(
      0.52,
    )
  })

  test('changes width only on the bottom cabinet and its linked wall cabinet', () => {
    const { baseA, nodes, root, sceneApi, wallA } = wallDepthFixture()
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const widthHandle = buildModuleHandles(baseA, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === 'min',
    )!
    const otherCabinets = Object.values(nodes).filter(
      (node): node is CabinetNodeType | CabinetModuleNodeType =>
        (node.type === 'cabinet' || node.type === 'cabinet-module') &&
        node.id !== baseA.id &&
        node.id !== wallA.id,
    )
    const otherCabinetDimensions = new Map(
      otherCabinets.map((cabinet) => [
        cabinet.id,
        { position: [...cabinet.position], width: cabinet.width },
      ]),
    )
    const nextWidth = baseA.width + 0.2
    const patch = widthHandle.apply(baseA, nextWidth, sceneApi)
    const previewOverrides = new Map(
      widthHandle.previewOverrides?.(baseA, nextWidth, sceneApi) ?? [],
    )

    expect(patch.width).toBeCloseTo(nextWidth)
    expect(previewOverrides.get(root.id as AnyNodeId)).toEqual({})
    expect(previewOverrides.get(wallA.id as AnyNodeId)).toEqual({ width: nextWidth })
    expect(sceneApi.get<CabinetModuleNodeType>(baseA.id as AnyNodeId)?.width).toBe(baseA.width)
    expect(sceneApi.get<CabinetModuleNodeType>(wallA.id as AnyNodeId)?.width).toBe(wallA.width)
    widthHandle.commit?.(baseA, patch, sceneApi)

    expect(sceneApi.get<CabinetModuleNodeType>(baseA.id as AnyNodeId)?.width).toBeCloseTo(nextWidth)
    expect(sceneApi.get<CabinetModuleNodeType>(wallA.id as AnyNodeId)?.width).toBeCloseTo(nextWidth)
    expect(sceneApi.get<CabinetModuleNodeType>(wallA.id as AnyNodeId)?.position).toEqual(
      wallA.position,
    )
    for (const cabinet of otherCabinets) {
      const liveCabinet = sceneApi.get<CabinetNodeType | CabinetModuleNodeType>(
        cabinet.id as AnyNodeId,
      )!
      expect(liveCabinet.width).toBe(otherCabinetDimensions.get(cabinet.id)?.width)
      expect(liveCabinet.position).toEqual(otherCabinetDimensions.get(cabinet.id)?.position)
    }
  })

  test('hides wall cabinet arrows beside wall bridge and corner wall fillers', () => {
    const { nodes, sceneApi, wallA, wallB } = wallDepthFixture()
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const besideBridge = buildModuleHandles(wallA, sceneApi).filter(
      (handle) => handle.visible?.(wallA, sceneApi) !== false,
    ) as LinearResizeHandle<CabinetModuleNodeType>[]

    expect(
      besideBridge.filter((handle) => handle.axis === 'x').map((handle) => handle.anchor),
    ).toEqual(['max'])

    const baseB = sceneApi.get<CabinetModuleNodeType>(wallB.parentId as AnyNodeId)!
    const legB = sceneApi.get<CabinetNodeType>(baseB.parentId as AnyNodeId)!
    const cornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-arrow-corner-filler',
      parentId: legB.id,
      children: ['cabinet_wall-arrow-corner-wall-run'],
      moduleKind: 'corner-filler',
      name: 'Corner Filler',
      position: [baseB.position[0] - baseB.width, baseB.position[1], baseB.position[2]],
    })
    const cornerWallRun = CabinetNode.parse({
      id: 'cabinet_wall-arrow-corner-wall-run',
      parentId: cornerFiller.id,
      children: ['cabinet-module_wall-arrow-corner-wall-filler'],
      runTier: 'wall',
    })
    const cornerWallFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-arrow-corner-wall-filler',
      parentId: cornerWallRun.id,
      moduleKind: 'corner-filler',
      name: 'Corner Wall Filler',
    })
    nodes[cornerFiller.id as AnyNodeId] = cornerFiller as AnyNode
    nodes[cornerWallRun.id as AnyNodeId] = cornerWallRun as AnyNode
    nodes[cornerWallFiller.id as AnyNodeId] = cornerWallFiller as AnyNode
    nodes[legB.id as AnyNodeId] = {
      ...legB,
      children: [cornerFiller.id, ...(legB.children ?? [])],
    } as AnyNode
    const besideCornerWallFiller = buildModuleHandles(wallB, sceneApi).filter(
      (handle) => handle.visible?.(wallB, sceneApi) !== false,
    ) as LinearResizeHandle<CabinetModuleNodeType>[]

    expect(
      besideCornerWallFiller.filter((handle) => handle.axis === 'x').map((handle) => handle.anchor),
    ).toEqual(['min'])
  })

  test.each([
    ['left', 'max', -1],
    ['right', 'min', 1],
  ] as const)('resizes the first connected %s cabinet inversely in preview and commit', (side, anchor, direction) => {
    const { baseA, nodes, root, sceneApi, wallA } = wallDepthFixture()
    const neighbor = CabinetModuleNode.parse({
      id: `cabinet-module_inverse-${side}-neighbor`,
      parentId: root.id,
      children: [`cabinet-module_inverse-${side}-wall`],
      position: [direction * baseA.width, baseA.position[1], baseA.position[2]],
    })
    const neighborWall = CabinetModuleNode.parse({
      id: `cabinet-module_inverse-${side}-wall`,
      name: 'Wall Cabinet',
      parentId: neighbor.id,
      position: [0, 1.35, -0.13],
      depth: 0.32,
    })
    const fartherCabinet = CabinetModuleNode.parse({
      id: `cabinet-module_inverse-${side}-farther`,
      parentId: root.id,
      position: [direction * baseA.width * 2, baseA.position[1], baseA.position[2]],
    })
    nodes[neighbor.id as AnyNodeId] = neighbor as AnyNode
    nodes[neighborWall.id as AnyNodeId] = neighborWall as AnyNode
    nodes[fartherCabinet.id as AnyNodeId] = fartherCabinet as AnyNode
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: [baseA.id, neighbor.id, fartherCabinet.id],
    } as AnyNode
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const widthHandle = buildModuleHandles(baseA, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === anchor,
    )!
    const delta = 0.1
    const nextWidth = baseA.width + delta
    const neighborWidth = neighbor.width - delta
    const neighborPositionX = neighbor.position[0] + (direction * delta) / 2
    const selectedPatch = widthHandle.apply(baseA, nextWidth, sceneApi)
    const previewOverrides = new Map(
      widthHandle.previewOverrides?.(baseA, nextWidth, sceneApi) ?? [],
    )

    expect(previewOverrides.get(wallA.id as AnyNodeId)?.width).toBeCloseTo(nextWidth)
    expect(previewOverrides.get(neighbor.id as AnyNodeId)?.width).toBeCloseTo(neighborWidth)
    expect(previewOverrides.get(neighbor.id as AnyNodeId)?.position?.[0]).toBeCloseTo(
      neighborPositionX,
    )
    expect(previewOverrides.get(neighborWall.id as AnyNodeId)?.width).toBeCloseTo(neighborWidth)
    expect(previewOverrides.has(fartherCabinet.id as AnyNodeId)).toBe(false)
    expect(sceneApi.get<CabinetModuleNodeType>(neighbor.id as AnyNodeId)?.width).toBe(
      neighbor.width,
    )

    widthHandle.commit?.(baseA, selectedPatch, sceneApi)

    expect(sceneApi.get<CabinetModuleNodeType>(baseA.id as AnyNodeId)?.width).toBeCloseTo(nextWidth)
    expect(sceneApi.get<CabinetModuleNodeType>(neighbor.id as AnyNodeId)?.width).toBeCloseTo(
      neighborWidth,
    )
    expect(sceneApi.get<CabinetModuleNodeType>(neighbor.id as AnyNodeId)?.position[0]).toBeCloseTo(
      neighborPositionX,
    )
    expect(sceneApi.get<CabinetModuleNodeType>(neighborWall.id as AnyNodeId)?.width).toBeCloseTo(
      neighborWidth,
    )
    expect(sceneApi.get<CabinetModuleNodeType>(fartherCabinet.id as AnyNodeId)?.width).toBe(
      fartherCabinet.width,
    )
  })

  test.each([
    ['left', 'max', -1],
    ['right', 'min', 1],
  ] as const)('resizes the first connected %s wall cabinet inversely in preview and commit', (side, anchor, direction) => {
    const { baseA, nodes, root, sceneApi, wallA } = wallDepthFixture()
    const neighborBase = CabinetModuleNode.parse({
      id: `cabinet-module_wall-inverse-${side}-base`,
      parentId: root.id,
      children: [`cabinet-module_wall-inverse-${side}-wall`],
      position: [direction * baseA.width, baseA.position[1], baseA.position[2]],
    })
    const neighborWall = CabinetModuleNode.parse({
      id: `cabinet-module_wall-inverse-${side}-wall`,
      name: 'Wall Cabinet',
      parentId: neighborBase.id,
      position: [0, wallA.position[1], wallA.position[2]],
      depth: wallA.depth,
    })
    const fartherBase = CabinetModuleNode.parse({
      id: `cabinet-module_wall-inverse-${side}-farther-base`,
      parentId: root.id,
      children: [`cabinet-module_wall-inverse-${side}-farther-wall`],
      position: [direction * baseA.width * 2, baseA.position[1], baseA.position[2]],
    })
    const fartherWall = CabinetModuleNode.parse({
      id: `cabinet-module_wall-inverse-${side}-farther-wall`,
      name: 'Wall Cabinet',
      parentId: fartherBase.id,
      position: [0, wallA.position[1], wallA.position[2]],
      depth: wallA.depth,
    })
    for (const node of [neighborBase, neighborWall, fartherBase, fartherWall]) {
      nodes[node.id as AnyNodeId] = node as AnyNode
    }
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: [baseA.id, neighborBase.id, fartherBase.id],
    } as AnyNode
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const widthHandle = buildModuleHandles(wallA, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === anchor,
    )!
    const delta = 0.1
    const nextWidth = wallA.width + delta
    const neighborWidth = neighborWall.width - delta
    const neighborPositionX = neighborWall.position[0] + (direction * delta) / 2
    const selectedPatch = widthHandle.apply(wallA, nextWidth, sceneApi)
    const previewOverrides = new Map(
      widthHandle.previewOverrides?.(wallA, nextWidth, sceneApi) ?? [],
    )

    expect(previewOverrides.get(neighborWall.id as AnyNodeId)?.width).toBeCloseTo(neighborWidth)
    expect(previewOverrides.get(neighborWall.id as AnyNodeId)?.position?.[0]).toBeCloseTo(
      neighborPositionX,
    )
    expect(previewOverrides.has(neighborBase.id as AnyNodeId)).toBe(false)
    expect(previewOverrides.has(fartherWall.id as AnyNodeId)).toBe(false)

    widthHandle.commit?.(wallA, selectedPatch, sceneApi)

    expect(sceneApi.get<CabinetModuleNodeType>(wallA.id as AnyNodeId)?.width).toBeCloseTo(nextWidth)
    expect(sceneApi.get<CabinetModuleNodeType>(neighborWall.id as AnyNodeId)?.width).toBeCloseTo(
      neighborWidth,
    )
    expect(
      sceneApi.get<CabinetModuleNodeType>(neighborWall.id as AnyNodeId)?.position[0],
    ).toBeCloseTo(neighborPositionX)
    expect(sceneApi.get<CabinetModuleNodeType>(neighborBase.id as AnyNodeId)?.width).toBe(
      neighborBase.width,
    )
    expect(sceneApi.get<CabinetModuleNodeType>(fartherWall.id as AnyNodeId)?.width).toBe(
      fartherWall.width,
    )
  })

  test.each([
    ['left', 'max', -1],
    ['right', 'min', 1],
  ] as const)('closes an existing %s wall cabinet gap before exchanging width', (side, anchor, direction) => {
    const { baseA, nodes, root, sceneApi, wallA } = wallDepthFixture()
    const gap = 0.2
    const shortenedWall = {
      ...wallA,
      width: wallA.width - gap,
      position: [(-direction * gap) / 2, wallA.position[1], wallA.position[2]] as [
        number,
        number,
        number,
      ],
    }
    const neighborBase = CabinetModuleNode.parse({
      id: `cabinet-module_wall-gap-${side}-base`,
      parentId: root.id,
      children: [`cabinet-module_wall-gap-${side}-wall`],
      position: [direction * baseA.width, baseA.position[1], baseA.position[2]],
    })
    const neighborWall = CabinetModuleNode.parse({
      id: `cabinet-module_wall-gap-${side}-wall`,
      name: 'Wall Cabinet',
      parentId: neighborBase.id,
      position: [0, wallA.position[1], wallA.position[2]],
      depth: wallA.depth,
    })
    nodes[shortenedWall.id as AnyNodeId] = shortenedWall as AnyNode
    nodes[neighborBase.id as AnyNodeId] = neighborBase as AnyNode
    nodes[neighborWall.id as AnyNodeId] = neighborWall as AnyNode
    nodes[root.id as AnyNodeId] = {
      ...root,
      children: side === 'left' ? [neighborBase.id, baseA.id] : [baseA.id, neighborBase.id],
    } as AnyNode
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const widthHandle = buildModuleHandles(shortenedWall, sceneApi).find(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === anchor,
    )!
    const dragDelta = 0.05
    const requestedWidth = shortenedWall.width + dragDelta
    const selectedPatch = widthHandle.apply(shortenedWall, requestedWidth, sceneApi)
    const previewOverrides = new Map(
      widthHandle.previewOverrides?.(shortenedWall, requestedWidth, sceneApi) ?? [],
    )

    expect(selectedPatch.width).toBeCloseTo(requestedWidth + gap)
    expect(previewOverrides.get(neighborWall.id as AnyNodeId)?.width).toBeCloseTo(
      neighborWall.width - dragDelta,
    )

    widthHandle.commit?.(shortenedWall, selectedPatch, sceneApi)

    const selected = sceneApi.get<CabinetModuleNodeType>(shortenedWall.id as AnyNodeId)!
    const neighbor = sceneApi.get<CabinetModuleNodeType>(neighborWall.id as AnyNodeId)!
    const selectedCenterX = baseA.position[0] + selected.position[0]
    const neighborCenterX = neighborBase.position[0] + neighbor.position[0]
    const selectedEdge = selectedCenterX + (direction * selected.width) / 2
    const neighborEdge = neighborCenterX - (direction * neighbor.width) / 2

    expect(selectedEdge).toBeCloseTo(neighborEdge)
  })

  test('shows wall depth arrows on group selection alongside the base arrows', () => {
    const { bridge, bridgeModule, root, sceneApi, wallA, wallB, wallC } = wallDepthFixture()
    const buildGroupHandles = cabinetDefinition.handles as (
      node: CabinetNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetNodeType>[]
    const handles = buildGroupHandles(root, sceneApi).filter(
      (handle): handle is LinearResizeHandle<CabinetNodeType> => handle.kind === 'linear-resize',
    )

    expect(handles).toHaveLength(6)
    expect(handles.map((handle) => handle.axis).sort()).toEqual(['x', 'x', 'z', 'z', 'z', 'z'])

    const sideHandle = handles.find(
      (handle) => handle.overrideTarget?.(root, sceneApi) === wallB.id,
    )!
    const sideMax =
      typeof sideHandle.max === 'function' ? sideHandle.max(root, sceneApi) : sideHandle.max
    expect(sideMax).toBeCloseTo(0.68)

    for (let cycle = 0; cycle < 2; cycle++) {
      const maxDepthPatch = sideHandle.apply(root, sideMax! + 0.04, sceneApi)
      sideHandle.commit?.(root, maxDepthPatch, sceneApi)
      const consumedBridge = sceneApi.get<CabinetModuleNodeType>(bridgeModule.id)!
      const consumedBridgeRun = sceneApi.get<CabinetNodeType>(bridge.id)!
      expect(sceneApi.get<CabinetModuleNodeType>(wallB.id)?.depth).toBeCloseTo(0.68)
      expect(consumedBridge.width).toBeCloseTo(0)
      expect(consumedBridge.position[0]).toBeCloseTo(0)
      expect(consumedBridgeRun.position[0]).toBeCloseTo(0.25)

      const minDepthPatch = sideHandle.apply(root, 0.26, sceneApi)
      sideHandle.commit?.(root, minDepthPatch, sceneApi)
      const expandedBridge = sceneApi.get<CabinetModuleNodeType>(bridgeModule.id)!
      const expandedBridgeRun = sceneApi.get<CabinetNodeType>(bridge.id)!
      expect(sceneApi.get<CabinetModuleNodeType>(wallB.id)?.depth).toBeCloseTo(0.3)
      expect(expandedBridge.width).toBeCloseTo(0.38)
      expect(expandedBridge.position[0]).toBeCloseTo(0)
      expect(expandedBridgeRun.position[0]).toBeCloseTo(0.44)
    }

    const reducedDepthPatch = sideHandle.apply(root, 0.48, sceneApi)
    sideHandle.commit?.(root, reducedDepthPatch, sceneApi)
    const restoredBridge = sceneApi.get<CabinetModuleNodeType>(bridgeModule.id)!
    const restoredBridgeRun = sceneApi.get<CabinetNodeType>(bridge.id)!
    expect(restoredBridge.width).toBeCloseTo(0.2)
    expect(restoredBridge.position[0]).toBeCloseTo(0)
    expect(restoredBridgeRun.position[0]).toBeCloseTo(0.35)

    const mainHandle = handles.find(
      (handle) => handle.overrideTarget?.(root, sceneApi) === wallA.id,
    )!
    const wallABack = wallA.position[2] - wallA.depth / 2
    const bridgeBack = bridgeModule.position[2] - bridgeModule.depth / 2
    const patch = mainHandle.apply(root, 0.42, sceneApi)
    mainHandle.commit?.(root, patch, sceneApi)

    const resizedWallA = sceneApi.get<CabinetModuleNodeType>(wallA.id)!
    const resizedBridge = sceneApi.get<CabinetNodeType>(bridge.id)!
    const resizedBridgeModule = sceneApi.get<CabinetModuleNodeType>(bridgeModule.id)!
    expect(resizedWallA.depth).toBeCloseTo(0.42)
    expect(resizedWallA.position[2] - resizedWallA.depth / 2).toBeCloseTo(wallABack)
    expect(resizedBridge.depth).toBeCloseTo(0.42)
    expect(resizedBridgeModule.depth).toBeCloseTo(0.42)
    expect(resizedBridgeModule.position[2] - resizedBridgeModule.depth / 2).toBeCloseTo(bridgeBack)
    expect(sceneApi.get<CabinetModuleNodeType>(wallB.id)?.depth).toBeCloseTo(0.48)
    expect(sceneApi.get<CabinetModuleNodeType>(wallC.id)?.depth).toBeCloseTo(0.32)

    const sidePatchAfterMainResize = sideHandle.apply(root, 0.5, sceneApi)
    sideHandle.commit?.(root, sidePatchAfterMainResize, sceneApi)

    const realignedWallA = sceneApi.get<CabinetModuleNodeType>(wallA.id)!
    const realignedBridge = sceneApi.get<CabinetNodeType>(bridge.id)!
    const realignedBridgeModule = sceneApi.get<CabinetModuleNodeType>(bridgeModule.id)!
    expect(realignedBridgeModule.position[2]).toBeCloseTo(0)
    expect(realignedBridge.position[2] + realignedBridgeModule.position[2]).toBeCloseTo(
      realignedWallA.position[2],
    )
  })
})
