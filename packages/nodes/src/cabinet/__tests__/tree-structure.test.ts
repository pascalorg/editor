import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { cabinetTreeChildIds, cabinetTreeHidden } from '../tree-structure'

function nodeNames(ids: AnyNodeId[], nodes: Record<AnyNodeId, AnyNode>) {
  return ids.map((id) => nodes[id]?.name)
}

function treeChildIds(nodeId: AnyNodeId, nodes: Record<AnyNodeId, AnyNode>): AnyNodeId[] {
  const node = nodes[nodeId]
  return node ? cabinetTreeChildIds(node, nodes) : []
}

function treeContainsDescendant(
  nodeId: AnyNodeId,
  targetId: AnyNodeId,
  nodes: Record<AnyNodeId, AnyNode>,
): boolean {
  for (const childId of treeChildIds(nodeId, nodes)) {
    if (childId === targetId) return true
    if (treeContainsDescendant(childId, targetId, nodes)) return true
  }
  return false
}

describe('cabinet tree structure', () => {
  test('preserves measurement children on cabinet runs and modules', () => {
    const run = {
      ...CabinetNode.parse({
        id: 'cabinet_measurement-tree-run',
        parentId: 'level_measurement_tree' as AnyNodeId,
      }),
      children: ['cabinet-module_measurement-tree-module', 'measurement_run'],
    }
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_measurement-tree-module',
      parentId: run.id,
      children: ['measurement_module'],
    })
    const runMeasurement = {
      id: 'measurement_run',
      type: 'measurement',
      object: 'node',
      parentId: run.id,
      visible: true,
      metadata: {},
      measurementId: 'measurement-run',
      start: [0, 0, 0],
      end: [1, 0, 0],
      view: '3d',
    } as AnyNode
    const moduleMeasurement = {
      id: 'measurement_module',
      type: 'measurement',
      object: 'node',
      parentId: module.id,
      visible: true,
      metadata: {},
      measurementId: 'measurement-module',
      start: [0, 0, 0],
      end: [1, 0, 0],
      view: '3d',
    } as AnyNode
    const nodes = {
      [run.id]: run,
      [module.id]: module,
      [runMeasurement.id]: runMeasurement,
      [moduleMeasurement.id]: moduleMeasurement,
    } as Record<AnyNodeId, AnyNode>

    expect(treeChildIds(run.id, nodes)).toEqual([module.id, runMeasurement.id])
    expect(treeChildIds(module.id, nodes)).toEqual([moduleMeasurement.id])
  })

  test('flattens hidden corner runs from the real scene graph into the requested sidebar hierarchy', () => {
    const sourceRun = {
      ...CabinetNode.parse({
        id: 'cabinet_source-run-tree',
        parentId: 'level_tree' as AnyNodeId,
      }),
      children: ['cabinet-module_source-base', 'cabinet_corner-base-run'],
    }
    const sourceBase = CabinetModuleNode.parse({
      id: 'cabinet-module_source-base',
      parentId: sourceRun.id,
      name: 'Base Cabinet',
      children: ['cabinet-module_source-wall'],
    })
    const sourceWall = CabinetModuleNode.parse({
      id: 'cabinet-module_source-wall',
      parentId: sourceBase.id,
      name: 'Wall Cabinet',
    })
    const baseLegRun = {
      ...CabinetNode.parse({
        id: 'cabinet_corner-base-run',
        parentId: sourceRun.id,
        name: 'Corner Base Run',
        metadata: {
          cabinetCornerDerivedRun: {
            role: 'base-leg',
            side: 'right',
            sourceModuleId: sourceBase.id,
            sourceRunId: sourceRun.id,
          },
        },
      }),
      children: ['cabinet-module_corner-filler', 'cabinet-module_corner-base'],
    }
    const cornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler',
      parentId: baseLegRun.id,
      name: 'Corner Filler',
      children: ['cabinet_corner-bridge-run', 'cabinet_corner-wall-run'],
    })
    const cornerBase = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base',
      parentId: baseLegRun.id,
      name: 'Base Cabinet',
      children: ['cabinet-module_corner-wall-cabinet'],
    })
    const bridgeRun = {
      ...CabinetNode.parse({
        id: 'cabinet_corner-bridge-run',
        parentId: cornerFiller.id,
        name: 'Corner Wall Bridge',
        metadata: {
          cabinetCornerDerivedRun: {
            role: 'bridge',
            side: 'right',
            sourceModuleId: sourceBase.id,
            sourceRunId: sourceRun.id,
          },
        },
      }),
      children: ['cabinet-module_bridge-filler'],
    }
    const bridgeFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_bridge-filler',
      parentId: bridgeRun.id,
      name: 'Wall Bridge Filler',
    })
    const wallLegRun = {
      ...CabinetNode.parse({
        id: 'cabinet_corner-wall-run',
        parentId: cornerFiller.id,
        name: 'Corner Wall Run',
        metadata: {
          cabinetCornerDerivedRun: {
            role: 'wall-leg',
            side: 'right',
            sourceModuleId: sourceBase.id,
            sourceRunId: sourceRun.id,
          },
        },
      }),
      children: ['cabinet-module_corner-wall-filler'],
    }
    const cornerWallFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-wall-filler',
      parentId: wallLegRun.id,
      name: 'Corner Wall Filler',
    })
    const cornerWallCabinet = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-wall-cabinet',
      parentId: wallLegRun.id,
      name: 'Wall Cabinet',
    })

    const nodes = {
      [sourceRun.id]: sourceRun,
      [sourceBase.id]: sourceBase,
      [sourceWall.id]: sourceWall,
      [baseLegRun.id]: baseLegRun,
      [cornerFiller.id]: cornerFiller,
      [cornerBase.id]: cornerBase,
      [bridgeRun.id]: bridgeRun,
      [bridgeFiller.id]: bridgeFiller,
      [wallLegRun.id]: wallLegRun,
      [cornerWallFiller.id]: cornerWallFiller,
      [cornerWallCabinet.id]: cornerWallCabinet,
    } as Record<AnyNodeId, AnyNode>

    expect(nodeNames(treeChildIds(sourceRun.id, nodes), nodes)).toEqual([
      'Base Cabinet',
      'Corner Filler',
      'Base Cabinet',
    ])
    expect(nodeNames(treeChildIds(sourceBase.id, nodes), nodes)).toEqual(['Wall Cabinet'])
    expect(nodeNames(treeChildIds(cornerFiller.id, nodes), nodes)).toEqual([
      'Wall Bridge Filler',
      'Corner Wall Filler',
    ])
    expect(nodeNames(treeChildIds(cornerBase.id, nodes), nodes)).toEqual(['Wall Cabinet'])
    expect(cabinetTreeHidden(baseLegRun, nodes)).toBe(true)
    expect(cabinetTreeHidden(bridgeRun, nodes)).toBe(true)
    expect(cabinetTreeHidden(wallLegRun, nodes)).toBe(true)
    expect(treeContainsDescendant(sourceRun.id, bridgeFiller.id, nodes)).toBe(true)
    expect(treeContainsDescendant(cornerFiller.id, cornerWallFiller.id, nodes)).toBe(true)
  })

  test('surfaces nested hidden corner runs under the base cabinet they were created from', () => {
    const sourceRun = {
      ...CabinetNode.parse({
        id: 'cabinet_source-run-nested-tree',
        parentId: 'level_nested_tree' as AnyNodeId,
      }),
      children: ['cabinet-module_source-base-nested', 'cabinet_corner-base-run-nested'],
    }
    const sourceBase = CabinetModuleNode.parse({
      id: 'cabinet-module_source-base-nested',
      parentId: sourceRun.id,
      name: 'Base Cabinet',
    })
    const baseLegRun = {
      ...CabinetNode.parse({
        id: 'cabinet_corner-base-run-nested',
        parentId: sourceRun.id,
        name: 'Corner Base Run',
        metadata: {
          cabinetCornerDerivedRun: {
            role: 'base-leg',
            side: 'right',
            sourceModuleId: sourceBase.id,
            sourceRunId: sourceRun.id,
          },
        },
      }),
      children: [
        'cabinet-module_corner-filler-nested',
        'cabinet-module_corner-base-nested',
        'cabinet_corner-second-base-run-nested',
      ],
    }
    const cornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-nested',
      parentId: baseLegRun.id,
      name: 'Corner Filler',
    })
    const cornerBase = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base-nested',
      parentId: baseLegRun.id,
      name: 'Base Cabinet',
      children: ['cabinet-module_corner-base-wall-nested'],
    })
    const cornerBaseWall = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base-wall-nested',
      parentId: cornerBase.id,
      name: 'Wall Cabinet',
    })
    const nestedBaseLegRun = {
      ...CabinetNode.parse({
        id: 'cabinet_corner-second-base-run-nested',
        parentId: baseLegRun.id,
        name: 'Corner Base Run',
        metadata: {
          cabinetCornerDerivedRun: {
            role: 'base-leg',
            side: 'right',
            sourceModuleId: cornerBase.id,
            sourceRunId: baseLegRun.id,
          },
        },
      }),
      children: ['cabinet-module_corner-filler-second', 'cabinet-module_corner-base-second'],
    }
    const secondCornerFiller = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-second',
      parentId: nestedBaseLegRun.id,
      name: 'Corner Filler',
    })
    const secondCornerBase = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base-second',
      parentId: nestedBaseLegRun.id,
      name: 'Base Cabinet',
    })

    const nodes = {
      [sourceRun.id]: sourceRun,
      [sourceBase.id]: sourceBase,
      [baseLegRun.id]: baseLegRun,
      [cornerFiller.id]: cornerFiller,
      [cornerBase.id]: cornerBase,
      [cornerBaseWall.id]: cornerBaseWall,
      [nestedBaseLegRun.id]: nestedBaseLegRun,
      [secondCornerFiller.id]: secondCornerFiller,
      [secondCornerBase.id]: secondCornerBase,
    } as Record<AnyNodeId, AnyNode>

    expect(nodeNames(treeChildIds(sourceRun.id, nodes), nodes)).toEqual([
      'Base Cabinet',
      'Corner Filler',
      'Base Cabinet',
      'Corner Filler',
      'Base Cabinet',
    ])
    expect(nodeNames(treeChildIds(cornerBase.id, nodes), nodes)).toEqual(['Wall Cabinet'])
    expect(treeContainsDescendant(sourceRun.id, secondCornerBase.id, nodes)).toBe(true)
  })
})
