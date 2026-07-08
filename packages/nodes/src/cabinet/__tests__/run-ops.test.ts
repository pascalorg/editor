import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type SceneApi, WallNode, ZoneNode } from '@pascal-app/core'
import { runLocalToPlan } from '../run-layout'
import {
  addCabinetModuleSide,
  addCornerRun,
  previewCornerAdditionLayout,
  syncCornerRunsFromSourceModule,
  syncCornerStyleGroupFromRun,
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

describe('addCabinetModuleSide', () => {
  test('shrinks a newly added corner-end base cabinet to the remaining wall clearance', () => {
    const levelId = 'level_add-side-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-add-side-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_anchor_add-side-wall-clearance'],
    })
    const anchor = CabinetModuleNode.parse({
      id: 'cabinet-module_anchor_add-side-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const blockingWall = WallNode.parse({
      id: 'wall_add-side-blocking' as AnyNodeId,
      parentId: levelId,
      start: [1.1, -1],
      end: [1.1, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, anchor as AnyNode, blockingWall as AnyNode])

    const id = addCabinetModuleSide({
      anchorModule: anchor,
      run,
      sceneApi,
      side: 'right',
    })

    expect(id).toBeTruthy()
    const added = sceneApi.get<CabinetModuleNode>(id!)
    expect(added?.width).toBeCloseTo(0.55)
    expect(added?.position[0]).toBeCloseTo(0.725)
    expect(sceneApi.get<CabinetModuleNode>(anchor.id)?.width).toBeCloseTo(0.9)
  })

  test('does not add a corner-end base cabinet when remaining wall clearance falls below minimum width', () => {
    const levelId = 'level_add-side-wall-too-tight' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-add-side-wall-too-tight',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_anchor_add-side-wall-too-tight'],
    })
    const anchor = CabinetModuleNode.parse({
      id: 'cabinet-module_anchor_add-side-wall-too-tight',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const blockingWall = WallNode.parse({
      id: 'wall_add-side-too-tight' as AnyNodeId,
      parentId: levelId,
      start: [0.8, -1],
      end: [0.8, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, anchor as AnyNode, blockingWall as AnyNode])

    const id = addCabinetModuleSide({
      anchorModule: anchor,
      run,
      sceneApi,
      side: 'right',
    })

    expect(id).toBeNull()
    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    expect(modulesOut).toHaveLength(1)
  })

  test('shrinks a newly added side cabinet when the run is nested under a level child', () => {
    const levelId = 'level_add-side-zone-parent' as AnyNodeId
    const zone = ZoneNode.parse({
      id: 'zone_add-side-zone-parent' as AnyNodeId,
      parentId: levelId,
      name: 'Kitchen',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const run = CabinetNode.parse({
      id: 'cabinet_run-add-side-zone-parent',
      parentId: zone.id,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_anchor_add-side-zone-parent'],
    })
    const anchor = CabinetModuleNode.parse({
      id: 'cabinet-module_anchor_add-side-zone-parent',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const blockingWall = WallNode.parse({
      id: 'wall_add-side-zone-parent' as AnyNodeId,
      parentId: levelId,
      start: [1.1, -1],
      end: [1.1, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      zone as AnyNode,
      run as AnyNode,
      anchor as AnyNode,
      blockingWall as AnyNode,
    ])

    const id = addCabinetModuleSide({
      anchorModule: anchor,
      run,
      sceneApi,
      side: 'right',
    })

    expect(id).toBeTruthy()
    const added = sceneApi.get<CabinetModuleNode>(id!)
    expect(added?.width).toBeCloseTo(0.55)
    expect(added?.position[0]).toBeCloseTo(0.725)
  })
})

describe('addCornerRun', () => {
  test('creates generated corner pieces under the actual base-cabinet and corner-filler parents', () => {
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
    expect(modulesOut.find((node) => node.name === 'Wall Corner Cabinet')).toBeUndefined()

    const sourceModuleAfter = sceneApi.get<CabinetModuleNode>(module.id)!
    const sourceModuleChildren = (sourceModuleAfter.children ?? [])
      .map((id) => sceneApi.get<AnyNode>(id as AnyNodeId))
      .filter(Boolean)
    expect(sourceModuleChildren.filter((child) => child!.type === 'cabinet-module')).toHaveLength(1)
    expect(
      sourceModuleChildren.find(
        (child) => child!.type === 'cabinet-module' && child!.name === 'Wall Cabinet',
      ),
    ).toBeTruthy()
    const sourceWallTop = sourceModuleChildren.find(
      (child): child is CabinetModuleNode =>
        child!.type === 'cabinet-module' && child!.name === 'Wall Cabinet',
    )
    expect(sourceWallTop?.openSide).toBe('right')

    const legCabinet = modulesOut.find((node) => node.id === selectedId)
    expect(legCabinet?.openSide).toBe('left')
    expect(legCabinet?.parentId).toBeTruthy()
    expect(legCabinet?.width).toBeCloseTo(module.width)
    expect(legCabinet?.stack?.[0]?.type).toBe('door')
    expect(legCabinet?.stack?.[0]?.shelfCount).toBe(3)
    const wallLegCabinet = modulesOut.find(
      (node) => node.name === 'Wall Cabinet' && node.parentId === legCabinet?.id,
    )
    expect(wallLegCabinet?.stack?.[0]?.type).toBe('door')
    expect(wallLegCabinet?.stack?.[0]?.shelfCount).toBe(3)
    expect(wallLegCabinet?.openSide).toBe('left')

    const cornerFiller = modulesOut.find((node) => node.name === 'Corner Filler')
    expect(cornerFiller).toBeTruthy()
    const cornerFillerChildRuns = runs.filter((node) => node.parentId === cornerFiller?.id)
    expect(cornerFillerChildRuns.map((node) => node.name).sort()).toEqual([
      'Corner Wall Bridge',
      'Corner Wall Run',
    ])
    const cornerFillerGrandchildren = cornerFillerChildRuns.flatMap((childRun) =>
      (childRun.children ?? [])
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .filter(Boolean)
        .map((child) => child!.name),
    )
    expect(cornerFillerGrandchildren.sort()).toEqual(['Corner Wall Filler', 'Wall Bridge Filler'])

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
    const linkedBase = modulesOut.find(
      (node) => node.id !== module.id && node.name === 'Base Cabinet',
    )
    expect(linkedBase?.width).toBeCloseTo(0.45)
    expect(
      modulesOut.find((node) => node.name === 'Wall Cabinet' && node.parentId === linkedBase?.id)
        ?.width,
    ).toBeCloseTo(0.45)
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

  test('propagates front styling changes into linked corner runs and modules', () => {
    const levelId = 'level_corner-linked-front-style' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-linked-front-style',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
      children: ['cabinet-module_source-corner-linked-front-style'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-linked-front-style',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
      stack: [{ id: 'door-source-linked-front-style', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    sceneApi.update(
      run.id as AnyNodeId,
      {
        frontStyle: 'raised-arch',
        frontOverlay: 'inset',
        handleStyle: 'knob',
        handlePosition: 'center',
      } as Partial<AnyNode>,
    )
    syncCornerRunsFromSourceModule({
      module: sceneApi.get<CabinetModuleNode>(module.id)!,
      run: sceneApi.get<CabinetNode>(run.id)!,
      sceneApi,
    })

    const nodes = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode | CabinetModuleNode =>
        node.type === 'cabinet' || node.type === 'cabinet-module',
    )
    const linkedNodes = nodes.filter(
      (node) => node.id !== run.id && node.id !== module.id && node.parentId !== module.id,
    )

    expect(linkedNodes.length).toBeGreaterThan(0)
    expect(linkedNodes.every((node) => node.frontStyle === 'raised-arch')).toBe(true)
    expect(linkedNodes.every((node) => node.frontOverlay === 'inset')).toBe(true)
    expect(linkedNodes.every((node) => node.handleStyle === 'knob')).toBe(true)
    expect(linkedNodes.every((node) => node.handlePosition === 'center')).toBe(true)
  })

  test('propagates front styling changes when a derived corner run is the selected run', () => {
    const levelId = 'level_corner-derived-run-front-style' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-derived-front-style',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
      children: ['cabinet-module_source-corner-derived-front-style'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-derived-front-style',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
      stack: [{ id: 'door-source-derived-front-style', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({
      module,
      run,
      sceneApi,
      side: 'right',
    })

    const derivedRun = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetNode => node.type === 'cabinet' && node.name === 'Corner Base Run',
    )!

    const changed = syncCornerStyleGroupFromRun({
      run: derivedRun,
      patch: {
        frontStyle: 'raised-arch',
        frontOverlay: 'inset',
        handleStyle: 'knob',
        handlePosition: 'center',
      },
      sceneApi,
    })

    expect(changed).toBe(true)

    const allCabinets = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode | CabinetModuleNode =>
        node.type === 'cabinet' || node.type === 'cabinet-module',
    )

    expect(allCabinets.every((node) => node.frontStyle === 'raised-arch')).toBe(true)
    expect(allCabinets.every((node) => node.frontOverlay === 'inset')).toBe(true)
    expect(allCabinets.every((node) => node.handleStyle === 'knob')).toBe(true)
    expect(allCabinets.every((node) => node.handlePosition === 'center')).toBe(true)
  })

  test('propagates front styling changes to corner groups on both sides of the source run', () => {
    const levelId = 'level_corner-both-sides-front-style' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-both-sides-front-style',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
      children: [
        'cabinet-module_left-both-sides-front-style',
        'cabinet-module_center-both-sides-front-style',
        'cabinet-module_right-both-sides-front-style',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-both-sides-front-style',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-both-sides-front-style',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-both-sides-front-style',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      frontOverlay: 'full',
      handleStyle: 'bar',
      handlePosition: 'auto',
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
    ])

    addCornerRun({
      module: left,
      run,
      sceneApi,
      side: 'left',
    })
    addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    const changed = syncCornerStyleGroupFromRun({
      run: sceneApi.get<CabinetNode>(run.id)!,
      patch: {
        frontStyle: 'raised-arch',
        frontOverlay: 'inset',
        handleStyle: 'knob',
        handlePosition: 'center',
      },
      sceneApi,
    })

    expect(changed).toBe(true)

    const allCabinets = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode | CabinetModuleNode =>
        node.type === 'cabinet' || node.type === 'cabinet-module',
    )

    expect(allCabinets.every((node) => node.frontStyle === 'raised-arch')).toBe(true)
    expect(allCabinets.every((node) => node.frontOverlay === 'inset')).toBe(true)
    expect(allCabinets.every((node) => node.handleStyle === 'knob')).toBe(true)
    expect(allCabinets.every((node) => node.handlePosition === 'center')).toBe(true)
  })

  test('propagates front styling into linked runs even when the corner re-layout bails', () => {
    const levelId = 'level_corner-style-layout-bail' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-style-layout-bail',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      children: ['cabinet-module_source-style-layout-bail'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-style-layout-bail',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      stack: [{ id: 'door-style-layout-bail', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({ module, run, sceneApi, side: 'right' })

    // A wall drawn AFTER the corner exists blocks computeCornerRunLayout
    // (connected width falls below minimum), so syncDerivedCornerRun bails.
    const blockingWall = WallNode.parse({
      id: 'wall_style-layout-bail' as AnyNodeId,
      parentId: levelId,
      start: [0, 0.5],
      end: [3, 0.5],
      thickness: 0.2,
    })
    sceneApi.upsert(blockingWall as AnyNode)

    const changed = syncCornerStyleGroupFromRun({
      run: sceneApi.get<CabinetNode>(run.id)!,
      patch: { frontStyle: 'raised-arch' },
      sceneApi,
    })

    expect(changed).toBe(true)
    const allCabinets = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode | CabinetModuleNode =>
        node.type === 'cabinet' || node.type === 'cabinet-module',
    )
    expect(allCabinets.every((node) => node.frontStyle === 'raised-arch')).toBe(true)
  })

  test('propagates front styling into a leg run that gained extra modules', () => {
    const levelId = 'level_corner-style-extended-leg' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-style-extended-leg',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      children: ['cabinet-module_source-style-extended-leg'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-style-extended-leg',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      stack: [{ id: 'door-style-extended-leg', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({ module, run, sceneApi, side: 'right' })

    // Extending the leg gives it modules that don't match the derived-run
    // spec names, which makes syncDerivedCornerRun's re-layout bail.
    const legRun = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetNode => node.type === 'cabinet' && node.name === 'Corner Base Run',
    )!
    addCabinetModuleSide({ anchorModule: null, run: legRun, sceneApi, side: 'right' })

    const changed = syncCornerStyleGroupFromRun({
      run: sceneApi.get<CabinetNode>(run.id)!,
      patch: { frontStyle: 'raised-arch' },
      sceneApi,
    })

    expect(changed).toBe(true)
    const allCabinets = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode | CabinetModuleNode =>
        node.type === 'cabinet' || node.type === 'cabinet-module',
    )
    expect(allCabinets.every((node) => node.frontStyle === 'raised-arch')).toBe(true)
  })

  test('anchors the right bridge filler to the live source wall cabinet edge', () => {
    const levelId = 'level_corner-bridge-anchor-right' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-bridge-anchor-right',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-bridge-anchor-right',
        'cabinet-module_center-bridge-anchor-right',
        'cabinet-module_right-bridge-anchor-right',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-bridge-anchor-right',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-bridge-anchor-right',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_center-wall-bridge-anchor-right'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-bridge-anchor-right',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-bridge-anchor-right',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const sourceWall = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' &&
        node.name === 'Wall Cabinet' &&
        node.parentId === right.id,
    )
    const bridgeFiller = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )

    expect(sourceWall).toBeTruthy()
    expect(bridgeFiller).toBeTruthy()

    const sourceWallWorld = resolveCabinetWorldTransform(sourceWall!, nodes)
    const bridgeWorld = resolveCabinetWorldTransform(bridgeFiller!, nodes)

    expect(bridgeWorld.position[0] - bridgeFiller!.width / 2).toBeCloseTo(
      sourceWallWorld.position[0] + sourceWall!.width / 2,
    )
    expect(bridgeWorld.position[2]).toBeCloseTo(sourceWallWorld.position[2])
  })

  test('anchors the left bridge filler to the live source wall cabinet edge', () => {
    const levelId = 'level_corner-bridge-anchor-left' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-bridge-anchor-left',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-bridge-anchor-left',
        'cabinet-module_center-bridge-anchor-left',
        'cabinet-module_right-bridge-anchor-left',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-bridge-anchor-left',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-bridge-anchor-left',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_center-wall-bridge-anchor-left'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-bridge-anchor-left',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-bridge-anchor-left',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: left,
      run,
      sceneApi,
      side: 'left',
    })

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const sourceWall = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Cabinet' && node.parentId === left.id,
    )
    const bridgeFiller = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )

    expect(sourceWall).toBeTruthy()
    expect(bridgeFiller).toBeTruthy()

    const sourceWallWorld = resolveCabinetWorldTransform(sourceWall!, nodes)
    const bridgeWorld = resolveCabinetWorldTransform(bridgeFiller!, nodes)

    expect(bridgeWorld.position[0] + bridgeFiller!.width / 2).toBeCloseTo(
      sourceWallWorld.position[0] - sourceWall!.width / 2,
    )
    expect(bridgeWorld.position[2]).toBeCloseTo(sourceWallWorld.position[2])
  })

  test('keeps the left bridge filler anchored after resyncing the source module', () => {
    const levelId = 'level_corner-bridge-anchor-left-resync' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-bridge-anchor-left-resync',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-bridge-anchor-left-resync',
        'cabinet-module_center-bridge-anchor-left-resync',
        'cabinet-module_right-bridge-anchor-left-resync',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-bridge-anchor-left-resync',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-bridge-anchor-left-resync',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_center-wall-bridge-anchor-left-resync'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-bridge-anchor-left-resync',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-bridge-anchor-left-resync',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: left,
      run,
      sceneApi,
      side: 'left',
    })

    syncCornerRunsFromSourceModule({
      module: sceneApi.get<CabinetModuleNode>(left.id)!,
      run: sceneApi.get<CabinetNode>(run.id)!,
      sceneApi,
    })

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const sourceWall = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Cabinet' && node.parentId === left.id,
    )
    const bridgeFiller = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )

    expect(sourceWall).toBeTruthy()
    expect(bridgeFiller).toBeTruthy()

    const sourceWallWorld = resolveCabinetWorldTransform(sourceWall!, nodes)
    const bridgeWorld = resolveCabinetWorldTransform(bridgeFiller!, nodes)

    expect(bridgeWorld.position[0] + bridgeFiller!.width / 2).toBeCloseTo(
      sourceWallWorld.position[0] - sourceWall!.width / 2,
    )
    expect(bridgeWorld.position[2]).toBeCloseTo(sourceWallWorld.position[2])
  })

  test('keeps the right bridge filler anchored after syncing a front-style change', () => {
    const levelId = 'level_corner-bridge-anchor-right-style-sync' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-bridge-anchor-right-style-sync',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      frontStyle: 'slab',
      children: [
        'cabinet-module_left-bridge-anchor-right-style-sync',
        'cabinet-module_center-bridge-anchor-right-style-sync',
        'cabinet-module_right-bridge-anchor-right-style-sync',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-bridge-anchor-right-style-sync',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-bridge-anchor-right-style-sync',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
      children: ['cabinet-module_center-wall-bridge-anchor-right-style-sync'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-bridge-anchor-right-style-sync',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      frontStyle: 'slab',
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-bridge-anchor-right-style-sync',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
      frontStyle: 'slab',
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    const changed = syncCornerStyleGroupFromRun({
      run: sceneApi.get<CabinetNode>(run.id)!,
      patch: {
        frontStyle: 'raised-arch',
      },
      sceneApi,
    })

    expect(changed).toBe(true)

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const sourceWall = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' &&
        node.name === 'Wall Cabinet' &&
        node.parentId === right.id,
    )
    const bridgeFiller = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )

    expect(sourceWall).toBeTruthy()
    expect(bridgeFiller).toBeTruthy()

    const sourceWallWorld = resolveCabinetWorldTransform(sourceWall!, nodes)
    const bridgeWorld = resolveCabinetWorldTransform(bridgeFiller!, nodes)

    expect(bridgeWorld.position[0] - bridgeFiller!.width / 2).toBeCloseTo(
      sourceWallWorld.position[0] + sourceWall!.width / 2,
    )
    expect(bridgeWorld.position[2]).toBeCloseTo(sourceWallWorld.position[2])
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

    const linkedBase = modulesOut.find(
      (node) => node.id !== module.id && node.name === 'Base Cabinet',
    )
    expect(
      modulesOut.find((node) => node.name === 'Wall Cabinet' && node.parentId === linkedBase?.id),
    ).toBeTruthy()
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
    expect((secondSelectedModule.metadata as Record<string, unknown>).nodeSelectionProxyId).toBe(
      secondDerivedRun.id,
    )
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

  test('reports the trimmed corner width during preview before adding the corner run', () => {
    const levelId = 'level_corner-wall-clearance-preview' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-clearance-preview',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-wall-clearance-preview'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-wall-clearance-preview',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-wall-clearance-preview', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-blocker-preview',
      parentId: levelId,
      start: [-1, 0.95],
      end: [2, 0.95],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode, blockingWall as AnyNode])

    const preview = previewCornerAdditionLayout({
      module,
      run,
      nodes: sceneApi.nodes(),
      side: 'right',
    })

    expect(preview).toBeTruthy()
    expect(preview?.connectedWidth).toBeCloseTo(0.56)
    expect(preview?.sourceWidth).toBeCloseTo(0.56)
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
