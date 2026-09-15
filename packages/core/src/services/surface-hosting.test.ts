import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Euler, Group, Matrix3, Quaternion, Vector3 } from 'three'
import { shelfRecipe } from '../procedural-items/fixtures'
import { ProceduralItemNode } from '../procedural-items/node'
import {
  attachmentBounds,
  nodeLevelFrame,
  queryProceduralItem,
  validateProceduralRelations,
} from '../procedural-items/query'
import { evaluateRecipe } from '../procedural-items/recipe'
import { composeFrames, frame, transformPoint } from '../procedural-items/spatial'
import { nodeRegistry, registerNode } from '../registry/registry'
import type { Capabilities, SceneApi, SurfacesConfig } from '../registry/types'
import { getScaledDimensions, ItemNode, isLowProfileItemSurface } from '../schema/nodes/item'
import { ShelfNode } from '../schema/nodes/shelf'
import type { AnyNode } from '../schema/types'
import { canHostOnTop } from './hosting'
import {
  getSurfaceProvider,
  type HostSurface,
  NON_PHYSICAL_HOST_KINDS,
  proceduralItemSurfaceProvider,
  resolveSurfacePlacement,
  type SurfaceProvider,
  shelfSurfaceProvider,
} from './surface-hosting'
import { expectLiveParity } from './surface-hosting-parity.test'

// Execute the actual legacy helpers without importing mover stores or node renderers into core tests.
function legacy<T>(file: string, names: string[], dependencies: Record<string, unknown>): T {
  const source = readFileSync(resolve(import.meta.dir, '../../..', file), 'utf8')
  const declarations = names
    .map((name) => {
      const start = source.search(new RegExp(`^(?:export )?(?:function|const) ${name}\\b`, 'm'))
      if (start < 0) throw new Error(`Missing legacy helper ${name}`)
      const lineEnd = source.indexOf('\n', start)
      const singleLine = /^const (?:UPWARD_SURFACE_NORMAL_MIN_Y|DEFAULT_DIMENSIONS)\b/.test(
        source.slice(start),
      )
      const end = singleLine ? lineEnd - start - 1 : source.slice(start).search(/\n}(?=\r?\n|$)/)
      if (end < 0) throw new Error(`Missing end of legacy helper ${name}`)
      return source.slice(start, start + end + 2).replace(/^export /, '')
    })
    .join('\n')
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(declarations)
  return new Function(...Object.keys(dependencies), `${code}\nreturn { ${names.join(',')} }`)(
    ...Object.values(dependencies),
  ) as T
}

const registry = { nodes: new Map<string, Group>() }
let gridStep = 0
function loadLegacy() {
  const strategyFile = 'editor/src/components/tools/item/placement-strategies.ts'
  const { snapToGrid } = legacy<{ snapToGrid: (p: number, d: number, step: number) => number }>(
    'editor/src/components/tools/item/placement-math.ts',
    ['positiveModulo', 'snapToGrid'],
    {},
  )
  const { sanitizeShelfDimensions } = legacy<{
    sanitizeShelfDimensions: (node: ShelfNode) => ShelfNode
  }>('nodes/src/shelf/dimensions.ts', ['clampShelfDim', 'sanitizeShelfDimensions'], {})
  const { shelfRowSurfaceYs } = legacy<{ shelfRowSurfaceYs: (node: ShelfNode) => number[] }>(
    'nodes/src/shelf/geometry.ts',
    ['boardCenterYs', 'shelfRowSurfaceYs'],
    { sanitizeShelfDimensions },
  )
  const old = legacy<{
    getSurfacePlacementHeight: (host: ItemNode, event: unknown, local: Vector3) => number | null
    resolveItemSurfacePlacement: (
      host: ItemNode,
      event: unknown,
      size: number[],
      yaw: number,
    ) => { position: number[]; rotationY: number } | null
    getShelfRowSurfaceY: (host: ShelfNode, y: number) => number | null
    shelfSurfaceStrategy: {
      enter: (
        ctx: unknown,
        event: unknown,
      ) => { nodeUpdate: { position: number[]; rotation: number[] } } | null
    }
  }>(
    strategyFile,
    [
      'UPWARD_SURFACE_NORMAL_MIN_Y',
      'DEFAULT_DIMENSIONS',
      'getWorldNormalY',
      'isUpwardItemSurfaceHit',
      'getSurfacePlacementHeight',
      'resolveItemSurfacePlacement',
      'getShelfRowSurfaceY',
      'isUpwardShelfSurfaceHit',
      'shelfSurfaceStrategy',
    ],
    {
      canHostOnTop,
      isLowProfileItemSurface,
      getScaledDimensions,
      nodeRegistry,
      Vector3,
      Matrix3,
      Quaternion,
      Euler,
      sceneRegistry: registry,
      snapToGrid: (p: number, d: number) => snapToGrid(p, d, gridStep),
    },
  )

  return { snapToGrid, shelfRowSurfaceYs, old }
}
let live: ReturnType<typeof loadLegacy> | undefined
try {
  live = loadLegacy()
} catch (error) {
  if (!(error instanceof Error) || !/Missing legacy helper|ENOENT/.test(error.message)) throw error
}

