import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
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

function isCabinetNode(node: AnyNode | undefined): boolean {
  return node?.type === 'cabinet' || node?.type === 'cabinet-module'
}

function childIdsOf(node: AnyNode | undefined): AnyNodeId[] {
  return Array.isArray((node as { children?: unknown } | undefined)?.children)
    ? ((node as { children: AnyNodeId[] }).children ?? [])
    : []
}

function cabinetAffectedIds({
  node,
  nodes,
  liveOverrides,
}: {
  node: AnyNode
  nodes: Record<AnyNodeId, AnyNode>
  liveOverrides: Map<string, Record<string, unknown>>
}): readonly AnyNodeId[] {
  const affected = new Set<AnyNodeId>()
  const visited = new Set<AnyNodeId>()
  const queue: AnyNodeId[] = [node.id as AnyNodeId]

  while (queue.length > 0) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const current = nodes[id]
    if (!isCabinetNode(current)) continue
    affected.add(id)

    const parentIds = [
      current?.parentId as AnyNodeId | undefined,
      (liveOverrides.get(id) as { parentId?: AnyNodeId } | undefined)?.parentId,
    ]
    for (const parentId of parentIds) {
      const parent = parentId ? nodes[parentId] : undefined
      if (parentId && isCabinetNode(parent)) queue.push(parentId)
    }
    for (const childId of childIdsOf(current)) {
      if (isCabinetNode(nodes[childId])) queue.push(childId)
    }
  }

  return Array.from(affected)
}

function registerCabinetFloorplanDefinition(kind: 'cabinet' | 'cabinet-module') {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'utility',
    defaults: () => ({}) as never,
    floorplanAffectedIds: cabinetAffectedIds,
  } as unknown as AnyNodeDefinition)
}

describe('computeAffectedSiblingIds', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerCabinetFloorplanDefinition('cabinet')
    registerCabinetFloorplanDefinition('cabinet-module')
  })

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
      new Set([run.id, module.id, cornerModule.id, childRun.id, childModule.id] as AnyNodeId[]),
    )
  })

  test('propagates a live-moving cabinet module back to its owning run', () => {
    const run = cabinetRun('cabinet_run', ['cabinet-module_main', 'cabinet-module_child'])
    const module = cabinetModule('cabinet-module_main', run.id)
    const sibling = cabinetModule('cabinet-module_child', run.id)
    const nodes = {
      [run.id]: run,
      [module.id]: module,
      [sibling.id]: sibling,
    } as Record<string, AnyNode>

    const affected = computeAffectedSiblingIds(
      [module.id as AnyNodeId],
      nodes,
      new Map([[module.id, { position: [1.2, 0.1, 0.3] }]]),
    )

    expect(affected).toEqual(new Set([module.id, run.id, sibling.id] as AnyNodeId[]))
  })
})
