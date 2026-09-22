import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  type HostSurface,
  nodeRegistry,
  pointInPolygon2D,
  resolveSurfacePlacement,
  type SceneApi,
  type SurfaceContext,
} from '@pascal-app/core'
import { Box3, Group, type Mesh, Raycaster, Vector3 } from 'three'
import { cabinetDefinition } from '../definition'
import { buildCabinetGeometry } from '../geometry'
import { planToRunLocal, runLocalToPlan } from '../run-layout'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { cabinetSurfaceProvider, getCabinetSurfaces } from '../surfaces'

function moduleAt(x: number, patch: Partial<CabinetModuleNode> = {}) {
  return CabinetModuleNode.parse({
    width: 0.6,
    depth: 0.6,
    carcassHeight: 0.72,
    position: [x, 0.1, 0],
    ...patch,
  })
}

function fixture(
  modules: CabinetModuleNode[],
  patch: Partial<CabinetNode> = {},
  extra: AnyNode[] = [],
) {
  const run = CabinetNode.parse({
    withCountertop: true,
    countertopThickness: 0.03,
    countertopOverhang: 0.02,
    children: modules.map((module) => module.id),
    ...patch,
  })
  const children = modules.map((module) => ({ ...module, parentId: run.id }))
  const nodes = Object.fromEntries(
    [run, ...children, ...extra].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const scene: SurfaceContext['scene'] = {
    get: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    nodes: () => nodes,
  }
  const ctx: GeometryContext = {
    resolve: scene.get,
    children: run.children.map((id) => nodes[id]).filter((node): node is AnyNode => !!node),
    siblings: Object.values(nodes).filter(
      (node) => node.type === 'cabinet' && node.parentId === run.parentId,
    ),
    parent: run.parentId ? (nodes[run.parentId] ?? null) : null,
  }
  return { run, ctx, scene, surfaces: getCabinetSurfaces(run, ctx) }
}

function extent(surface: HostSurface) {
  const [x, z] = surface.region!.center!
  const [w, d] = surface.region!.size!
  return { minX: x - w, maxX: x + w, minZ: z - d, maxZ: z + d, topY: surface.position[1] }
}

function contains(surface: HostSurface, x: number, z: number) {
  const bounds = extent(surface)
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    z >= bounds.minZ &&
    z <= bounds.maxZ &&
    !surface.region!.holes?.some((hole) =>
      pointInPolygon2D(
        [x, z],
        hole.map(([hx, hz]) => [hx, hz]),
      ),
    )
  )
}

function checkMeshAgreement(f: ReturnType<typeof fixture>) {
  const geometry = buildCabinetGeometry(f.run, f.ctx)
  geometry.updateMatrixWorld(true)
  for (const [label, name] of [
    ['Countertop', 'cabinet-run-countertop'],
    ['Bar ledge', 'cabinet-run-bar-slab'],
  ] as const) {
    const meshes = geometry.children.filter((child) => child.name === name) as Mesh[]
    const surfaces = f.surfaces.filter((surface) => surface.label === label)
    expect(meshes).toHaveLength(surfaces.length)
    surfaces.forEach((surface, index) => {
      const box = new Box3().setFromObject(meshes[index]!)
      const region = extent(surface)
      expect(region.minX).toBeCloseTo(box.min.x, 6)
      expect(region.maxX).toBeCloseTo(box.max.x, 6)
      expect(region.minZ).toBeCloseTo(box.min.z, 6)
      expect(region.maxZ).toBeCloseTo(box.max.z, 6)
      expect(region.topY).toBeCloseTo(box.max.y, 6)
      expect(surface.normal).toEqual([0, 1, 0])
      expect(surface.gridSnap).toBe(true)
    })
  }
  return geometry
}

function dispose(geometry: Group) {
  geometry.traverse((object) => (object as Mesh).geometry?.dispose())
}