const asset = {
  id: 'sofa',
  name: 'Sofa',
  category: 'furniture',
  thumbnail: '',
  src: '/sofa.glb',
  dimensions: [2, 1, 3],
}
const scene = { nodes: () => ({}), get: () => undefined } as unknown as SceneApi
const size = [0.5, 1, 0.5] as const
let restoreRegistry: () => void
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  gridStep = 0
})
afterEach(() => {
  restoreRegistry()
  registry.nodes.clear()
})

function register(kind: string, capabilities: Capabilities = {}) {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities,
  })
}

function eventFor(host: AnyNode, point: readonly [number, number, number], normalY = 1) {
  const mesh = new Group()
  mesh.position.set(4, 2, -3)
  mesh.rotation.y = Math.PI / 3
  mesh.updateMatrixWorld(true)
  registry.nodes.set(host.id, mesh)
  return {
    node: host,
    object: mesh,
    position: mesh.localToWorld(new Vector3(...point)).toArray(),
    normal: [Math.sqrt(1 - normalY ** 2), normalY, 0],
  }
}

describe.skipIf(!live)('item parity', () => {
  const { snapToGrid, old } = live ?? ({} as NonNullable<typeof live>)
  for (const fixture of [
    { name: 'sofa armrest with no authored surface', y: 0.81 },
    { name: 'sofa cushion with a different hit height', y: 0.42 },
    { name: 'scaled authored height', y: 0.81, surface: 0.7, scaleY: 2 },
    { name: 'low-profile dimension boundary', y: 0.1, height: 0.1 },
    { name: 'just above low-profile boundary', y: 0.101, height: 0.101 },
    { name: 'authored low-profile boundary', y: 0.8, surface: 0.05, scaleY: 2 },
    { name: 'wall-mounted thin shelf', y: 0.05, height: 0.05, attachTo: 'wall' },
    { name: 'ceiling host', y: 0.8, attachTo: 'ceiling' },
    { name: 'normal threshold', y: 0.8, normalY: 0.75 },
    { name: 'below normal threshold', y: 0.8, normalY: 0.749 },
    { name: 'side normal', y: 0.8, normalY: 0 },
    { name: 'oversized width', y: 0.8, width: 2.01 },
    { name: 'oversized depth', y: 0.8, depth: 3.01 },
    {
      name: 'legacy coarse fit at edge with rotation',
      y: 0.8,
      x: 0.99,
      width: 2,
      yaw: Math.PI / 4,
    },
  ]) {
    for (const step of [0, 0.5])
      test(`${fixture.name}; grid ${step}`, () => {
        gridStep = step
        const host = ItemNode.parse({
          asset: {
            ...asset,
            dimensions: [2, fixture.height ?? 1, 3],
            attachTo: fixture.attachTo,
            ...(fixture.surface === undefined ? {} : { surface: { height: fixture.surface } }),
          },
          scale: [1, fixture.scaleY ?? 1, 1],
        })
        const childSize = [fixture.width ?? 0.5, 1, fixture.depth ?? 0.5] as const
        const event = eventFor(host, [fixture.x ?? 0.37, fixture.y, -0.39], fixture.normalY ?? 1)
        const point = event.object.worldToLocal(new Vector3(...event.position)).toArray()
        const yaw = fixture.yaw ?? 0.2
        const prior = old.resolveItemSurfacePlacement(
          host,
          event,
          [...childSize],
          yaw + Math.PI / 3,
        )
        const result = resolveSurfacePlacement({
          host,
          childKind: 'procedural-item',
          childFootprint: { size: childSize, rotationY: yaw },
          hit: { point, normalWorldY: fixture.normalY ?? 1 },
          scene,
          snapScalar: (p, d) => snapToGrid(p, d, step),
        })
        expectLiveParity(fixture.name, point, childSize, yaw, fixture.normalY ?? 1, step, prior)
        expect(result !== null).toBe(prior !== null)
        if (prior) {
          expect(result!.position).toEqual(prior.position)
          expect(result!.position[1]).toBe(
            old.getSurfacePlacementHeight(host, event, new Vector3(...point)),
          )
          expect(result!.rotationY).toBeCloseTo(prior.rotationY)
          expect(result!.surfaceId).toBeNull()
        }
      })
  }

  test('D7 rejects non-finite hit Y even when legacy authored heights short-circuited it', () => {
    for (const y of [Number.NaN, Infinity, -Infinity])
      for (const authored of [false, true]) {
        const host = ItemNode.parse({
          asset: { ...asset, ...(authored ? { surface: { height: 0.7 } } : {}) },
          scale: [1, 2, 1],
        })
        const event = eventFor(host, [0, 0, 0])
        const expected = old.getSurfacePlacementHeight(host, event, new Vector3(0, y, 0))
        const result = resolveSurfacePlacement({
          host,
          childKind: 'item',
          childFootprint: { size, rotationY: 0 },
          hit: { point: [0, y, 0], normalWorldY: 1 },
          scene,
        })
        expect(expected).toBe(authored ? 1.4 : null)
        expect(result).toBeNull()
      }
  })

  test('scaled host dimensions preserve exact width and depth entry boundaries', () => {
    const host = ItemNode.parse({ asset, scale: [2, 1, 0.5] })
    const event = eventFor(host, [0, 0.8, 0])
    const point = event.object.worldToLocal(new Vector3(...event.position)).toArray()
    for (const childSize of [
      [4, 5, 1.5],
      [4.01, 1, 1.5],
      [4, 1, 1.51],
    ] as const) {
      const prior = old.resolveItemSurfacePlacement(host, event, [...childSize], 0)
      const result = resolveSurfacePlacement({
        host,
        childKind: 'item',
        childFootprint: { size: childSize, rotationY: -Math.PI / 3 },
        hit: { point, normalWorldY: 1 },
        scene,
      })
      expect(result !== null).toBe(prior !== null)
    }
  })
})

