import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { computeAffectedSiblingIds } from './floorplan-registry-layer'

function cabinetRun(id: string, children: string[] = [], parentId: string | null = 'level_test') {
  return {
    id,
    type: 'cabinet',
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children,
    position: [0, 0, 0],
    rotation: 0,
    width: 1.2,
    depth: 0.58,
    carcassHeight: 0.72,
    plinthHeight: 0.1,
    showPlinth: true,
    withCountertop: true,
    countertopThickness: 0.02,
  } as AnyNode
}

function cabinetModule(id: string, parentId: string, children: string[] = []) {
  return {
    id,
    type: 'cabinet-module',
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children,
    position: [0, 0.1, 0],
    rotation: 0,
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    plinthHeight: 0.1,
    showPlinth: true,
    countertopThickness: 0.02,
  } as AnyNode
}

describe('computeAffectedSiblingIds', () => {
  test('propagates cabinet live overrides through the cabinet family', () => {
    const run = cabinetRun('cabinet_run', ['cabinet-module_main', 'cabinet-module_corner'])
    const module = cabinetModule('cabinet-module_main', run.id)
    const cornerModule = cabinetModule('cabinet-module_corner', run.id, ['cabinet_child-run'])
    const childRun = cabinetRun('cabinet_child-run', ['cabinet-module_child'], cornerModule.id)
    const childModule = cabinetModule('cabinet-module_child', childRun.id)
    const nodes = {
      [run.id]: run,
      [module.id]: module,
      [cornerModule.id]: cornerModule,
      [childRun.id]: childRun,
      [childModule.id]: childModule,
    } as Record<string, AnyNode>

    const affected = computeAffectedSiblingIds(
      [run.id as AnyNodeId],
      nodes,
      new Map([[run.id, { position: [2, 0, 3] }]]),
    )

    expect(affected).toEqual(
      new Set([
        run.id,
        module.id,
        cornerModule.id,
        childRun.id,
        childModule.id,
      ] as AnyNodeId[]),
    )
  })
})