describe('cabinet hosting surfaces', () => {
  test('several base modules share one real span, regardless of run bounds or child order', () => {
    const left = moduleAt(-0.6)
    const middle = moduleAt(0)
    const right = moduleAt(0.6)
    const f = fixture([right, left, middle], { carcassHeight: 2, width: 3, withWaterfall: true })
    expect(f.surfaces).toHaveLength(1)
    expect(f.surfaces[0]!.id).toBe(`countertop:${left.id}`)
    expect(f.surfaces[0]!.position).toEqual([0, 0.85, 0])
    const bounds = extent(f.surfaces[0]!)
    expect(bounds.minX).toBeCloseTo(-0.92)
    expect(bounds.maxX).toBeCloseTo(0.92)
    expect(bounds.minZ).toBeCloseTo(-0.3)
    expect(bounds.maxZ).toBeCloseTo(0.32)
    dispose(checkMeshAgreement(f))
  })

  test.each([
    ['gap', { position: [0.9, 0.1, 0] }],
    ['height', { carcassHeight: 0.9 }],
    ['vertical offset', { position: [0.6, 0.25, 0] }],
    ['depth', { depth: 0.8, position: [0.6, 0.1, 0.1] }],
    ['depth offset', { position: [0.6, 0.1, 0.1] }],
  ] as const)('%s splits spans', (_name, patch) => {
    const f = fixture([moduleAt(0), moduleAt(0.6, patch as Partial<CabinetModuleNode>)])
    expect(f.surfaces).toHaveLength(2)
    expect(new Set(f.surfaces.map((surface) => surface.id)).size).toBe(2)
    dispose(checkMeshAgreement(f))
  })

  test('a tall module interrupts the countertop and trims the two mating ends independently', () => {
    const f = fixture([
      moduleAt(-0.6),
      moduleAt(0, { cabinetType: 'tall', carcassHeight: 2 }),
      moduleAt(0.6),
    ])
    expect(f.surfaces).toHaveLength(2)
    expect(extent(f.surfaces[0]!).minX).toBeCloseTo(-0.92)
    expect(extent(f.surfaces[0]!).maxX).toBeCloseTo(-0.3)
    expect(extent(f.surfaces[1]!).minX).toBeCloseTo(0.3)
    expect(extent(f.surfaces[1]!).maxX).toBeCloseTo(0.92)
    expect(f.surfaces.some((surface) => contains(surface, 0, 0))).toBe(false)
    dispose(checkMeshAgreement(f))
  })

  test.each([
    'wall',
    'tall',
  ] as const)('%s runs publish nothing even with countertop and bar flags', (runTier) => {
    const f = fixture([moduleAt(0)], {
      runTier,
      withCountertop: true,
      barLedge: { edge: 'back', height: 1.1, depth: 0.3 },
    })
    expect(f.surfaces).toEqual([])
    dispose(checkMeshAgreement(f))
  })

  test('empty runs, all-tall modules, disabled and zero-thickness countertops publish nothing', () => {
    for (const f of [
      fixture([]),
      fixture([moduleAt(0, { cabinetType: 'tall' })]),
      fixture([moduleAt(0)], { withCountertop: false }),
      fixture([moduleAt(0)], { countertopThickness: 0 }),
    ]) {
      expect(f.surfaces).toEqual([])
      dispose(checkMeshAgreement(f))
    }
  })

  test.each([
    'single',
    'double',
    'double-offset',
  ] as const)('%s sink openings match the cut mesh, including the rim reveal', (sinkLayout) => {
    const sink = moduleAt(0.8, {
      width: 0.8,
      position: [0.8, 0.1, 0.15],
      depth: 0.7,
      stack: [{ id: 'sink', type: 'sink', sinkLayout }],
    })
    const f = fixture([sink], { countertopBackOverhang: 0.3 })
    const surface = f.surfaces[0]!
    expect(surface.region!.holes).toHaveLength(sinkLayout === 'single' ? 2 : 3)
    const geometry = checkMeshAgreement(f)
    const mesh = geometry.getObjectByName('cabinet-run-countertop')!
    const ray = new Raycaster()
    const hits = (x: number, z: number) => {
      ray.set(new Vector3(x, 3, z), new Vector3(0, -1, 0))
      return ray.intersectObject(mesh, false)
    }
    for (const hole of surface.region!.holes!.slice(0, -1)) {
      const minX = hole[0]![0]
      const maxX = hole[1]![0]
      const minZ = hole[0]![1]
      const maxZ = hole[2]![1]
      const x = (minX + maxX) / 2
      const z = (minZ + maxZ) / 2
      expect(contains(surface, x, z)).toBe(false)
      expect(hits(x, z)).toHaveLength(0)
      expect(hits(minX + 0.002, z)).toHaveLength(0)
      expect(hits(minX - 0.002, z)[0]!.point.y).toBeCloseTo(surface.position[1], 6)
      expect(hits(x, maxZ - 0.002)).toHaveLength(0)
      expect(hits(x, maxZ + 0.002)[0]!.point.y).toBeCloseTo(surface.position[1], 6)
    }
    const faucet = surface.region!.holes!.at(-1)!
    const faucetX = faucet.reduce((sum, point) => sum + point[0], 0) / faucet.length
    const faucetZ = faucet.reduce((sum, point) => sum + point[1], 0) / faucet.length
    expect(contains(surface, faucetX, faucetZ)).toBe(false)
    expect(hits(faucetX, faucetZ)[0]!.point.y).toBeCloseTo(surface.position[1], 6)
    dispose(geometry)
  })

  test.each([
    'cooktop-gas',
    'cooktop-induction',
  ] as const)('%s footprint is a hole matching the rendered frame', (type) => {
    const module = moduleAt(0.7, { width: 0.8, stack: [{ id: 'cooktop', type }] })
    const f = fixture([module])
    const surface = f.surfaces[0]!
    expect(surface.region!.holes).toHaveLength(1)
    expect(contains(surface, 0.7, 0)).toBe(false)
    expect(contains(surface, 0.7, 0.31)).toBe(true)
    const geometry = buildCabinetGeometry(module, { ...f.ctx, parent: f.run })
    geometry.position.set(...module.position)
    geometry.updateMatrixWorld(true)
    const frames = geometry.children.filter((child) => child.name.includes('-frame-'))
    const frame = new Box3()
    for (const object of frames) frame.union(new Box3().setFromObject(object))
    const hole = surface.region!.holes![0]!
    expect(hole[0]![0]).toBeCloseTo(frame.min.x, 6)
    expect(hole[0]![1]).toBeCloseTo(frame.min.z, 6)
    expect(hole[2]![0]).toBeCloseTo(frame.max.x, 6)
    expect(hole[2]![1]).toBeCloseTo(frame.max.z, 6)
    dispose(geometry)
  })

  test('under-counter appliances keep the usable countertop', () => {
    const f = fixture([
      moduleAt(0, { stack: [{ id: 'dishwasher', type: 'dishwasher' }] }),
      moduleAt(0.6, { stack: [{ id: 'oven', type: 'oven' }] }),
    ])
    expect(f.surfaces).toHaveLength(1)
    expect(f.surfaces[0]!.region!.holes).toBeUndefined()
  })

  test('an island includes its seating overhang and asymmetric side trim', () => {
    const neighbor = CabinetNode.parse({ position: [-1.2, 0, 0], width: 0.6 })
    const f = fixture(
      [moduleAt(-0.6), moduleAt(0)],
      { withFinishedBack: true, countertopBackOverhang: 0.3 },
      [neighbor],
    )
    const bounds = extent(f.surfaces[0]!)
    expect(bounds.minX).toBeCloseTo(-0.9)
    expect(bounds.maxX).toBeCloseTo(0.32)
    expect(bounds.minZ).toBeCloseTo(-0.6)
    expect(bounds.maxZ).toBeCloseTo(0.32)
    expect(contains(f.surfaces[0]!, 0, -0.59)).toBe(true)
    dispose(checkMeshAgreement(f))
  })

  test.each([
    'back',
    'left',
    'right',
  ] as const)('%s bar ledge has a distinct id, footprint and height', (edge) => {
    const f = fixture([moduleAt(0), moduleAt(0.9)], {
      withFinishedBack: true,
      countertopBackOverhang: 0.3,
      barLedge: { edge, height: 1.1, depth: 0.35 },
    })
    const bars = f.surfaces.filter((surface) => surface.label === 'Bar ledge')
    expect(bars).toHaveLength(edge === 'back' ? 2 : 1)
    expect(new Set(f.surfaces.map((surface) => surface.id)).size).toBe(f.surfaces.length)
    for (const bar of bars) expect(bar.position[1]).toBeCloseTo(1.1)
    for (const top of f.surfaces.filter((surface) => surface.label === 'Countertop')) {
      expect(top.position[1]).toBeCloseTo(0.85)
      expect(extent(top).minZ).toBeCloseTo(edge === 'back' ? -0.3 : -0.6)
    }
    dispose(checkMeshAgreement(f))
  })

  test('a bar still publishes when the main countertop is disabled, as the mesh does', () => {
    const f = fixture([moduleAt(0)], {
      withCountertop: false,
      barLedge: { edge: 'back', height: 1.1, depth: 0.3 },
    })
    expect(f.surfaces).toHaveLength(1)
    expect(f.surfaces[0]!.label).toBe('Bar ledge')
    dispose(checkMeshAgreement(f))
  })

  test('surface ids and frames survive a new earlier span, child reordering, and extending the far end', () => {
    const first = moduleAt(0)
    const second = moduleAt(0.6)
    const separate = moduleAt(3)
    const before = fixture([first, second, separate], {
      barLedge: { edge: 'back', height: 1.1, depth: 0.3 },
    })
    const modules = [separate, moduleAt(-2), second, first, moduleAt(1.2)]
    const after = fixture(modules, { ...before.run, children: modules.map((module) => module.id) })
    const surfaces = after.surfaces
    for (const surface of before.surfaces) {
      const match = surfaces.find((candidate) => candidate.id === surface.id)
      expect(match).toBeDefined()
      expect(match!.position).toEqual(surface.position)
    }
  })

  test('rotated nested corner runs publish only their own local slabs, leaving the empty L corner unhostable', () => {
    const sourceModule = moduleAt(0)
    const root = CabinetNode.parse({
      children: [sourceModule.id],
      position: [4, 0.4, -3],
      rotation: Math.PI / 3,
    })
    const legModule = moduleAt(0.9, { width: 1.2 })
    const leg = CabinetNode.parse({
      parentId: root.id,
      children: [legModule.id],
      position: [0.6, 0.2, -0.6],
      rotation: -Math.PI / 2,
      metadata: { cabinetCornerDerivedRun: { role: 'base-leg', side: 'right' } },
    })
    const f = fixture([sourceModule], { ...root, children: [sourceModule.id, leg.id] }, [
      leg,
      { ...legModule, parentId: leg.id },
    ])
    const legSurfaces = cabinetSurfaceProvider.surfaces!(leg, { scene: f.scene })
    expect(f.surfaces).toHaveLength(1)
    expect(legSurfaces).toHaveLength(1)
    expect(extent(f.surfaces[0]!).maxX).toBeCloseTo(0.3)
    expect(extent(legSurfaces[0]!).minX).toBeCloseTo(0.3)
    const surface = legSurfaces[0]!
    const local: [number, number, number] = [0.9, surface.position[1], 0]
    const world = runLocalToPlan(root, runLocalToPlan(leg, local))
    const inRoot = planToRunLocal(root, world[0], world[1] - root.position[1], world[2])
    const inLeg = planToRunLocal(leg, inRoot[0], inRoot[1] - leg.position[1], inRoot[2])
    const hit = cabinetSurfaceProvider.resolveHit(
      leg,
      { point: inLeg, normalWorldY: 1 },
      { scene: f.scene },
    )
    expect(hit?.id).toBe(surface.id)
    expect(hit?.position[1]).toBeCloseTo(0.82 + leg.countertopThickness)
    const emptyRoot: [number, number, number] = [-0.1, 1, 0.6]
    const emptyLeg = planToRunLocal(leg, emptyRoot[0], emptyRoot[1] - leg.position[1], emptyRoot[2])
    expect(
      cabinetSurfaceProvider.resolveHit(
        f.run,
        { point: emptyRoot, normalWorldY: 1 },
        { scene: f.scene },
      ),
    ).toBeNull()
    expect(
      cabinetSurfaceProvider.resolveHit(
        leg,
        { point: emptyLeg, normalWorldY: 1 },
        { scene: f.scene },
      ),
    ).toBeNull()
    const geometry = buildCabinetGeometry(leg, {
      ...f.ctx,
      parent: root,
      children: [legModule],
      siblings: [leg],
    })
    const mountedRoot = new Group()
    mountedRoot.position.set(...root.position)
    mountedRoot.rotation.y = root.rotation
    geometry.position.set(...leg.position)
    geometry.rotation.y = leg.rotation
    const sourceGeometry = buildCabinetGeometry(f.run, f.ctx)
    const localBounds = new Box3().setFromObject(sourceGeometry)
    localBounds.union(new Box3().setFromObject(geometry))
    expect(localBounds.containsPoint(new Vector3(...emptyRoot))).toBe(true)
    dispose(sourceGeometry)
    mountedRoot.add(geometry)
    mountedRoot.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(world[0], world[1] + 2, world[2]), new Vector3(0, -1, 0))
    const mesh = geometry.getObjectByName('cabinet-run-countertop')!
    expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(world[1], 6)
    dispose(mountedRoot)
  })

  test('provider is additive, pure and resolves free points while rejecting holes, gaps and downward hits', () => {
    expect(cabinetDefinition.capabilities.surfaces?.hosting).toBe(cabinetSurfaceProvider)
    expect(cabinetSurfaceProvider.childFrame).toBe('host-local')
    const f = fixture([moduleAt(0, { stack: [{ id: 'sink', type: 'sink' }] }), moduleAt(2)])
    const before = JSON.stringify(f.scene.nodes())
    const resolve = (point: [number, number, number], normalWorldY = 1) =>
      cabinetSurfaceProvider.resolveHit(f.run, { point, normalWorldY }, { scene: f.scene })
    expect(resolve([0, 0.85, 0])).toBeNull()
    expect(resolve([1, 0.85, 0])).toBeNull()
    expect(resolve([2, 0.85, 0], -1)).toBeNull()
    expect(resolve([2, Number.NaN, 0])).toBeNull()
    expect(resolve([2.123, 0.85, 0.1])?.gridSnap).toBe(true)
    expect(cabinetSurfaceProvider.surfaces!(f.run, { scene: f.scene })).toEqual(f.surfaces)
    expect(JSON.stringify(f.scene.nodes())).toBe(before)
  })

  describe('placement resolver', () => {
    let restoreRegistry: () => void

    beforeEach(() => {
      restoreRegistry = nodeRegistry._snapshot()
      nodeRegistry._reset()
      nodeRegistry._register(cabinetDefinition)
    })

    afterEach(() => restoreRegistry())

    test.each([
      ['Countertop', 'item', 0.85, 0.113],
      ['Countertop', 'procedural-item', 0.85, 0.113],
      ['Bar ledge', 'item', 1.1, -0.437],
      ['Bar ledge', 'procedural-item', 1.1, -0.437],
    ] as const)('%s grid-snaps a %s in the host frame without electing a centre', (label, childKind, y, z) => {
      const f = fixture([moduleAt(2), moduleAt(2.6)], {
        position: [4, 0.4, -3],
        rotation: Math.PI / 3,
        barLedge: { edge: 'back', height: 1.1, depth: 0.35 },
      })
      const args = {
        host: f.run,
        childKind,
        childId: `${childKind}_existing`,
        childFootprint: { size: [0.1, 0.2, 0.1] as const, rotationY: 0.3 },
        hit: { point: [2.123, y, z] as const, normalWorldY: 1 },
        scene: f.scene as SceneApi,
      }
      const surface = f.surfaces.find((candidate) => candidate.label === label)!
      const unsnapped = resolveSurfacePlacement(args)
      expect(unsnapped).toMatchObject({
        position: [2.123, surface.position[1], z],
        rotationY: 0.3,
        childFrame: 'host-local',
        surfaceId: surface.id,
        surfaceLocal: { rotationY: 0.3, rotation: [0, 0.3, 0] },
      })
      expect(unsnapped!.position[1]).toBeCloseTo(y)
      expect(unsnapped!.surfaceLocal!.position[0]).toBe(2.123)
      expect(unsnapped!.surfaceLocal!.position[1]).toBeCloseTo(0)
      expect(unsnapped!.surfaceLocal!.position[2]).toBe(z)
      const snapScalar = mock(
        (value: number, dimension: number) =>
          Math.round((value - dimension / 2) / 0.05) * 0.05 + dimension / 2,
      )
      const placed = resolveSurfacePlacement({ ...args, snapScalar })
      expect(snapScalar.mock.calls).toEqual([
        [2.123, 0.1],
        [z, 0.1],
      ])
      expect(placed?.position[0]).toBeCloseTo(2.1)
      expect(placed?.position[1]).toBeCloseTo(y)
      expect(placed?.position[2]).toBeCloseTo(label === 'Countertop' ? 0.1 : -0.45)
      expect(placed?.childFrame).toBe('host-local')
      expect(placed?.surfaceId).toBe(surface.id)
    })

    test('preserves the full XYZ surface-local rotation', () => {
      const f = fixture([moduleAt(0)])
      const rotation = [0.1, 0.3, -0.2] as const
      const placed = resolveSurfacePlacement({
        host: f.run,
        childKind: 'item',
        childId: 'item_existing',
        childFootprint: { size: [0.1, 0.2, 0.1], rotationY: rotation[1], rotation },
        hit: { point: [0.123, 0.85, 0.1], normalWorldY: 1 },
        scene: f.scene as SceneApi,
      })
      expect(placed).not.toBeNull()
      rotation.forEach((angle, axis) => {
        expect(placed!.surfaceLocal!.rotation[axis]).toBeCloseTo(angle)
      })
    })

    test('a grab offset and snapping judge the centre even when the raw hit is over a sink', () => {
      const f = fixture([moduleAt(0, { stack: [{ id: 'sink', type: 'sink' }] }), moduleAt(2)])
      const args = {
        host: f.run,
        childKind: 'item',
        childId: 'item_existing',
        childFootprint: { size: [0.6, 0.2, 0.6] as const, rotationY: Math.PI / 4 },
        scene: f.scene as SceneApi,
      }
      expect(
        resolveSurfacePlacement({
          ...args,
          hit: { point: [0, 0.85, 0], normalWorldY: 1 },
          origin: [0, 0.85, 0.3],
        })?.position,
      ).toEqual([0, 0.85, 0.3])
      expect(
        resolveSurfacePlacement({
          ...args,
          hit: { point: [0, 0.85, 0.3], normalWorldY: 1 },
          origin: [0, 0.85, 0],
        }),
      ).toBeNull()
      expect(
        resolveSurfacePlacement({
          ...args,
          hit: { point: [2.33, 0.85, 0.1], normalWorldY: 1 },
          snapScalar: (p) => Math.round(p * 10) / 10,
        })?.position,
      ).toEqual([2.3, 0.85, 0.1])
    })

    test('accepts overhang at span edges but rejects centres in holes and gaps', () => {
      const f = fixture([moduleAt(0, { stack: [{ id: 'sink', type: 'sink' }] }), moduleAt(2)])
      const onReject = mock()
      const args = {
        host: f.run,
        childKind: 'item',
        childId: 'item_existing',
        childFootprint: { size: [0.2, 0.2, 0.2] as const, rotationY: 0 },
        scene: f.scene as SceneApi,
        onReject,
      }
      expect(
        resolveSurfacePlacement({ ...args, hit: { point: [0, 0.85, 0.3], normalWorldY: 1 } }),
      ).not.toBeNull()
      expect(onReject).not.toHaveBeenCalled()
      expect(
        resolveSurfacePlacement({ ...args, hit: { point: [2.3, 0.85, 0], normalWorldY: 1 } }),
      ).not.toBeNull()
      for (const point of [
        [0, 0.85, 0],
        [1, 0.85, 0],
      ] as const) {
        expect(resolveSurfacePlacement({ ...args, hit: { point, normalWorldY: 1 } })).toBeNull()
        expect(onReject).toHaveBeenLastCalledWith(point[0] === 0 ? 'surface-cutout' : 'no-surface')
      }
    })
  })
})