describe.skipIf(!live)('shelf parity', () => {
  const { snapToGrid, shelfRowSurfaceYs, old } = live ?? ({} as NonNullable<typeof live>)
  beforeEach(() =>
    register('shelf', {
      surfaces: {
        custom: (host) =>
          shelfRowSurfaceYs(host as ShelfNode).map((y) => ({
            position: [0, y, 0],
            normal: [0, 1, 0],
          })),
      },
    }),
  )
  for (const style of ['wall-shelf', 'bookshelf', 'open-rack', 'cubby'] as const) {
    for (const withBottom of [false, true])
      test(`${style}, bottom ${withBottom}: rows, ties, XZ, yaw and entry fit`, () => {
        const host = ShelfNode.parse({
          style,
          withBottom,
          width: 1.2,
          depth: 0.4,
          height: 1.8,
          rows: 3,
          thickness: 0.04,
        })
        const rows = shelfRowSurfaceYs(host)
        expect(shelfSurfaceProvider.surfaces!(host, { scene }).map((s) => s.position[1])).toEqual(
          rows,
        )
        expect(
          shelfSurfaceProvider.surfaces!(host, { scene }).every((s) => s.gridSnap === true),
        ).toBe(true)
        for (const y of [-0.2, ...rows, (rows[0]! + rows[1]!) / 2, 3])
          for (const step of [0, 0.5]) {
            gridStep = step
            for (const width of [0.3, 1.2, 1.21]) {
              const draft = ItemNode.parse({ asset: { ...asset, dimensions: [width, 1, 0.3] } })
              const event = eventFor(host, [0.37, y, -0.09])
              const point = event.object.worldToLocal(new Vector3(...event.position)).toArray()
              const prior = old.shelfSurfaceStrategy.enter(
                {
                  asset: draft.asset,
                  draftItem: draft,
                  state: { surface: 'floor' },
                  currentCursorRotationY: 0.2 + Math.PI / 3,
                },
                event,
              )
              const result = resolveSurfacePlacement({
                host,
                childKind: 'item',
                childFootprint: { size: getScaledDimensions(draft), rotationY: 0.2 },
                hit: { point, normalWorldY: 1 },
                scene,
                snapScalar: (p, d) => snapToGrid(p, d, step),
              })
              expectLiveParity(
                `${style}, bottom ${withBottom}`,
                point,
                getScaledDimensions(draft),
                0.2,
                1,
                step,
                prior
                  ? { position: prior.nodeUpdate.position, rotationY: prior.nodeUpdate.rotation[1] }
                  : null,
              )
              expect(result !== null).toBe(prior !== null)
              if (prior) {
                expect(result!.position).toEqual(prior.nodeUpdate.position)
                expect(result!.position[1]).toBe(old.getShelfRowSurfaceY(host, point[1]))
                expect(result!.rotationY).toBeCloseTo(prior.nodeUpdate.rotation[1]!)
                expect(result!.surfaceId).toBe(`row:${rows.indexOf(result!.position[1])}`)
              }
            }
          }
      })
  }

  test('missing rows and downward hits resolve no surface', () => {
    const host = ShelfNode.parse({})
    const args = { host, childKind: 'item', childFootprint: { size, rotationY: 0 }, scene }
    expect(
      resolveSurfacePlacement({ ...args, hit: { point: [0, 1, 0], normalWorldY: 0.74 } }),
    ).toBeNull()
    nodeRegistry._reset()
    expect(
      resolveSurfacePlacement({ ...args, hit: { point: [0, 1, 0], normalWorldY: 1 } }),
    ).toBeNull()
  })
})

