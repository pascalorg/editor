import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, DuplicableConfig } from '@pascal-app/core'
import { cabinetDefinition } from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'

const LEVEL_ID = 'level_test' as AnyNodeId
const ROOT_RUN_ID = 'cabinet_root-run' as AnyNodeId
const CHILD_RUN_ID = 'cabinet_child-run' as AnyNodeId
const CHILD_MODULE_ID = 'cabinet-module_child-module' as AnyNodeId

describe('cabinet duplicate subtree preparation', () => {
  test('flattens nested runs into level coordinates and strips derived metadata', () => {
    const rootRun = {
      id: ROOT_RUN_ID,
      type: 'cabinet',
      object: 'node',
      visible: true,
      metadata: {},
      parentId: LEVEL_ID,
      position: [4, 0, 5],
      rotation: Math.PI / 2,
      children: [CHILD_RUN_ID],
    } as AnyNode
    const childRun = CabinetNode.parse({
      id: CHILD_RUN_ID,
      parentId: ROOT_RUN_ID,
      position: [1, 0, 0.25],
      rotation: Math.PI / 2,
      children: [CHILD_MODULE_ID],
      metadata: {
        cabinetCornerDerivedRun: { role: 'base-leg', side: 'right', sourceRunId: ROOT_RUN_ID },
        nodeSelectionProxyId: ROOT_RUN_ID,
      },
    })
    const childModule = CabinetModuleNode.parse({
      id: CHILD_MODULE_ID,
      parentId: CHILD_RUN_ID,
      position: [0, 0.1, 0],
    })
    const level = {
      id: LEVEL_ID,
      type: 'level',
      parentId: null,
      children: [ROOT_RUN_ID],
    } as AnyNode
    const nodes = {
      [LEVEL_ID]: level,
      [ROOT_RUN_ID]: rootRun,
      [CHILD_RUN_ID]: childRun as AnyNode,
      [CHILD_MODULE_ID]: childModule as AnyNode,
    }
    const duplicable = cabinetDefinition.capabilities.duplicable as DuplicableConfig

    const prepared = duplicable.prepareSubtreeClone?.({
      root: childRun as AnyNode,
      descendants: [childModule as AnyNode],
      rootId: CHILD_RUN_ID,
      rootPatch: {},
      nodes,
    })

    expect(prepared?.parentId).toBe(LEVEL_ID)
    expect(prepared?.root?.parentId).toBe(LEVEL_ID)
    expect(
      (prepared?.root as { position?: [number, number, number] } | undefined)?.position?.[0],
    ).toBeCloseTo(4.25)
    expect(
      (prepared?.root as { position?: [number, number, number] } | undefined)?.position?.[2],
    ).toBeCloseTo(4)
    expect((prepared?.root as { rotation?: number } | undefined)?.rotation).toBeCloseTo(Math.PI)
    expect(
      (prepared?.root?.metadata as Record<string, unknown> | undefined)?.cabinetCornerDerivedRun,
    ).toBeUndefined()
    expect(
      (prepared?.root?.metadata as Record<string, unknown> | undefined)?.nodeSelectionProxyId,
    ).toBeUndefined()
  })
})
