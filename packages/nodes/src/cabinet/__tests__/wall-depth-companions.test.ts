import { describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
} from '@pascal-app/core'
import { wallCornerWidthOverridesForDepthTargets } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

function derivedMetadata(
  role: 'base-leg' | 'wall-leg' | 'bridge',
  side: 'left' | 'right',
  sourceModuleId: AnyNodeId,
  sourceRunId: AnyNodeId,
) {
  return {
    cabinetCornerDerivedRun: { role, side, turnSide: side, sourceModuleId, sourceRunId },
  }
}

describe('wall depth corner companions', () => {
  test('inversely resizes only bridge fillers for side depth changes', () => {
    const sourceRunA = CabinetNode.parse({ id: 'cabinet_wall-depth-source-a', depth: 0.58 })
    const sourceA = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-source-a',
      parentId: sourceRunA.id,
      children: ['cabinet-module_wall-depth-a'],
    })
    const wallA = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-a',
      parentId: sourceA.id,
      name: 'Wall Cabinet',
      width: 0.5,
      depth: 0.32,
    })
    const baseLegB = CabinetNode.parse({
      id: 'cabinet_wall-depth-base-leg-b',
      depth: 0.68,
      metadata: derivedMetadata('base-leg', 'right', sourceA.id, sourceRunA.id),
      children: ['cabinet-module_wall-depth-source-b'],
    })
    const sourceB = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-source-b',
      parentId: baseLegB.id,
      name: 'Base Cabinet',
      children: ['cabinet-module_wall-depth-b'],
    })
    const wallB = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-b',
      parentId: sourceB.id,
      name: 'Wall Cabinet',
      width: 0.5,
      depth: 0.32,
    })
    const bridgeA = CabinetNode.parse({
      id: 'cabinet_wall-depth-bridge-a',
      runTier: 'wall',
      metadata: derivedMetadata('bridge', 'right', sourceA.id, sourceRunA.id),
      children: ['cabinet-module_wall-depth-bridge-filler-a'],
    })
    const bridgeFillerA = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-bridge-filler-a',
      parentId: bridgeA.id,
      name: 'Wall Bridge Filler',
      width: 0.36,
      openSide: 'left',
    })
    const wallLegB = CabinetNode.parse({
      id: 'cabinet_wall-depth-wall-leg-b',
      runTier: 'wall',
      metadata: derivedMetadata('wall-leg', 'right', sourceA.id, sourceRunA.id),
      children: ['cabinet-module_wall-depth-corner-filler-b'],
    })
    const cornerFillerB = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-corner-filler-b',
      parentId: wallLegB.id,
      name: 'Corner Wall Filler',
      width: 0.58,
    })

    const baseLegC = CabinetNode.parse({
      id: 'cabinet_wall-depth-base-leg-c',
      metadata: derivedMetadata('base-leg', 'left', sourceB.id, baseLegB.id),
      children: ['cabinet-module_wall-depth-source-c'],
    })
    const sourceC = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-source-c',
      parentId: baseLegC.id,
      name: 'Base Cabinet',
      children: ['cabinet-module_wall-depth-c'],
    })
    const wallC = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-c',
      parentId: sourceC.id,
      name: 'Wall Cabinet',
      width: 0.5,
      depth: 0.32,
    })
    const bridgeB = CabinetNode.parse({
      id: 'cabinet_wall-depth-bridge-b',
      runTier: 'wall',
      metadata: derivedMetadata('bridge', 'right', sourceB.id, baseLegB.id),
      children: ['cabinet-module_wall-depth-bridge-filler-b'],
    })
    const bridgeFillerB = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-bridge-filler-b',
      parentId: bridgeB.id,
      name: 'Wall Bridge Filler',
      width: 0.36,
      openSide: 'right',
    })
    const wallLegC = CabinetNode.parse({
      id: 'cabinet_wall-depth-wall-leg-c',
      runTier: 'wall',
      metadata: derivedMetadata('wall-leg', 'right', sourceB.id, baseLegB.id),
      children: ['cabinet-module_wall-depth-corner-filler-c'],
    })
    const cornerFillerC = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-depth-corner-filler-c',
      parentId: wallLegC.id,
      name: 'Corner Wall Filler',
      width: 0.58,
    })
    const allNodes = [
      sourceRunA,
      sourceA,
      wallA,
      baseLegB,
      sourceB,
      wallB,
      bridgeA,
      bridgeFillerA,
      wallLegB,
      cornerFillerB,
      baseLegC,
      sourceC,
      wallC,
      bridgeB,
      bridgeFillerB,
      wallLegC,
      cornerFillerC,
    ]
    const nodes = Object.fromEntries(
      allNodes.map((node) => [node.id as AnyNodeId, node as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    const overrides = new Map(
      wallCornerWidthOverridesForDepthTargets({
        depth: 0.42,
        nodes,
        targets: [wallB, wallLegB, bridgeB],
      }),
    )
    const patch = (node: CabinetModuleNodeType) => overrides.get(node.id as AnyNodeId)
    const runPatch = (node: AnyNode) => overrides.get(node.id as AnyNodeId)

    expect(patch(bridgeFillerA)?.width).toBeCloseTo(0.26)
    expect(patch(wallA)).toBeUndefined()
    expect(patch(cornerFillerC)).toBeUndefined()
    expect(patch(wallC)).toBeUndefined()
    expect(patch(cornerFillerB)).toBeUndefined()
    expect(patch(bridgeFillerB)?.width).toBeCloseTo(0.26)
    expect(patch(wallB)).toBeUndefined()
    expect(patch(bridgeFillerA)?.position?.[0]).toBeCloseTo(0)
    expect(patch(bridgeFillerB)?.position?.[0]).toBeCloseTo(0)
    expect(runPatch(bridgeA)?.position?.[0]).toBeCloseTo(0.38)
    expect(runPatch(bridgeB)?.position?.[0]).toBeCloseTo(-0.38)

    const rightSideOverrides = new Map(
      wallCornerWidthOverridesForDepthTargets({
        depth: 0.42,
        nodes,
        targets: [wallA, bridgeA],
      }),
    )
    expect(
      (rightSideOverrides.get(bridgeFillerA.id as AnyNodeId) as Partial<CabinetModuleNodeType>)
        ?.width,
    ).toBeCloseTo(0.16)
    expect(rightSideOverrides.get(wallA.id as AnyNodeId)).toBeUndefined()

    const endpointOverrides = new Map(
      wallCornerWidthOverridesForDepthTargets({
        depth: 0.72,
        nodes,
        targets: [wallB, wallLegB, bridgeB],
      }),
    )
    const endpointPatch = (node: CabinetModuleNodeType) =>
      endpointOverrides.get(node.id as AnyNodeId) as Partial<CabinetModuleNodeType> | undefined
    expect(endpointPatch(bridgeFillerA)?.width).toBe(0)
    expect(endpointPatch(bridgeFillerB)?.width).toBe(0)
    expect(endpointPatch(bridgeFillerA)!.position![0]).toBeCloseTo(0)
    expect(endpointPatch(bridgeFillerB)!.position![0]).toBeCloseTo(0)
    expect(endpointOverrides.get(bridgeA.id as AnyNodeId)?.position?.[0]).toBeCloseTo(0.25)
    expect(endpointOverrides.get(bridgeB.id as AnyNodeId)?.position?.[0]).toBeCloseTo(-0.25)
  })
})