describe('procedural named surfaces', () => {
  test('query IDs and frames survive parameters; placement matches existing containment including tolerance', () => {
    for (const height of [1.8, 2.4]) {
      const host = ProceduralItemNode.parse({ recipe: shelfRecipe, parameters: { height } })
      const surfaces = queryProceduralItem(host, {}).surfaces
      const adapted = proceduralItemSurfaceProvider.surfaces!(host as unknown as AnyNode, { scene })
      expect(adapted.map((s) => s.id)).toEqual(surfaces.map((s) => s.id))
      for (const surface of surfaces)
        for (const fixture of [
          { x: 0, width: 0.2, depth: 0.2, yaw: 0 },
          { x: 0.1, width: 0.2, depth: 0.2, yaw: 0.3 },
          { x: 0, width: 0.2, depth: 0.6, yaw: Math.PI / 2 },
          { x: 0, width: 0.6, depth: 0.2, yaw: Math.PI / 4 },
          { x: 0.5, width: 0.4, depth: 0.2, yaw: 0 },
          { x: 0, width: surface.size[0] + 1e-6, depth: surface.size[1], yaw: 0 },
          { x: 0, width: surface.size[0] + 4e-6, depth: surface.size[1], yaw: 0 },
        ]) {
          const child = ItemNode.parse({
            asset: { ...asset, dimensions: [fixture.width, 1, fixture.depth] },
            parentId: host.id,
            position: [fixture.x, 0, 0],
            rotation: [0, fixture.yaw, 0],
          })
          const attached = {
            ...host,
            children: [child.id],
            attachments: { [child.id]: surface.id },
          }
          let valid = true
          try {
            validateProceduralRelations(attached, { [host.id]: attached, [child.id]: child })
          } catch {
            valid = false
          }
          const point = transformPoint(frame(surface.position, surface.rotation), child.position)
          const rejections: string[] = []
          const result = resolveSurfacePlacement({
            onReject: (reason) => rejections.push(reason),
            host: host as unknown as AnyNode,
            childKind: 'item',
            childFootprint: { size: getScaledDimensions(child), rotationY: fixture.yaw },
            hit: { point, normalWorldY: 1 },
            scene,
          })
          expect(result !== null).toBe(valid)
          if (valid) {
            expect(result!.surfaceId).toBe(surface.id)
            expect(result!.position).toEqual(point)
          } else expect(rejections).toEqual(['footprint-outside-surface'])
        }
    }
  })

  test('offset, yawed named surface keeps free placement in the host frame', () => {
    const recipe = {
      ...shelfRecipe,
      surfaces: [
        {
          id: 'ledge',
          label: 'Ledge',
          position: [2, 3, -1],
          rotation: [0, 0.6, 0],
          size: [1.5, 0.6],
        },
      ],
    }
    const host = ProceduralItemNode.parse({
      recipe,
      parentId: 'shelf_outer',
      position: [8, 2, 7],
      rotation: [0, 1, 0],
    })
    const surface = queryProceduralItem({ ...host, parentId: null }, {}).surfaces.find(
      (s) => s.id === 'ledge',
    )!
    const point = transformPoint(frame(surface.position, surface.rotation), [0.2, 0, 0.05])
    const result = resolveSurfacePlacement({
      host: host as unknown as AnyNode,
      childKind: 'plugin-child',
      childFootprint: { size: [0.4, 1, 0.2], rotationY: 0.6 },
      hit: { point, normalWorldY: 1 },
      scene,
    })
    expect(result).toMatchObject({
      position: point,
      rotationY: 0.6,
      surfaceId: 'ledge',
      childFrame: 'surface-local',
    })
    expect(result!.surfaceLocal!.position[0]).toBeCloseTo(0.2)
    expect(result!.surfaceLocal!.position[2]).toBeCloseTo(0.05)
    expect(
      resolveSurfacePlacement({
        host: host as unknown as AnyNode,
        childKind: 'item',
        childFootprint: { size, rotationY: 0 },
        hit: { point: [20, 3, 20], normalWorldY: 1 },
        scene,
      }),
    ).toBeNull()
  })
})

