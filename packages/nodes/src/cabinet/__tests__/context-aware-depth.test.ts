import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { addCabinetModuleSide, addCornerRun, syncCornerRunsFromSourceModule } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

function sceneApiFixture(seed: AnyNode[]): SceneApi {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  return {
    get: (id) => nodes[id],
    nodes: () => nodes,
    update: (id, patch) => {
      const current = nodes[id]
      if (current) nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      const parent = parentId ? nodes[parentId] : undefined
      if (parent && Array.isArray((parent as { children?: unknown }).children)) {
        nodes[parentId!] = {
          ...parent,
          children: [...new Set([...(parent.children ?? []), node.id])],
        } as AnyNode
      }
      return node.id as AnyNodeId
    },
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

describe('context-aware cabinet depth', () => {
  test('side additions inherit the connected edge cabinet depth', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_context-depth-side-run',
      depth: 0.5,
      children: ['cabinet-module_context-depth-left', 'cabinet-module_context-depth-right'],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-left',
      parentId: run.id,
      position: [-0.25, 0.1, 0.2],
      depth: 0.4,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-right',
      parentId: run.id,
      position: [0.25, 0.1, 0.35],
      depth: 0.7,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, left as AnyNode, right as AnyNode])

    const addedLeftId = addCabinetModuleSide({
      anchorModule: null,
      run,
      sceneApi,
      side: 'left',
    })
    const addedLeft = sceneApi.get(addedLeftId!)

    expect(addedLeft?.type).toBe('cabinet-module')
    if (addedLeft?.type !== 'cabinet-module') return
    expect(addedLeft.depth).toBeCloseTo(left.depth)
    expect(addedLeft.position[2]).toBeCloseTo(left.position[2])

    const addedRightId = addCabinetModuleSide({
      anchorModule: null,
      run: sceneApi.get(run.id as AnyNodeId) as typeof run,
      sceneApi,
      side: 'right',
    })
    const addedRight = sceneApi.get(addedRightId!)

    expect(addedRight?.type).toBe('cabinet-module')
    if (addedRight?.type !== 'cabinet-module') return
    expect(addedRight.depth).toBeCloseTo(right.depth)
    expect(addedRight.position[2]).toBeCloseTo(right.position[2])
  })

  test('L additions use source depth for corner width and default depth for the new leg', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_context-depth-corner-run',
      depth: 0.5,
      children: ['cabinet-module_context-depth-corner-source'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-corner-source',
      parentId: run.id,
      position: [0, 0.1, 0.325],
      width: 0.9,
      depth: 0.65,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode])

    expect(addCornerRun({ module: source, run, sceneApi, side: 'right' })).toBeTruthy()

    const baseLeg = Object.values(sceneApi.nodes()).find(
      (node) => node.type === 'cabinet' && node.name === 'Corner Base Run',
    )
    expect(baseLeg?.type).toBe('cabinet')
    if (baseLeg?.type !== 'cabinet') return
    expect(baseLeg.depth).toBeCloseTo(0.5)

    const legModules = (baseLeg.children ?? [])
      .map((id) => sceneApi.get(id as AnyNodeId))
      .filter((node) => node?.type === 'cabinet-module')
    expect(legModules.every((module) => module.depth === 0.5)).toBe(true)
    expect(legModules.find((module) => module.name === 'Corner Filler')?.width).toBeCloseTo(
      source.depth,
    )

    sceneApi.update(source.id as AnyNodeId, { depth: 0.75 })
    syncCornerRunsFromSourceModule({
      module: sceneApi.get(source.id as AnyNodeId) as typeof source,
      run: sceneApi.get(run.id as AnyNodeId) as typeof run,
      sceneApi,
    })
    expect(sceneApi.get(baseLeg.id as AnyNodeId)?.depth).toBeCloseTo(0.5)
    expect(
      (sceneApi.get(baseLeg.id as AnyNodeId) as typeof baseLeg).children
        .map((id) => sceneApi.get(id as AnyNodeId))
        .find((node) => node?.type === 'cabinet-module' && node.name === 'Corner Filler')?.width,
    ).toBeCloseTo(0.75)
  })

  test('L additions use source wall depth for corner width and default depth for the wall leg', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_context-depth-wall-corner-run',
      depth: 0.5,
      children: ['cabinet-module_context-depth-wall-corner-source'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-wall-corner-source',
      parentId: run.id,
      children: ['cabinet-module_context-depth-wall-corner-top'],
      position: [0, 0.1, 0.21],
      width: 0.9,
      depth: 0.42,
    })
    const sourceWall = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-wall-corner-top',
      parentId: source.id,
      name: 'Wall Cabinet',
      position: [0, 1.4, -0.045],
      width: 0.9,
      depth: 0.33,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, sourceWall as AnyNode])

    expect(addCornerRun({ module: source, run, sceneApi, side: 'right' })).toBeTruthy()

    const bridge = Object.values(sceneApi.nodes()).find(
      (node) => node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    expect(bridge?.type).toBe('cabinet-module')
    if (bridge?.type !== 'cabinet-module') return
    expect(bridge.width).toBeCloseTo(0.5 - 0.32)
    expect(bridge.depth).toBeCloseTo(sourceWall.depth)

    const cornerWallFiller = Object.values(sceneApi.nodes()).find(
      (node) => node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )
    expect(cornerWallFiller?.type).toBe('cabinet-module')
    if (cornerWallFiller?.type !== 'cabinet-module') return
    expect(cornerWallFiller.width).toBeCloseTo(sourceWall.depth)
    expect(cornerWallFiller.depth).toBeCloseTo(0.32)

    const connectedBase = Object.values(sceneApi.nodes()).find(
      (node) =>
        node.type === 'cabinet-module' && node.name === 'Base Cabinet' && node.id !== source.id,
    )
    expect(connectedBase?.type).toBe('cabinet-module')
    if (connectedBase?.type !== 'cabinet-module') return
    const connectedWall = (connectedBase.children ?? [])
      .map((id) => sceneApi.get(id as AnyNodeId))
      .find((node) => node?.type === 'cabinet-module' && node.name === 'Wall Cabinet')
    expect(connectedWall?.type).toBe('cabinet-module')
    if (connectedWall?.type !== 'cabinet-module') return
    expect(connectedWall.depth).toBeCloseTo(0.32)
    expect(connectedWall.position[0]).toBeCloseTo(sourceWall.depth - source.depth)

    sceneApi.update(sourceWall.id as AnyNodeId, { depth: 0.46 })
    syncCornerRunsFromSourceModule({
      module: sceneApi.get(source.id as AnyNodeId) as typeof source,
      run: sceneApi.get(run.id as AnyNodeId) as typeof run,
      sceneApi,
    })
    expect(sceneApi.get<CabinetModuleNode>(bridge.id as AnyNodeId)?.depth).toBeCloseTo(0.46)
    expect(sceneApi.get<CabinetModuleNode>(cornerWallFiller.id as AnyNodeId)?.width).toBeCloseTo(
      0.46,
    )
    expect(sceneApi.get<CabinetModuleNode>(connectedWall.id as AnyNodeId)?.position[0]).toBeCloseTo(
      0.46 - source.depth,
    )
  })

  test('L additions clear a wall cabinet that is deeper than its base cabinet', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_context-depth-shallow-corner-run',
      children: ['cabinet-module_context-depth-shallow-corner-source'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-shallow-corner-source',
      parentId: run.id,
      children: ['cabinet-module_context-depth-shallow-corner-wall'],
      position: [0, 0.1, 0.15],
      width: 0.9,
      depth: 0.3,
    })
    const sourceWall = CabinetModuleNode.parse({
      id: 'cabinet-module_context-depth-shallow-corner-wall',
      parentId: source.id,
      name: 'Wall Cabinet',
      position: [0, 1.4, 0.14],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, sourceWall as AnyNode])

    expect(addCornerRun({ module: source, run, sceneApi, side: 'left' })).toBeTruthy()
    const bridge = Object.values(sceneApi.nodes()).find(
      (node) => node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    expect(bridge?.type).toBe('cabinet-module')
    if (bridge?.type !== 'cabinet-module') return
    expect(bridge.width).toBeCloseTo(0.5 - 0.32)
    expect(bridge.depth).toBeCloseTo(sourceWall.depth)

    const cornerWallFiller = Object.values(sceneApi.nodes()).find(
      (node) => node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )
    expect(cornerWallFiller?.type).toBe('cabinet-module')
    if (cornerWallFiller?.type !== 'cabinet-module') return
    expect(cornerWallFiller.width).toBeCloseTo(sourceWall.depth)
    expect(cornerWallFiller.depth).toBeCloseTo(0.32)

    const connectedBase = Object.values(sceneApi.nodes()).find(
      (node) =>
        node.type === 'cabinet-module' && node.name === 'Base Cabinet' && node.id !== source.id,
    )
    expect(connectedBase?.type).toBe('cabinet-module')
    if (connectedBase?.type !== 'cabinet-module') return
    const connectedWall = (connectedBase.children ?? [])
      .map((id) => sceneApi.get(id as AnyNodeId))
      .find((node) => node?.type === 'cabinet-module' && node.name === 'Wall Cabinet')
    expect(connectedWall?.type).toBe('cabinet-module')
    if (connectedWall?.type !== 'cabinet-module') return
    expect(connectedWall.depth).toBeCloseTo(0.32)
    expect(connectedWall.position[0]).toBeCloseTo(-(sourceWall.depth - source.depth))
  })
})
