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
  return { bridge, bridgeModule, nodes, root, sceneApi, wallA, wallB, wallC }
}

describe('wall cabinet depth handles', () => {
  test('shows wall arrows only on group selection alongside the base arrows', () => {
    const { bridge, bridgeModule, root, sceneApi, wallA, wallB, wallC } = wallDepthFixture()
    const buildModuleHandles = cabinetModuleDefinition.handles as (
      node: CabinetModuleNodeType,
      sceneApi: SceneApi,
    ) => HandleDescriptor<CabinetModuleNodeType>[]
    const selectedWallHandles = buildModuleHandles(wallA, sceneApi).filter(
      (handle): handle is LinearResizeHandle<CabinetModuleNodeType> =>
        handle.kind === 'linear-resize',
    )
    expect(selectedWallHandles).toHaveLength(0)

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