describe('protocol defaults', () => {
  const host = { id: 'plugin_host', type: 'plugin-host' } as unknown as AnyNode
  const hit = { point: [0.37, 0.81, -0.39] as const, normalWorldY: 1 }
  const args = {
    host,
    childKind: 'plugin-child',
    childFootprint: { size, rotationY: 0.2 },
    hit,
    scene,
  }

  test('unregistered and undeclared kinds host freely; child parent declarations are not consulted', () => {
    register('plugin-child', { hostable: { parents: ['wall'] } })
    expect(resolveSurfacePlacement(args)).toEqual({
      position: hit.point,
      rotationY: 0.2,
      surfaceId: null,
      childFrame: 'host-local',
      surfaceLocal: null,
    })
    register('plugin-host')
    expect(resolveSurfacePlacement(args)).not.toBeNull()
    expect(resolveSurfacePlacement({ ...args, hit: { ...hit, normalWorldY: 0.749 } })).toBeNull()
  })

  test('one non-physical list refuses every listed host', () => {
    for (const type of NON_PHYSICAL_HOST_KINDS)
      expect(resolveSurfacePlacement({ ...args, host: { ...host, type } as AnyNode })).toBeNull()
  })

  test('ceiling refusal covers both catalog and procedural mounting, even with an explicit provider', () => {
    const provider: SurfaceProvider = {
      childFrame: 'host-local',
      resolveHit: () => ({ id: 'top', position: [0, 1, 0], normal: [0, 1, 0] }),
    }
    const surfaces: SurfacesConfig = { hosting: provider }
    register('plugin-host', { surfaces })
    for (const extra of [
      { asset: { attachTo: 'ceiling' } },
      { recipe: { mounting: { attachTo: 'ceiling' } } },
    ]) {
      expect(
        resolveSurfacePlacement({ ...args, host: { ...host, ...extra } as unknown as AnyNode }),
      ).toBeNull()
    }
  })

  test('registered providers receive scene context; acceptance and grid snapping default true', () => {
    const surface: HostSurface = {
      id: 'counter',
      position: [0, 1, 0],
      normal: [0, 1, 0],
      region: { kind: 'rect', size: [1, 1] },
    }
    const provider: SurfaceProvider = {
      childFrame: 'host-local',
      resolveHit: (_host, _hit, ctx) => {
        expect(ctx.scene).toBe(scene)
        return surface
      },
    }
    const surfaces: SurfacesConfig = { hosting: provider }
    register('plugin-host', { surfaces })
    expect(getSurfaceProvider(host)).toBe(provider)
    expect(resolveSurfacePlacement({ ...args, snapScalar: () => 0 })).toEqual({
      position: [0, 1, 0],
      rotationY: 0.2,
      surfaceId: 'counter',
      childFrame: 'host-local',
      surfaceLocal: { position: [0, -0, 0], rotationY: 0.2, rotation: [0, 0.2, 0] },
    })
    provider.accepts = (_host, kind) => kind === 'book'
    const rejections: string[] = []
    expect(
      resolveSurfacePlacement({ ...args, onReject: (reason) => rejections.push(reason) }),
    ).toBeNull()
    expect(rejections).toEqual(['child-not-accepted'])
    expect(resolveSurfacePlacement({ ...args, childKind: 'book' })).not.toBeNull()
  })

  test('unbounded surfaces compare host dimensions when available without an allowlist', () => {
    register('plugin-host', {
      dragBounds: (_host, nodes) => {
        expect(nodes).toEqual({})
        return { size: [0.4, 1, 2] }
      },
    })
    const rejections: string[] = []
    expect(
      resolveSurfacePlacement({ ...args, onReject: (reason) => rejections.push(reason) }),
    ).toBeNull()
    expect(rejections).toEqual(['footprint-exceeds-host'])
    expect(resolveSurfacePlacement({ ...args, checkFootprint: false })).not.toBeNull()
  })

  test('a sink cutout and post-snap overhang return null with diagnostic reasons', () => {
    const surface: HostSurface = {
      id: 'counter',
      position: [0, 1, 0],
      normal: [0, 1, 0],
      region: {
        kind: 'rect',
        size: [1, 1],
        holes: [
          [
            [-0.2, -0.2],
            [0.2, -0.2],
            [0.2, 0.2],
            [-0.2, 0.2],
          ],
        ],
      },
    }
    const surfaces: SurfacesConfig = {
      hosting: { childFrame: 'host-local', resolveHit: () => surface },
    }
    register('plugin-host', { surfaces })
    const rejections: string[] = []
    const onReject = (reason: string) => rejections.push(reason)
    expect(
      resolveSurfacePlacement({ ...args, onReject, hit: { point: [0, 1, 0], normalWorldY: 1 } }),
    ).toBeNull()
    surface.gridSnap = true
    expect(resolveSurfacePlacement({ ...args, onReject, snapScalar: () => 1 })).toBeNull()
    expect(rejections).toEqual(['footprint-outside-surface', 'footprint-outside-surface'])
    expect(
      resolveSurfacePlacement({ ...args, checkFootprint: false, snapScalar: () => 1 })!.position,
    ).toEqual([1, 1, 1])
  })

  test('resolution leaves host data and scene state unchanged', () => {
    const frozen = Object.freeze(ItemNode.parse({ asset }))
    const nodes = Object.freeze({ [frozen.id]: frozen })
    const before = JSON.stringify(nodes)
    const readOnlyScene = { get: () => frozen, nodes: () => nodes } as unknown as SceneApi
    expect(resolveSurfacePlacement({ ...args, host: frozen, scene: readOnlyScene })).not.toBeNull()
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

function namedHost(rotation: [number, number, number] = [0, 0.6, 0]) {
  return ProceduralItemNode.parse({
    recipe: {
      ...shelfRecipe,
      surfaces: [{ id: 'ledge', label: 'Ledge', position: [2, 3, -1], rotation, size: [1.5, 0.6] }],
    },
    position: [8, 2, 7],
    rotation: [0.1, 1, -0.15],
  })
}

function attachedScene(host: ProceduralItemNode, child: ItemNode | ProceduralItemNode) {
  const attached = { ...host, children: [child.id], attachments: { [child.id]: 'ledge' } }
  return { attached, nodes: { [host.id]: attached, [child.id]: child } }
}

function expectVec(actual: readonly number[], expected: readonly number[]) {
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i]!, 10)
  })
}

