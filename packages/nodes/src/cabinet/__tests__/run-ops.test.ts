import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type SceneApi, WallNode, ZoneNode } from '@pascal-app/core'
import { runLocalToPlan } from '../run-layout'
import {
  addCabinetModuleSide,
  addCornerRun,
  backAlignedRunDepthOverrides,
  backAlignZ,
  cabinetModulesForRun,
  cornerSourceWidthOverridesForDerivedDepth,
  previewCornerAdditionLayout,
  previewCornerRunsFromRunSources,
  syncCornerRunsFromRunSources,
  syncCornerRunsFromSourceModule,
  syncCornerStyleGroupFromRun,
  wallBottomHeightForTallAlignment,
  wallChildOf,
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
  test('group depth resize keeps one stable back plane through grow and shrink cycles', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_back-aligned-depth-run',
      depth: 0.58,
      children: ['cabinet-module_back-left', 'cabinet-module_back-right'],
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_back-left',
        parentId: run.id,
        position: [-0.3, 0.1, 0],
        width: 0.6,
        depth: 0.58,
        children: ['cabinet-module_back-left-wall'],
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_back-right',
        parentId: run.id,
        position: [0.3, 0.1, 0.02],
        width: 0.6,
        depth: 0.58,
      }),
    ]
    const wall = CabinetModuleNode.parse({
      id: 'cabinet-module_back-left-wall',
      parentId: modules[0]!.id,
      name: 'Wall Cabinet',
      position: [0, 1.35, backAlignZ(0.58, 0.32)],
      width: 0.6,
      depth: 0.32,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      ...modules.map((module) => module as AnyNode),
      wall as AnyNode,
    ])
    const originalBack = -0.29

    for (const depth of [0.82, 0.42, 0.68]) {
      const liveRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth }
      for (const [id, override] of backAlignedRunDepthOverrides(liveRun, sceneApi.nodes(), depth)) {
        sceneApi.update(id, override)
      }
      sceneApi.update(run.id as AnyNodeId, { depth })

      const backs = liveRun.children.map((id) => {
        const module = sceneApi.get<CabinetModuleNode>(id as AnyNodeId)!
        return module.position[2] - module.depth / 2
      })
      expect(backs[0]).toBeCloseTo(originalBack)
      expect(backs[1]).toBeCloseTo(originalBack)
      const liveBase = sceneApi.get<CabinetModuleNode>(modules[0]!.id)!
      const liveWall = sceneApi.get<CabinetModuleNode>(wall.id)!
      expect(liveBase.position[2] + liveWall.position[2] - liveWall.depth / 2).toBeCloseTo(
        originalBack,
      )
      expect(liveWall.width).toBeCloseTo(0.6)
    }
  })

  test('adds a default base cabinet at 0.5m wide and 0.5m deep', () => {
    const levelId = 'level_add-side-default-size' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-add-side-default-size',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
    })
    const sceneApi = sceneApiFixture([run as AnyNode])

    const id = addCabinetModuleSide({
      anchorModule: null,
      run,
      sceneApi,
      side: 'right',
    })

    expect(id).toBeTruthy()
    const added = sceneApi.get<CabinetModuleNode>(id!)
    expect(added?.width).toBeCloseTo(0.5)
    expect(added?.depth).toBeCloseTo(0.5)
  })

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
    expect(added?.width).toBeCloseTo(0.5)
    expect(added?.position[0]).toBeCloseTo(0.7)
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
    expect(added?.width).toBeCloseTo(0.5)
    expect(added?.position[0]).toBeCloseTo(0.7)
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

  test('keeps both corner fillers consistent when a two-ended source run changes depth', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-both-sides-depth',
      depth: 0.58,
      children: [
        'cabinet-module_left-both-sides-depth',
        'cabinet-module_center-both-sides-depth',
        'cabinet-module_right-both-sides-depth',
      ],
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_left-both-sides-depth',
        parentId: run.id,
        position: [-0.75, 0.1, 0],
        width: 0.6,
        depth: 0.58,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_center-both-sides-depth',
        parentId: run.id,
        position: [0, 0.1, 0],
        width: 0.9,
        depth: 0.58,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_right-both-sides-depth',
        parentId: run.id,
        position: [0.75, 0.1, 0],
        width: 0.6,
        depth: 0.58,
      }),
    ]
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      ...modules.map((module) => module as AnyNode),
    ])

    addCornerRun({ module: modules[0]!, run, sceneApi, side: 'left' })
    addCornerRun({ module: modules[2]!, run, sceneApi, side: 'right' })

    const resizedRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth: 0.78 }
    const previewOverrides = new Map(
      previewCornerRunsFromRunSources({
        baseLayout: 'width-only',
        run: resizedRun,
        sceneApi,
      }),
    )
    const previewFillers = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Filler',
    )
    expect(previewFillers).toHaveLength(2)
    for (const filler of previewFillers) {
      expect(previewOverrides.get(filler.id as AnyNodeId)?.width).toBeCloseTo(0.78)
      expect(filler.width).toBeCloseTo(0.58)
    }
    const previewConnectedCabinets = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Base Cabinet',
    )
    expect(previewConnectedCabinets).toHaveLength(2)
    for (const cabinet of previewConnectedCabinets) {
      expect(previewOverrides.get(cabinet.id as AnyNodeId)?.width).toBeCloseTo(0.4)
      expect(cabinet.width).toBeCloseTo(0.6)
    }
    const connectedWallCabinets = previewConnectedCabinets
      .map((cabinet) => wallChildOf(cabinet, sceneApi.nodes()))
      .filter((cabinet): cabinet is CabinetModuleNode => cabinet != null)
    expect(connectedWallCabinets).toHaveLength(2)
    for (const wallCabinet of connectedWallCabinets) {
      expect(previewOverrides.get(wallCabinet.id as AnyNodeId)?.width).toBeCloseTo(0.4)
      expect(wallCabinet.width).toBeCloseTo(0.6)
    }
    const cornerWallFillers = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )
    const bridgeWallFillers = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    expect(cornerWallFillers).toHaveLength(2)
    expect(bridgeWallFillers).toHaveLength(2)
    const bridgeWidths = new Map(bridgeWallFillers.map((filler) => [filler.id, filler.width]))
    for (const filler of cornerWallFillers) {
      const preview = previewOverrides.get(filler.id as AnyNodeId)!
      expect(preview.width).toBeCloseTo(0.78)
      const parentRun = sceneApi.get<CabinetNode>(filler.parentId as AnyNodeId)!
      const side = (parentRun.metadata as Record<string, { side?: 'left' | 'right' }> | null)
        ?.cabinetCornerDerivedRun?.side
      const previewX = preview.position?.[0] ?? filler.position[0]
      if (side === 'left') {
        expect(previewX + preview.width! / 2).toBeCloseTo(filler.position[0] + filler.width / 2)
      } else {
        expect(previewX - preview.width! / 2).toBeCloseTo(filler.position[0] - filler.width / 2)
      }
    }
    for (const filler of bridgeWallFillers) {
      expect(previewOverrides.get(filler.id as AnyNodeId)?.width).toBeUndefined()
    }
    const wallRuns = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode => node.type === 'cabinet' && node.runTier === 'wall',
    )
    expect(wallRuns).toHaveLength(4)
    const wallRunWorldPositions = new Map(
      wallRuns.map((wallRun) => [
        wallRun.id,
        resolveCabinetWorldTransform(wallRun, sceneApi.nodes() as Record<AnyNodeId, AnyNode>)
          .position,
      ]),
    )
    const previewNodes = { ...sceneApi.nodes() } as Record<AnyNodeId, AnyNode>
    for (const [id, override] of previewOverrides) {
      if (previewNodes[id]) previewNodes[id] = { ...previewNodes[id], ...override } as AnyNode
    }
    for (const wallRun of wallRuns) {
      const previewWorld = resolveCabinetWorldTransform(
        previewNodes[wallRun.id] as CabinetNode,
        previewNodes,
      )
      const originalWorld = wallRunWorldPositions.get(wallRun.id)!
      expect(previewWorld.position[0]).toBeCloseTo(originalWorld[0])
      expect(previewWorld.position[2]).toBeCloseTo(originalWorld[2])
    }

    sceneApi.update(run.id as AnyNodeId, { depth: resizedRun.depth })
    syncCornerRunsFromRunSources({
      baseLayout: 'width-only',
      run: resizedRun,
      sceneApi,
    })

    const derivedBaseRuns = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode =>
        node.type === 'cabinet' &&
        (node.metadata as Record<string, { role?: string }> | null)?.cabinetCornerDerivedRun
          ?.role === 'base-leg',
    )
    expect(derivedBaseRuns).toHaveLength(2)
    for (const derivedRun of derivedBaseRuns) {
      const derivedModules = derivedRun.children
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .filter((module): module is CabinetModuleNode => module?.type === 'cabinet-module')
      expect(derivedModules.find((module) => module.name === 'Corner Filler')?.width).toBeCloseTo(
        0.78,
      )
      expect(derivedModules.find((module) => module.name === 'Base Cabinet')?.width).toBeCloseTo(
        0.4,
      )
      const connectedBase = derivedModules.find((module) => module.name === 'Base Cabinet')!
      expect(wallChildOf(connectedBase, sceneApi.nodes())?.width).toBeCloseTo(0.4)
      expect(derivedRun.depth).toBeCloseTo(0.58)
    }
    for (const filler of cornerWallFillers) {
      expect(sceneApi.get<CabinetModuleNode>(filler.id as AnyNodeId)?.width).toBeCloseTo(0.78)
    }
    for (const filler of bridgeWallFillers) {
      expect(sceneApi.get<CabinetModuleNode>(filler.id as AnyNodeId)?.width).toBeCloseTo(
        bridgeWidths.get(filler.id)!,
      )
    }
    for (const wallRun of wallRuns) {
      const committedWorld = resolveCabinetWorldTransform(
        sceneApi.get<CabinetNode>(wallRun.id)!,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const originalWorld = wallRunWorldPositions.get(wallRun.id)!
      expect(committedWorld.position[0]).toBeCloseTo(originalWorld[0])
      expect(committedWorld.position[2]).toBeCloseTo(originalWorld[2])
    }

    for (const wallCabinet of connectedWallCabinets) {
      const liveWall = sceneApi.get<CabinetModuleNode>(wallCabinet.id as AnyNodeId)!
      sceneApi.update(liveWall.id as AnyNodeId, {
        position: [0.05, liveWall.position[1], liveWall.position[2]],
      })
    }

    const shrunkRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth: 0.48 }
    sceneApi.update(run.id as AnyNodeId, { depth: shrunkRun.depth })
    syncCornerRunsFromRunSources({ baseLayout: 'width-only', run: shrunkRun, sceneApi })

    for (const derivedRun of derivedBaseRuns) {
      const derivedModules = derivedRun.children
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .filter((module): module is CabinetModuleNode => module?.type === 'cabinet-module')
      expect(derivedModules.find((module) => module.name === 'Corner Filler')?.width).toBeCloseTo(
        0.48,
      )
      expect(derivedModules.find((module) => module.name === 'Base Cabinet')?.width).toBeCloseTo(
        0.7,
      )
      const connectedBase = derivedModules.find((module) => module.name === 'Base Cabinet')!
      expect(wallChildOf(connectedBase, sceneApi.nodes())?.width).toBeCloseTo(0.7)
    }
    for (const filler of cornerWallFillers) {
      expect(sceneApi.get<CabinetModuleNode>(filler.id as AnyNodeId)?.width).toBeCloseTo(0.48)
    }
    for (const derivedRun of derivedBaseRuns) {
      const side = (derivedRun.metadata as Record<string, { side?: 'left' | 'right' }> | null)
        ?.cabinetCornerDerivedRun?.side
      const connectedBase = derivedRun.children
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .find((module) => module?.type === 'cabinet-module' && module.name === 'Base Cabinet')!
      const connectedWall = wallChildOf(connectedBase, sceneApi.nodes())!
      const cornerWallId = cornerWallFillers.find((filler) => {
        const parentRun = sceneApi.get<CabinetNode>(filler.parentId as AnyNodeId)
        return (
          (parentRun?.metadata as Record<string, { side?: 'left' | 'right' }> | null)
            ?.cabinetCornerDerivedRun?.side === side
        )
      })!.id
      const liveConnectedWall = sceneApi.get<CabinetModuleNode>(connectedWall.id as AnyNodeId)!
      const liveCornerWall = sceneApi.get<CabinetModuleNode>(cornerWallId as AnyNodeId)!
      expect(liveConnectedWall.position[0]).toBeCloseTo(0)
      const runWorld = resolveCabinetWorldTransform(
        derivedRun,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const wallWorld = resolveCabinetWorldTransform(
        liveConnectedWall,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const cornerWorld = resolveCabinetWorldTransform(
        liveCornerWall,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const localX = (position: [number, number, number]) => {
        const dx = position[0] - runWorld.position[0]
        const dz = position[2] - runWorld.position[2]
        return Math.cos(runWorld.rotation) * dx - Math.sin(runWorld.rotation) * dz
      }
      if (side === 'right') {
        expect(localX(cornerWorld.position) + liveCornerWall.width / 2).toBeCloseTo(
          localX(wallWorld.position) - liveConnectedWall.width / 2,
        )
      } else {
        expect(localX(wallWorld.position) + liveConnectedWall.width / 2).toBeCloseTo(
          localX(cornerWorld.position) - liveCornerWall.width / 2,
        )
      }
    }
  })

  test('keeps both corner fillers linked when left and right start from one center module', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-shared-corner-source',
      depth: 0.58,
      children: ['cabinet-module_shared-corner-source'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_shared-corner-source',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    addCornerRun({ module, run, sceneApi, side: 'left' })
    addCornerRun({
      module: sceneApi.get<CabinetModuleNode>(module.id)!,
      run: sceneApi.get<CabinetNode>(run.id)!,
      sceneApi,
      side: 'right',
    })

    const sourceLink = (
      sceneApi.get<CabinetModuleNode>(module.id)?.metadata as Record<string, unknown>
    ).cabinetCornerSourceLink as { linkedRunIds: AnyNodeId[] }
    expect(sourceLink.linkedRunIds).toHaveLength(6)

    const resizedRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth: 0.78 }
    syncCornerRunsFromRunSources({ baseLayout: 'width-only', run: resizedRun, sceneApi })

    const baseFillers = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Filler',
    )
    expect(baseFillers).toHaveLength(2)
    expect(baseFillers.every((filler) => Math.abs(filler.width - 0.78) < 1e-6)).toBe(true)
  })

  test('keeps a chained right corner attached when the upstream run changes depth', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-chained-depth',
      depth: 0.58,
      children: ['cabinet-module_source-chained-depth'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-chained-depth',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const middleModuleId = addCornerRun({ module, run, sceneApi, side: 'right' })!
    const middleModule = sceneApi.get<CabinetModuleNode>(middleModuleId)!
    const middleRun = sceneApi.get<CabinetNode>(middleModule.parentId as AnyNodeId)!
    const thirdModuleId = addCornerRun({
      module: middleModule,
      run: middleRun,
      sceneApi,
      side: 'right',
    })!
    const thirdModule = sceneApi.get<CabinetModuleNode>(thirdModuleId)!
    const thirdRun = sceneApi.get<CabinetNode>(thirdModule.parentId as AnyNodeId)!
    const initialMiddleX = middleModule.position[0]
    const initialMiddleWidth = middleModule.width
    const initialMiddleRightEdge = middleModule.position[0] + middleModule.width / 2
    const initialThirdRunX = thirdRun.position[0]
    const resizedRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth: 0.78 }

    for (const [id, override] of backAlignedRunDepthOverrides(
      resizedRun,
      sceneApi.nodes(),
      resizedRun.depth,
    )) {
      sceneApi.update(id, override)
    }
    sceneApi.update(run.id as AnyNodeId, { depth: resizedRun.depth })
    syncCornerRunsFromRunSources({ baseLayout: 'width-only', run: resizedRun, sceneApi })

    const resizedMiddle = sceneApi.get<CabinetModuleNode>(middleModule.id)!
    const resizedThirdRun = sceneApi.get<CabinetNode>(thirdRun.id)!
    const moduleShift = resizedMiddle.position[0] - initialMiddleX
    const runShift = resizedThirdRun.position[0] - initialThirdRunX
    expect(resizedMiddle.width).toBeCloseTo(initialMiddleWidth - 0.2)
    expect(resizedMiddle.position[0] + resizedMiddle.width / 2).toBeCloseTo(initialMiddleRightEdge)
    expect(moduleShift).toBeCloseTo(0.1)
    expect(runShift).toBeCloseTo(0)
  })

  test('opposite-turn depth growth resizes the cabinet in front instead of the one behind', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-opposite-turn-depth',
      depth: 0.58,
      children: ['cabinet-module_source-opposite-turn-depth'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-opposite-turn-depth',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode])
    const firstSelectedId = addCornerRun({ module: source, run, sceneApi, side: 'right' })!
    const firstSelected = sceneApi.get<CabinetModuleNode>(firstSelectedId)!
    const firstRun = sceneApi.get<CabinetNode>(firstSelected.parentId as AnyNodeId)!
    const extendedId = addCabinetModuleSide({
      anchorModule: firstSelected,
      run: firstRun,
      sceneApi,
      side: 'right',
    })!
    const behind = sceneApi.get<CabinetModuleNode>(extendedId)!
    const targetSelectedId = addCornerRun({
      module: behind,
      run: firstRun,
      sceneApi,
      side: 'left',
    })!
    const targetSelected = sceneApi.get<CabinetModuleNode>(targetSelectedId)!
    const targetRun = sceneApi.get<CabinetNode>(targetSelected.parentId as AnyNodeId)!
    const frontSelectedId = addCornerRun({
      module: targetSelected,
      run: targetRun,
      sceneApi,
      side: 'right',
    })!
    const front = sceneApi.get<CabinetModuleNode>(frontSelectedId)!
    const initialBehindWidth = behind.width
    const initialFrontWidth = front.width
    const initialBack = Math.min(
      ...targetRun.children
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .filter((module): module is CabinetModuleNode => module?.type === 'cabinet-module')
        .map((module) => module.position[2] - module.depth / 2),
    )
    const depth = 0.68

    for (const [id, override] of cornerSourceWidthOverridesForDerivedDepth(
      targetRun,
      sceneApi.nodes(),
      depth,
    )) {
      sceneApi.update(id, override)
    }
    for (const [id, override] of backAlignedRunDepthOverrides(targetRun, sceneApi.nodes(), depth)) {
      sceneApi.update(id, override)
    }
    sceneApi.update(targetRun.id as AnyNodeId, { depth })
    syncCornerRunsFromRunSources({
      baseLayout: 'width-only',
      run: { ...targetRun, depth },
      sceneApi,
    })

    expect(sceneApi.get<CabinetModuleNode>(behind.id)?.width).toBeCloseTo(initialBehindWidth)
    expect(sceneApi.get<CabinetModuleNode>(front.id)?.width).toBeCloseTo(initialFrontWidth - 0.1)
    const resizedBack = Math.min(
      ...targetRun.children
        .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
        .filter((module): module is CabinetModuleNode => module?.type === 'cabinet-module')
        .map((module) => module.position[2] - module.depth / 2),
    )
    expect(resizedBack).toBeCloseTo(initialBack)
  })

  test.each([
    'left',
    'right',
  ] as const)('%s leg depth resizes its center-run source cabinet from the outer edge', (side) => {
    const run = CabinetNode.parse({
      id: `cabinet_source-run-upstream-${side}`,
      depth: 0.58,
      children: [`cabinet-module_source-upstream-${side}`],
    })
    const module = CabinetModuleNode.parse({
      id: `cabinet-module_source-upstream-${side}`,
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const selectedId = addCornerRun({ module, run, sceneApi, side })!
    const selectedModule = sceneApi.get<CabinetModuleNode>(selectedId)!
    let leg = sceneApi.get<CabinetNode>(selectedModule.parentId as AnyNodeId)!
    const originalInnerEdge =
      side === 'left'
        ? module.position[0] + module.width / 2
        : module.position[0] - module.width / 2
    const initialSource = sceneApi.get<CabinetModuleNode>(module.id)!
    const initialWall = wallChildOf(initialSource, sceneApi.nodes())!
    const initialBridge = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )!
    const initialCornerWallFiller = Object.values(sceneApi.nodes()).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )!
    const originalCornerWallPosition = resolveCabinetWorldTransform(
      initialCornerWallFiller,
      sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
    ).position
    const initialBridgeWorld = resolveCabinetWorldTransform(
      initialBridge,
      sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
    )
    const bridgeOuterDirection = side === 'right' ? 1 : -1
    const originalBridgeOuterEdge = [
      initialBridgeWorld.position[0] +
        bridgeOuterDirection * Math.cos(initialBridgeWorld.rotation) * (initialBridge.width / 2),
      initialBridgeWorld.position[2] -
        bridgeOuterDirection * Math.sin(initialBridgeWorld.rotation) * (initialBridge.width / 2),
    ]
    sceneApi.update(initialWall.id as AnyNodeId, {
      position: [initialWall.position[0], initialWall.position[1], initialWall.position[2] + 0.04],
    })

    for (const depth of [0.78, 0.48]) {
      const overrides = previewCornerRunsFromRunSources({
        baseLayout: 'width-only',
        initialOverrides: [
          ...backAlignedRunDepthOverrides(leg, sceneApi.nodes(), depth),
          ...cornerSourceWidthOverridesForDerivedDepth(leg, sceneApi.nodes(), depth),
        ],
        run: { ...leg, depth },
        sceneApi,
      })
      for (const [id, override] of overrides) sceneApi.update(id, override)
      sceneApi.update(leg.id as AnyNodeId, { depth })
      leg = sceneApi.get<CabinetNode>(leg.id)!

      const source = sceneApi.get<CabinetModuleNode>(module.id)!
      const expectedWidth = 0.9 - (depth - 0.58)
      const innerEdge =
        side === 'left'
          ? source.position[0] + source.width / 2
          : source.position[0] - source.width / 2
      expect(source.width).toBeCloseTo(expectedWidth)
      expect(innerEdge).toBeCloseTo(originalInnerEdge)
      const wall = wallChildOf(source, sceneApi.nodes())!
      expect(wall.width).toBeCloseTo(expectedWidth)
      expect(source.position[2] + wall.position[2] - wall.depth / 2).toBeCloseTo(
        source.position[2] - source.depth / 2,
      )
      const bridge = sceneApi.get<CabinetModuleNode>(initialBridge.id)!
      expect(bridge.width).toBeCloseTo(initialBridge.width + (depth - 0.58))
      const bridgeWorld = resolveCabinetWorldTransform(
        bridge,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const bridgeOuterEdge = [
        bridgeWorld.position[0] +
          bridgeOuterDirection * Math.cos(bridgeWorld.rotation) * (bridge.width / 2),
        bridgeWorld.position[2] -
          bridgeOuterDirection * Math.sin(bridgeWorld.rotation) * (bridge.width / 2),
      ]
      expect(bridgeOuterEdge[0]).toBeCloseTo(originalBridgeOuterEdge[0]!)
      expect(bridgeOuterEdge[1]).toBeCloseTo(originalBridgeOuterEdge[1]!)
      const cornerWallPosition = resolveCabinetWorldTransform(
        sceneApi.get<CabinetModuleNode>(initialCornerWallFiller.id)!,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      ).position
      expect(cornerWallPosition[0]).toBeCloseTo(originalCornerWallPosition[0])
      expect(cornerWallPosition[2]).toBeCloseTo(originalCornerWallPosition[2])
    }
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

  test.each([
    'left',
    'right',
  ] as const)('%s corner filler keeps resizing after its leg gains another cabinet', (side) => {
    const run = CabinetNode.parse({
      id: `cabinet_source-run-extended-depth-${side}`,
      depth: 0.58,
      children: [`cabinet-module_source-extended-depth-${side}`],
    })
    const module = CabinetModuleNode.parse({
      id: `cabinet-module_source-extended-depth-${side}`,
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const connectedId = addCornerRun({ module, run, sceneApi, side })!
    const connected = sceneApi.get<CabinetModuleNode>(connectedId)!
    const leg = sceneApi.get<CabinetNode>(connected.parentId as AnyNodeId)!
    const extraId = addCabinetModuleSide({
      anchorModule: connected,
      run: leg,
      sceneApi,
      side,
    })!
    const initialExtra = sceneApi.get<CabinetModuleNode>(extraId)!
    const initialLegModules = cabinetModulesForRun(leg, sceneApi.nodes())
    const initialFiller = initialLegModules.find((entry) => entry.name === 'Corner Filler')!
    const initialConnected = initialLegModules.find((entry) => entry.name === 'Base Cabinet')!
    const cornerPairWidth = initialFiller.width + initialConnected.width

    for (const depth of [0.48, 0.68]) {
      const resizedRun = { ...sceneApi.get<CabinetNode>(run.id)!, depth }
      sceneApi.update(run.id as AnyNodeId, { depth })
      syncCornerRunsFromRunSources({ baseLayout: 'width-only', run: resizedRun, sceneApi })

      const liveLeg = sceneApi.get<CabinetNode>(leg.id)!
      const liveModules = cabinetModulesForRun(liveLeg, sceneApi.nodes()).sort(
        (a, b) => a.position[0] - b.position[0],
      )
      const filler = liveModules.find((entry) => entry.name === 'Corner Filler')!
      const liveConnected = liveModules.find((entry) => entry.name === 'Base Cabinet')!
      const liveExtra = sceneApi.get<CabinetModuleNode>(extraId)!

      expect(filler.width).toBeCloseTo(depth)
      expect(liveConnected.width).toBeCloseTo(cornerPairWidth - depth)
      expect(wallChildOf(liveConnected, sceneApi.nodes())?.width).toBeCloseTo(
        cornerPairWidth - depth,
      )
      expect(liveExtra.width).toBeCloseTo(initialExtra.width)
      for (let index = 1; index < liveModules.length; index++) {
        const previous = liveModules[index - 1]!
        const current = liveModules[index]!
        expect(previous.position[0] + previous.width / 2).toBeCloseTo(
          current.position[0] - current.width / 2,
        )
      }
    }
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
    expect(bridgeFillers[0]?.width).toBeCloseTo(0.18)

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

  test('turns left from the outer right end of an extended right-corner leg', () => {
    const levelId = 'level_corner-extended-leg-left-turn' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-extended-leg-left-turn',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-extended-leg-left-turn'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-extended-leg-left-turn',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-extended-leg-left-turn', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    const firstSelectedId = addCornerRun({ module, run, sceneApi, side: 'right' })
    const firstSelectedModule = sceneApi.get<CabinetModuleNode>(firstSelectedId!)!
    const firstDerivedRun = sceneApi.get<CabinetNode>(firstSelectedModule.parentId as AnyNodeId)!
    const extendedId = addCabinetModuleSide({
      anchorModule: firstSelectedModule,
      run: firstDerivedRun,
      sceneApi,
      side: 'right',
    })
    const extendedModule = sceneApi.get<CabinetModuleNode>(extendedId!)!

    const secondSelectedId = addCornerRun({
      module: extendedModule,
      run: firstDerivedRun,
      sceneApi,
      side: 'left',
    })

    expect(secondSelectedId).toBeTruthy()

    const secondSelectedModule = sceneApi.get<CabinetModuleNode>(secondSelectedId!)!
    const secondDerivedRun = sceneApi.get<CabinetNode>(secondSelectedModule.parentId as AnyNodeId)!
    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const firstDerivedWorld = resolveCabinetWorldTransform(firstDerivedRun, nodes)
    const secondDerivedWorld = resolveCabinetWorldTransform(secondDerivedRun, nodes)

    expect(secondDerivedWorld.rotation - firstDerivedWorld.rotation).toBeCloseTo(Math.PI / 2)
    expect(
      (secondDerivedRun.metadata as Record<string, unknown>).cabinetCornerDerivedRun,
    ).toMatchObject({
      side: 'right',
      turnSide: 'left',
    })
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

    expect(sourceAfter.width).toBeCloseTo(0.64)
    expect(legCabinet?.width).toBeCloseTo(0.64)
    expect(wallLegCabinet?.width).toBeCloseTo(0.64)
  })

  test('shrinks the source corner cabinet when a side wall blocks the turn pocket', () => {
    const levelId = 'level_corner-side-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-side-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-side-wall-clearance'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-side-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-side-wall-clearance', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-side-blocker',
      parentId: levelId,
      start: [0.82, -1],
      end: [0.82, 1],
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
    const wallLegCabinet = modulesOut.find(
      (node) => node.name === 'Wall Cabinet' && node.parentId === legCabinet?.id,
    )

    expect(sourceAfter.width).toBeCloseTo(0.67)
    expect(legCabinet?.width).toBeCloseTo(0.67)
    expect(wallLegCabinet?.width).toBeCloseTo(0.67)
  })

  test('shrinks the source corner cabinet when a left side wall blocks the turn pocket', () => {
    const levelId = 'level_corner-left-side-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-left-side-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-corner-left-side-wall-clearance'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_source-corner-left-side-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-left-side-wall-clearance', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-left-side-blocker',
      parentId: levelId,
      start: [-0.82, -1],
      end: [-0.82, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode, blockingWall as AnyNode])

    const selectedId = addCornerRun({
      module,
      run,
      sceneApi,
      side: 'left',
    })

    expect(selectedId).toBeTruthy()

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const sourceAfter = sceneApi.get<CabinetModuleNode>(module.id)!
    const selectedModule = sceneApi.get<CabinetModuleNode>(selectedId!)!
    const legCabinet = modulesOut.find(
      (node) => node.name === 'Base Cabinet' && node.parentId === selectedModule.parentId,
    )
    const wallLegCabinet = modulesOut.find(
      (node) => node.name === 'Wall Cabinet' && node.parentId === legCabinet?.id,
    )

    expect(sourceAfter.width).toBeCloseTo(0.67)
    expect(legCabinet?.width).toBeCloseTo(0.67)
    expect(wallLegCabinet?.width).toBeCloseTo(0.67)
  })

  test('adds the corner after a tight side wall trims the source below standard width', () => {
    const levelId = 'level_corner-tight-side-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-tight-side-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-tight-side-wall-clearance',
        'cabinet-module_mid-tight-side-wall-clearance',
        'cabinet-module_right-tight-side-wall-clearance',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-tight-side-wall-clearance',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const middle = CabinetModuleNode.parse({
      id: 'cabinet-module_mid-tight-side-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-tight-side-wall-clearance',
      parentId: run.id,
      position: [0.9, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-tight-side-wall-clearance', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-tight-side-blocker',
      parentId: levelId,
      start: [1.3, -1],
      end: [1.3, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      middle as AnyNode,
      right as AnyNode,
      blockingWall as AnyNode,
    ])

    const selectedId = addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    expect(selectedId).toBeTruthy()

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const sourceAfter = sceneApi.get<CabinetModuleNode>(right.id)!
    const legCabinet = modulesOut.find((node) => node.id === selectedId)

    expect(sourceAfter.width).toBeCloseTo(0.25)
    expect(legCabinet?.width).toBeCloseTo(0.25)
  })

  test('adds the left corner after a tight side wall trims the source below standard width', () => {
    const levelId = 'level_corner-tight-left-side-wall-clearance' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-tight-left-side-wall-clearance',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-tight-left-side-wall-clearance',
        'cabinet-module_mid-tight-left-side-wall-clearance',
        'cabinet-module_right-tight-left-side-wall-clearance',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-tight-left-side-wall-clearance',
      parentId: run.id,
      position: [-0.9, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-tight-left-side-wall-clearance', type: 'door', shelfCount: 2 }],
    })
    const middle = CabinetModuleNode.parse({
      id: 'cabinet-module_mid-tight-left-side-wall-clearance',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-tight-left-side-wall-clearance',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const blockingWall = WallNode.parse({
      id: 'wall_corner-tight-left-side-blocker',
      parentId: levelId,
      start: [-1.3, -1],
      end: [-1.3, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      middle as AnyNode,
      right as AnyNode,
      blockingWall as AnyNode,
    ])

    const selectedId = addCornerRun({
      module: left,
      run,
      sceneApi,
      side: 'left',
    })

    expect(selectedId).toBeTruthy()

    const modulesOut = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    )
    const sourceAfter = sceneApi.get<CabinetModuleNode>(left.id)!
    const selectedModule = sceneApi.get<CabinetModuleNode>(selectedId!)!
    const legCabinet = modulesOut.find(
      (node) => node.name === 'Base Cabinet' && node.parentId === selectedModule.parentId,
    )

    expect(sourceAfter.width).toBeCloseTo(0.25)
    expect(legCabinet?.width).toBeCloseTo(0.25)
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
    expect(preview?.connectedWidth).toBeCloseTo(0.64)
    expect(preview?.sourceWidth).toBeCloseTo(0.64)
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
      start: [-1, 0.55],
      end: [2, 0.55],
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

    expect(sceneApi.get<CabinetModuleNode>(module.id)!.width).toBeCloseTo(0.64)
    expect(sceneApi.get<CabinetModuleNode>(wallTop.id)!.width).toBeCloseTo(0.64)

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
