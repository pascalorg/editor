import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type SceneApi, WallNode } from '@pascal-app/core'
import { runLocalToPlan } from '../run-layout'
import {
  addCornerRun,
  syncCornerRunsFromSourceModule,
  wallBottomHeightForTallAlignment,
} from '../run-ops'
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
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent && Array.isArray((parent as { children?: unknown }).children)) {
          const children = new Set(((parent as { children?: AnyNodeId[] }).children ?? []).slice())
          children.add(node.id as AnyNodeId)
          nodes[parentId] = { ...parent, children: [...children] } as AnyNode
        }
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

function resolveCabinetWorldTransform(
  node: CabinetNode | CabinetModuleNode,
  nodes: Record<AnyNodeId, AnyNode>,
): { position: [number, number, number]; rotation: number } {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (parent?.type === 'cabinet' || parent?.type === 'cabinet-module') {
    const worldParent = resolveCabinetWorldTransform(parent, nodes)
    return {
      position: runLocalToPlan(
        {
          position: worldParent.position,
          rotation: worldParent.rotation,
        },
        node.position,
      ),
      rotation: worldParent.rotation + node.rotation,
    }
  }

  return {
    position: [...node.position] as [number, number, number],
    rotation: node.rotation,
  }
}

describe('addCornerRun', () => {
  test('creates a base leg plus matching wall runs with corner fillers', () => {
    const levelId = 'level_corner-test' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      withCountertop: true,
      countertopThickness: 0.04,
      countertopOverhang: 0.03,
      countertopBackOverhang: 0.12,
      withFinishedBack: true,
      children: ['cabinet-module_source-corner'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      plinthHeight: 0,
      showPlinth: false,
      withCountertop: false,
      stack: [{ id: 'door-source', type: 'door', shelfCount: 3 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    const selectedId = addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    expect(selectedId).toBeTruthy()

    const allNodes = Object.values(sceneApi.nodes())
    const runs = allNodes.filter((node): node is CabinetNode => node.type === 'cabinet')
    const modulesOut = allNodes.filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )

    expect(runs).toHaveLength(4)
    expect(runs.filter((node) => node.runTier === 'wall')).toHaveLength(2)
    expect(modulesOut).toHaveLength(7)

    const fillers = modulesOut.filter((node) => node.moduleKind === 'corner-filler')
    expect(fillers).toHaveLength(3)
    expect(fillers.filter((node) => node.cornerShelf)).toHaveLength(3)
    expect(fillers.every((node) => node.stack?.[0]?.shelfCount === 3)).toBe(true)
    const bridgeFiller = fillers.find((node) => node.name === 'Wall Bridge Filler')
    expect(bridgeFiller?.openSide).toBe('left')
    expect(bridgeFiller?.cornerShelf).toBe(true)
    expect(bridgeFiller?.stack?.[0]?.type).toBe('door')
    expect(bridgeFiller?.stack?.[0]?.shelfCount).toBe(3)
    const wallCornerCabinet = modulesOut.find((node) => node.name === 'Wall Corner Cabinet')
    expect(wallCornerCabinet?.openSide).toBe('right')
    expect(wallCornerCabinet?.stack?.[0]?.type).toBe('door')
    expect(wallCornerCabinet?.stack?.[0]?.shelfCount).toBe(3)

    // The L legs are siblings of the source module under the SOURCE RUN —
    // the run is the modular cabinet group; the clicked module stays a
    // plain module (no cabinet children).
    const derivedRunNodes = runs.filter((node) => node.id !== run.id)
    expect(derivedRunNodes.every((node) => node.parentId === run.id)).toBe(true)
    const sourceModuleAfter = sceneApi.get<CabinetModuleNode>(module.id)!
    const sourceModuleChildren = (sourceModuleAfter.children ?? [])
      .map((id) => sceneApi.get<AnyNode>(id as AnyNodeId))
      .filter(Boolean)
    expect(sourceModuleChildren.every((child) => child!.type !== 'cabinet')).toBe(true)

    const legCabinet = modulesOut.find((node) => node.id === selectedId)
    expect(legCabinet?.openSide).toBe('left')
    expect(legCabinet?.parentId).toBeTruthy()
    expect(legCabinet?.width).toBeCloseTo(module.width)
    expect(legCabinet?.stack?.[0]?.type).toBe('door')
    expect(legCabinet?.stack?.[0]?.shelfCount).toBe(3)
    const wallLegCabinet = modulesOut.find((node) => node.name === 'Wall Cabinet')
    expect(wallLegCabinet?.stack?.[0]?.type).toBe('door')
    expect(wallLegCabinet?.stack?.[0]?.shelfCount).toBe(3)

    const derivedRuns = runs.filter((node) => node.id !== run.id)
    const baseLeg = derivedRuns.find((node) => node.runTier === 'base')
    expect(baseLeg?.withCountertop).toBe(true)
    expect(baseLeg?.countertopThickness).toBeCloseTo(run.countertopThickness)
    expect(baseLeg?.countertopOverhang).toBeCloseTo(run.countertopOverhang)
    expect(baseLeg?.countertopBackOverhang).toBeCloseTo(run.countertopBackOverhang)
    expect(baseLeg?.withFinishedBack).toBe(true)

    const sourceAfter = sceneApi.get<CabinetNode>(run.id)!
    const metadata = sourceAfter.metadata as Record<string, unknown>
    expect(typeof metadata.cabinetLayoutRevision).toBe('number')
  })

  test('inherits the connected cabinet shelf count for every generated corner module', () => {
    const levelId = 'level_corner-shelf-inheritance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-shelf-inheritance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-shelf-inheritance'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-shelf-inheritance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      plinthHeight: 0,
      showPlinth: false,
      withCountertop: false,
      stack: [{ id: 'door-source-shelf-inheritance', type: 'door', shelfCount: 5 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const generatedModules = modulesOut.filter((node) => node.parentId !== run.id)

    expect(generatedModules).toHaveLength(6)
    expect(generatedModules.every((node) => node.stack?.[0]?.type === 'door')).toBe(true)
    expect(generatedModules.every((node) => node.stack?.[0]?.shelfCount === 5)).toBe(true)
  })

  test('keeps linked L runs aligned when the source cabinet width changes later', () => {
    const levelId = 'level_corner-linked-width' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-linked-width',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      withCountertop: true,
      children: ['cabinet-module_source-corner-linked-width'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-linked-width',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-linked-width', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    sceneApi.update(module.id as AnyNodeId, { width: 0.45 } as Partial<AnyNode>)
    syncCornerRunsFromSourceModule({
      module: sceneApi.get<CabinetModuleNode>(module.id)!,
      run: sceneApi.get<CabinetNode>(run.id)!,
      sceneApi,
    })

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    expect(modulesOut.find((node) => node.name === 'Base Cabinet')?.width).toBeCloseTo(0.45)
    expect(modulesOut.find((node) => node.name === 'Wall Cabinet')?.width).toBeCloseTo(0.45)
  })

  test('re-anchors linked L runs when the source module moves along its run', () => {
    const levelId = 'level_corner-linked-move' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-linked-move',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-linked-move'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-linked-move',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-linked-move', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({ module, run, sceneApi, side: 'right' })

    const baseLegBefore = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetNode => node.type === 'cabinet' && node.name === 'Corner Base Run',
    )!
    const legWorldBefore = resolveCabinetWorldTransform(
      baseLegBefore,
      sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
    )

    const delta = 0.5
    sceneApi.update(
      module.id as AnyNodeId,
      {
        position: [module.position[0] + delta, module.position[1], module.position[2]],
      } as Partial<AnyNode>,
    )
    syncCornerRunsFromSourceModule({
      module: sceneApi.get<CabinetModuleNode>(module.id)!,
      run: sceneApi.get<CabinetNode>(run.id)!,
      sceneApi,
    })

    const baseLegAfter = sceneApi.get<CabinetNode>(baseLegBefore.id)!
    const legWorldAfter = resolveCabinetWorldTransform(
      baseLegAfter,
      sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
    )
    expect(legWorldAfter.position[0] - legWorldBefore.position[0]).toBeCloseTo(delta)
    expect(legWorldAfter.position[2]).toBeCloseTo(legWorldBefore.position[2])
    expect(legWorldAfter.rotation).toBeCloseTo(legWorldBefore.rotation)
  })

  test('adds only the uncovered bridge piece when a wall-top already occupies the corner', () => {
    const levelId = 'level_corner-wall-existing' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-existing-wall',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-existing-wall'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-existing-wall',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const existingWallRun = CabinetNode.parse({
      id: 'cabinet_existing-wall-run',
      parentId: levelId,
      position: [0, wallBottomHeightForTallAlignment(), -0.13],
      rotation: 0,
      runTier: 'wall',
      depth: 0.32,
      carcassHeight: 0.72,
      children: ['cabinet-module_existing-wall-module'],
    })
    const existingWallModule = CabinetModuleNode.parse({
      id: 'cabinet-module_existing-wall-module',
      parentId: existingWallRun.id,
      position: [0, 0, 0],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      module as AnyNode,
      existingWallRun as AnyNode,
      existingWallModule as AnyNode,
    ])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    const runs = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode => node.type === 'cabinet',
    )
    expect(runs.filter((node) => node.runTier === 'wall')).toHaveLength(3)

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const bridgeFillers = modulesOut.filter((node) => node.name === 'Wall Bridge Filler')
    expect(bridgeFillers).toHaveLength(1)
    expect(bridgeFillers[0]?.width).toBeCloseTo(0.26)

    const wallCornerCabinets = modulesOut.filter((node) => node.name === 'Wall Corner Cabinet')
    expect(wallCornerCabinets).toHaveLength(0)
  })

  test('creates nested second-corner runs in the correct world position', () => {
    const levelId = 'level_corner-double-nested' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-double-nested',
      parentId: levelId,
      position: [1.6, 0, 2.1],
      rotation: Math.PI / 2,
      withCountertop: true,
      children: ['cabinet-module_source-corner-double-nested'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-double-nested',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-double-nested', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    const firstSelectedId = addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    const firstSelectedModule = sceneApi.get<CabinetModuleNode>(firstSelectedId!)!
    const firstDerivedRun = sceneApi.get<CabinetNode>(firstSelectedModule.parentId as AnyNodeId)!

    const secondSelectedId = addCornerRun({
      module: firstSelectedModule,
      run: firstDerivedRun,
      sceneApi,
      side: 'right',
    })

    expect(secondSelectedId).toBeTruthy()

    const secondSelectedModule = sceneApi.get<CabinetModuleNode>(secondSelectedId!)!
    const secondDerivedRun = sceneApi.get<CabinetNode>(secondSelectedModule.parentId as AnyNodeId)!
    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const firstDerivedWorld = resolveCabinetWorldTransform(firstDerivedRun, nodes)
    const secondDerivedWorld = resolveCabinetWorldTransform(secondDerivedRun, nodes)
    const secondModuleWorld = resolveCabinetWorldTransform(secondSelectedModule, nodes)

    expect(Math.abs(secondDerivedWorld.rotation - firstDerivedWorld.rotation)).toBeCloseTo(
      Math.PI / 2,
    )
    expect(
      Math.hypot(
        secondDerivedWorld.position[0] - firstDerivedWorld.position[0],
        secondDerivedWorld.position[2] - firstDerivedWorld.position[2],
      ),
    ).toBeGreaterThan(0.3)
    expect(
      Math.hypot(
        secondModuleWorld.position[0] - secondDerivedWorld.position[0],
        secondModuleWorld.position[2] - secondDerivedWorld.position[2],
      ),
    ).toBeGreaterThan(0.1)
  })

  test('shortens the generated corner leg when a wall blocks the new span', () => {
    const levelId = 'level_corner-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-wall-clearance'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-wall-clearance', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-blocker',
      parentId: levelId,
      start: [-1, 0.95],
      end: [2, 0.95],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode, blockingWall as AnyNode])

    const selectedId = addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    expect(selectedId).toBeTruthy()

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const sourceAfter = sceneApi.get<CabinetModuleNode>(module.id)!
    const legCabinet = modulesOut.find((node) => node.id === selectedId)
    const wallLegCabinet = modulesOut.find((node) => node.name === 'Wall Cabinet')

    expect(sourceAfter.width).toBeCloseTo(0.56)
    expect(legCabinet?.width).toBeCloseTo(0.56)
    expect(wallLegCabinet?.width).toBeCloseTo(0.56)
  })

  test('does not add a corner leg when a blocking wall leaves no usable cabinet width', () => {
    const levelId = 'level_corner-wall-blocked' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-blocked',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-wall-blocked'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-wall-blocked',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-wall-blocked', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-too-close',
      parentId: levelId,
      start: [-1, 0.65],
      end: [2, 0.65],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode, blockingWall as AnyNode])

    const selectedId = addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    expect(selectedId).toBeNull()

    const runs = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode => node.type === 'cabinet',
    )
    expect(runs).toHaveLength(1)
  })

  test('keeps an existing wall top aligned when the source corner cabinet is trimmed to fit', () => {
    const levelId = 'level_corner-wall-top-trim' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-top-trim',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-wall-top-trim'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-wall-top-trim',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_source-wall-top-trim'],
      stack: [{ id: 'door-source-wall-top-trim', type: 'door', shelfCount: 2 }],
    })
    const wallTop = CabinetModuleNode.parse({
      id: 'cabinet-module_source-wall-top-trim',
      parentId: module.id,
      position: [0, wallBottomHeightForTallAlignment() - module.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-wall-top-door', type: 'door', shelfCount: 1 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-blocker-wall-top',
      parentId: levelId,
      start: [-1, 0.95],
      end: [2, 0.95],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      module as AnyNode,
      wallTop as AnyNode,
      blockingWall as AnyNode,
    ])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    expect(sceneApi.get<CabinetModuleNode>(module.id)!.width).toBeCloseTo(0.56)
    expect(sceneApi.get<CabinetModuleNode>(wallTop.id)!.width).toBeCloseTo(0.56)

    const wallTopAfter = sceneApi.get<CabinetModuleNode>(wallTop.id)!
    const bridgeFiller = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    expect(bridgeFiller).toBeTruthy()

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const wallTopWorld = resolveCabinetWorldTransform(wallTopAfter, nodes)
    const bridgeWorld = resolveCabinetWorldTransform(bridgeFiller!, nodes)

    const wallTopRightEdge = wallTopWorld.position[0] + wallTopAfter.width / 2
    const bridgeLeftEdge = bridgeWorld.position[0] - bridgeFiller!.width / 2
    expect(bridgeLeftEdge).toBeCloseTo(wallTopRightEdge)
  })
})