describe('surface frame contract', () => {
  test.each([
    ['D3 offset point inverse at the edge', [0.64, 0, 0.02], [0.2, 0.1, 0.2]],
    ['D3 surface yaw at the edge', [0.34, 0, 0.15], [0.8, 0.1, 0.2]],
  ] as const)('%s', (_name, local, dimensions) => {
    const host = namedHost()
    const surface = queryProceduralItem(host, {}).surfaces.find((s) => s.id === 'ledge')!
    const point = transformPoint(frame(surface.position, surface.rotation), [...local])
    const result = resolveSurfacePlacement({
      host: host as unknown as AnyNode,
      childKind: 'item',
      childFootprint: { size: dimensions, rotationY: 0.6 },
      hit: { point, normalWorldY: 1 },
      scene,
    })
    expect(result).not.toBeNull()
    expect(result!.childFrame).toBe('surface-local')
    expectVec(result!.surfaceLocal!.position, local)
    expect(result!.surfaceLocal!.rotationY).toBeCloseTo(0)
    const child = ItemNode.parse({
      asset: { ...asset, dimensions },
      parentId: host.id,
      position: result!.surfaceLocal!.position,
      rotation: [0, result!.surfaceLocal!.rotationY, 0],
    })
    const { attached, nodes } = attachedScene(host, child)
    expect(() => validateProceduralRelations(attached, nodes)).not.toThrow()
    const expectedFrame = composeFrames(
      frame(host.position, host.rotation),
      frame(result!.position as [number, number, number], [0, result!.rotationY, 0]),
    )
    const actualFrame = nodeLevelFrame(child.id, nodes)
    expectVec(actualFrame.position, expectedFrame.position)
    actualFrame.axes.forEach((axis, i) => {
      expectVec(axis, expectedFrame.axes[i]!)
    })
    expect(attachmentBounds(child).min[1]).toBeCloseTo(0)

    const outside = transformPoint(frame(surface.position, surface.rotation), [
      0.75 - dimensions[0] / 2 + 0.01,
      0,
      local[2],
    ])
    const args = {
      host: host as unknown as AnyNode,
      childKind: 'item',
      childFootprint: { size: dimensions, rotationY: 0.6 },
      hit: { point: outside, normalWorldY: 1 },
      scene,
    }
    expect(resolveSurfacePlacement(args)).toBeNull()
    const unchecked = resolveSurfacePlacement({ ...args, checkFootprint: false })!
    const overhang = {
      ...child,
      position: [...unchecked.surfaceLocal!.position] as [number, number, number],
    }
    const invalid = attachedScene(host, overhang)
    expect(() => validateProceduralRelations(invalid.attached, invalid.nodes)).toThrow(
      'does not fit',
    )
  })

  test.each([
    [0.3, 0.6, 0.2],
    [-0.35, -0.7, 0.25],
    [0, Math.PI / 2, 0],
  ] as [
    number,
    number,
    number,
  ][])('full surface rotation %j composes through query.ts', (rx, ry, rz) => {
    const rotation: [number, number, number] = [rx, ry, rz]
    const host = namedHost(rotation)
    const surface = queryProceduralItem(host, {}).surfaces.find((s) => s.id === 'ledge')!
    const local: [number, number, number] = [0.1, 0, 0.05]
    const point = transformPoint(frame(surface.position, surface.rotation), local)
    const result = resolveSurfacePlacement({
      host: host as unknown as AnyNode,
      childKind: 'item',
      childFootprint: { size: [0.2, 0.1, 0.2], rotationY: rotation[1], rotation },
      hit: { point, normalWorldY: surface.normal[1] },
      scene,
    })!
    expect(result).not.toBeNull()
    expectVec(result.surfaceLocal!.position, local)
    const child = ItemNode.parse({
      asset: { ...asset, dimensions: [0.2, 0.1, 0.2] },
      parentId: host.id,
      position: result.surfaceLocal!.position,
      rotation: result.surfaceLocal!.rotation,
    })
    const { attached, nodes } = attachedScene(host, child)
    expect(() => validateProceduralRelations(attached, nodes)).not.toThrow()
    const actual = nodeLevelFrame(child.id, nodes)
    const expected = composeFrames(
      frame(host.position, host.rotation),
      frame([...result.position], rotation),
    )
    expectVec(actual.position, expected.position)
    actual.axes.forEach((axis, i) => {
      expectVec(axis, expected.axes[i]!)
    })
  })

  test('full child rotation and off-centre bounds agree with attachmentBounds and validation', () => {
    const host = namedHost([0, 0, 0])
    for (const rotation of [
      [0.4, 0.2, 0],
      [0, -0.3, 0.45],
      [0.3, 0.2, -0.4],
    ] as [number, number, number][]) {
      for (const offCentre of [false, true]) {
        const child = offCentre
          ? ProceduralItemNode.parse({
              recipe: {
                ...shelfRecipe,
                parameters: shelfRecipe.parameters.map(({ part, ...p }) => p),
                surfaces: [],
                parts: [
                  {
                    count: 1,
                    id: 'shape',
                    label: 'Shape',
                    shapes: [
                      {
                        id: 'box',
                        primitive: 'box',
                        slot: 'frame',
                        size: [0.3, 0.4, 0.2],
                        position: [0.25, 0.35, -0.05],
                      },
                    ],
                  },
                ],
              },
              parentId: host.id,
              rotation,
            })
          : ItemNode.parse({
              asset: { ...asset, dimensions: [0.3, 0.4, 0.2] },
              parentId: host.id,
              rotation,
            })
        const bounds = offCentre
          ? evaluateRecipe((child as ProceduralItemNode).recipe)
          : {
              min: [-0.15, 0, -0.1] as const,
              max: [0.15, 0.4, 0.1] as const,
              dimensions: [0.3, 0.4, 0.2] as const,
            }
        for (const x of [0, 0.35, 0.6]) {
          const args = {
            host: host as unknown as AnyNode,
            childKind: child.type,
            childFootprint: {
              size: bounds.dimensions,
              rotationY: rotation[1],
              rotation,
              localBounds: bounds,
            },
            hit: { point: [2 + x, 3, -1] as const, normalWorldY: 1 },
            scene,
          }
          const proposal = resolveSurfacePlacement({ ...args, checkFootprint: false })!
          const placed = {
            ...child,
            position: [...proposal.surfaceLocal!.position] as [number, number, number],
            rotation: [...proposal.surfaceLocal!.rotation] as [number, number, number],
          }
          const attached = attachedScene(host, placed)
          expect(attachmentBounds(placed).min[1]).toBeCloseTo(0)
          let valid = true
          try {
            validateProceduralRelations(attached.attached, attached.nodes)
          } catch {
            valid = false
          }
          expect(resolveSurfacePlacement(args) !== null).toBe(valid)
        }
      }
    }
  })

  test('recipe cache reuses surfaces and invalidates parameter and recipe edits', () => {
    const host = ProceduralItemNode.parse({ recipe: shelfRecipe, parameters: { height: 1.8 } })
    const surfaces = () =>
      proceduralItemSurfaceProvider.surfaces!(host as unknown as AnyNode, { scene })
    const initial = surfaces()
    expect(surfaces()).toBe(initial)
    host.parameters.height = 2.4
    const taller = surfaces()
    expect(taller).not.toBe(initial)
    expect(taller.map((s) => s.position)).not.toEqual(initial.map((s) => s.position))
    host.parameters = { height: 1.8 }
    expect(surfaces()).toEqual(initial)
    host.recipe.surfaces = [
      { id: 'extra', label: 'Extra', position: [0, 3, 0], rotation: [0, 0, 0], size: [1, 1] },
    ]
    expect(surfaces().some((s) => s.id === 'extra')).toBe(true)
  })

  test('all providers reject every non-finite hit axis', () => {
    const hosts = [
      ItemNode.parse({ asset: { ...asset, surface: { height: 1 } } }),
      ShelfNode.parse({}),
      namedHost(),
      { id: 'plugin_host', type: 'plugin-host' },
    ] as AnyNode[]
    for (const host of hosts)
      for (const axis of [0, 1, 2])
        for (const value of [NaN, Infinity, -Infinity]) {
          const point: [number, number, number] = [0, 1, 0]
          point[axis] = value
          expect(
            getSurfaceProvider(host).resolveHit(host, { point, normalWorldY: 1 }, { scene }),
          ).toBeNull()
          const reasons: string[] = []
          expect(
            resolveSurfacePlacement({
              host,
              childKind: 'item',
              childFootprint: { size, rotationY: 0 },
              hit: { point, normalWorldY: 1 },
              scene,
              onReject: (r) => reasons.push(r),
            }),
          ).toBeNull()
          expect(reasons).toEqual(['invalid-hit'])
        }
  })

  test('grid policy is independent of ids; disabling fit does not bypass acceptance', () => {
    const host = { id: 'plugin_host', type: 'plugin-host' } as unknown as AnyNode
    for (const id of [null, 'named'])
      for (const gridSnap of [undefined, true, false]) {
        const provider: SurfaceProvider = {
          childFrame: 'host-local',
          resolveHit: () => ({ id, gridSnap, position: [0, 1, 0], normal: [0, 1, 0] }),
        }
        nodeRegistry._reset()
        register('plugin-host', { surfaces: { hosting: provider } })
        const args = {
          host,
          childKind: 'item',
          childFootprint: { size, rotationY: 0 },
          hit: { point: [0.37, 1, -0.39] as const, normalWorldY: 1 },
          scene,
          snapScalar: () => 0,
        }
        expect(resolveSurfacePlacement(args)!.position).toEqual(
          gridSnap === false ? [0.37, 1, -0.39] : [0, 1, 0],
        )
        provider.accepts = () => false
        expect(resolveSurfacePlacement({ ...args, checkFootprint: false })).toBeNull()
      }
  })
})
