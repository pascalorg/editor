import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { cabinetRunArrayPlan, duplicateCabinetModuleAlongRun } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

function sceneApiFixture(seed: AnyNode[]): SceneApi {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >

  const addNode = (node: AnyNode, parentId?: AnyNodeId) => {
    const nextNode = parentId ? { ...node, parentId } : node
    nodes[node.id as AnyNodeId] = nextNode
    if (!parentId) return
    const parent = nodes[parentId]
    if (!parent || !('children' in parent)) return
    nodes[parentId] = {
      ...parent,
      children: [...(parent.children ?? []), node.id as AnyNodeId],
    } as AnyNode
  }

  return {
    get: (id) => nodes[id],
    nodes: () => nodes,
    update: (id, patch) => {
      const current = nodes[id]
      if (current) nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      addNode(node, parentId)
      return node.id as AnyNodeId
    },
    createMany: (ops) => {
      for (const op of ops) addNode(op.node, op.parentId)
    },
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: (rootId) => {
      const root = nodes[rootId]
      if (!root) return null
      const descendants: AnyNode[] = []
      const queue = [...(('children' in root ? root.children : []) ?? [])]
      for (const id of queue) {
        const node = nodes[id]
        if (!node) continue
        descendants.push(node)
        if ('children' in node) queue.push(...(node.children ?? []))
      }
      return { root, descendants }
    },
    cloneNodesInto: () => null,
  }
}

function cabinetRunFixture() {
  const run = CabinetNode.parse({
    id: 'cabinet_array-run',
    children: ['cabinet-module_array-source'],
  })
  const source = CabinetModuleNode.parse({
    id: 'cabinet-module_array-source',
    parentId: run.id,
    position: [0, 0, 0],
    width: 0.5,
    children: ['cabinet-module_array-wall'],
    metadata: {
      cabinetCornerSourceLink: { side: 'right', linkedRunIds: ['cabinet_corner-run'] },
      nodeSelectionProxyId: 'selection_proxy',
    },
  })
  const wall = CabinetModuleNode.parse({
    id: 'cabinet-module_array-wall',
    parentId: source.id,
    cabinetType: 'base',
    position: [0, 1.2, -0.14],
    width: 0.5,
    depth: 0.32,
  })
  return { run, source, wall }
}

describe('cabinet run array', () => {
  test('plans copies from the source width and requested spacing', () => {
    const { run, source } = cabinetRunFixture()
    const plan = cabinetRunArrayPlan(
      run,
      {
        [run.id]: run,
        [source.id]: source,
      },
      {
        copyCount: 3,
        direction: 'right',
        sourceModuleId: source.id as AnyNodeId,
        spacing: 0.1,
      },
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.positions.map((position) => position[0])).toHaveLength(3)
    expect(plan.positions[0]![0]).toBeCloseTo(0.6)
    expect(plan.positions[1]![0]).toBeCloseTo(1.2)
    expect(plan.positions[2]![0]).toBeCloseTo(1.8)

    const leftPlan = cabinetRunArrayPlan(
      run,
      {
        [run.id]: run,
        [source.id]: source,
      },
      {
        copyCount: 2,
        direction: 'left',
        sourceModuleId: source.id as AnyNodeId,
        spacing: 0.1,
      },
    )
    expect(leftPlan.ok).toBe(true)
    if (!leftPlan.ok) return
    expect(leftPlan.positions[0]![0]).toBeCloseTo(-0.6)
    expect(leftPlan.positions[1]![0]).toBeCloseTo(-1.2)
  })

  test('rejects copies that overlap another run module', () => {
    const { run, source } = cabinetRunFixture()
    const occupied = CabinetModuleNode.parse({
      id: 'cabinet-module_array-occupied',
      parentId: run.id,
      position: [0.45, 0, 0],
      width: 0.3,
    })
    const nextRun = { ...run, children: [...(run.children ?? []), occupied.id] }

    expect(
      cabinetRunArrayPlan(
        nextRun,
        {
          [nextRun.id]: nextRun,
          [source.id]: source,
          [occupied.id]: occupied,
        },
        {
          copyCount: 1,
          direction: 'right',
          sourceModuleId: source.id as AnyNodeId,
          spacing: 0,
        },
      ),
    ).toEqual({ ok: false, reason: 'no-space' })
  })

  test('clones the complete module subtree with fresh ids and keeps the source fixed', () => {
    const { run, source, wall } = cabinetRunFixture()
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, wall as AnyNode])

    const copiedIds = duplicateCabinetModuleAlongRun({
      copyCount: 2,
      direction: 'right',
      run,
      sceneApi,
      sourceModuleId: source.id as AnyNodeId,
      spacing: 0.1,
    })

    expect(copiedIds).toHaveLength(2)
    expect(copiedIds).not.toContain(source.id)
    expect(sceneApi.get<CabinetModuleNode>(source.id)?.position[0]).toBe(0)
    expect(sceneApi.get<CabinetNode>(run.id)?.children).toHaveLength(3)
    expect(copiedIds?.map((id) => sceneApi.get<CabinetModuleNode>(id)?.position[0])).toEqual([
      0.6, 1.2,
    ])

    for (const copiedId of copiedIds ?? []) {
      const copied = sceneApi.get<CabinetModuleNode>(copiedId)
      expect(copied?.children).toHaveLength(1)
      expect(copied?.metadata).not.toHaveProperty('cabinetCornerSourceLink')
      expect(copied?.metadata).not.toHaveProperty('nodeSelectionProxyId')
      const copiedWallId = copied?.children?.[0]
      expect(copiedWallId).not.toBe(wall.id)
      expect(sceneApi.get(copiedWallId as AnyNodeId)?.parentId).toBe(copiedId)
    }
    expect(sceneApi.get<CabinetNode>(run.id)?.metadata).toMatchObject({
      cabinetLayoutRevision: 1,
    })
  })
})
