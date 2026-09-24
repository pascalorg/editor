import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Group } from 'three'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../schema/base'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { getTopSurfaceHeight } from '../services/hosting'
import { analyzePortConnectivity } from '../services/port-connectivity'
import { canHostSurfaceChild, rendersHostedChildren } from '../services/surface-hosting'
import { buildPortComponents } from '../services/system-graph'
import useScene from '../store/use-scene'
import { cloneSceneGraph } from '../utils/clone-scene-graph'
import { validateBuildJson } from '../validation/validate-build-json'
import {
  bakePolicyOf,
  isNodeKindEnabled,
  isPresettable,
  isRegistryMovable,
  isRegistrySelectable,
  isSelectionHighlightEnabled,
  kindsWithFloorplanScope,
  loadPlugin,
  nodeRegistry,
} from './registry'
import { cascadeDirty, collectDescendants } from './relations-resolver'
import { createSceneApi } from './scene-api'
import { cloneNodesInto } from './subtree'
import type { AnyNodeDefinition, Plugin } from './types'

// Plugin API v1 at the registry and scene-store level: capabilities, ports,
// surfaces, relations, editing, reload and clone for synthetic plugin kinds.
// Rendering, systems, bake and export are pinned where they dispatch:
// viewer `plugin-dispatch.test.tsx` and editor `glb-export.test.ts`.
// `test.failing` marks a known v1 gap; the PR that closes it flips it to `test`.

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const Vec3 = z.tuple([z.number(), z.number(), z.number()])
const node = <T extends string, P extends string>(prefix: P, type: T, shape: z.ZodRawShape = {}) =>
  BaseNode.extend({ id: objectId(prefix), type: nodeType(type), ...shape })

const Planter = node('fxplanter', 'fixture:planter', {
  size: Vec3.default([1.2, 0.6, 0.5]),
})
const Pump = node('fxpump', 'fixture:pump', { position: Vec3.default([0, 0, 0]) })
const Pipe = node('fxpipe', 'fixture:pipe', { path: z.array(Vec3).default([]) })
const Bench = node('fxbench', 'fixture:bench', {
  seatHeight: z.number().default(0.45),
  children: z.array(z.string()).default([]),
})
const Sprout = node('fxsprout', 'fixture:sprout')
// Plugin-owned node references, like a shot's ordered camera list.
const Marker = node('fxmarker', 'fixture:marker', { targetIds: z.array(z.string()).default([]) })

type Fields = Record<string, any>

function def(kind: string, schema: AnyNodeDefinition['schema'], fields: Fields = {}) {
  return {
    kind,
    schemaVersion: 1,
    schema,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    ...fields,
  } as AnyNodeDefinition
}

const water = (id: string, position: readonly number[]) => ({
  id,
  position,
  direction: [1, 0, 0],
  diameter: 0.05,
  system: 'water',
})

const fixturePlugin = (): Plugin => ({
  id: 'fixture:pack',
  apiVersion: 1,
  nodes: [
    def('fixture:planter', Planter),
    def('fixture:pump', Pump, {
      distributionRole: 'equipment',
      ports: (n: Fields) => [water('outlet', [n.position[0] + 0.5, 0, 0])],
    }),
    def('fixture:pipe', Pipe, {
      distributionRole: 'run',
      ports: (n: Fields) =>
        n.path.length < 2 ? [] : [water('start', n.path[0]), water('end', n.path.at(-1))],
    }),
    def('fixture:bench', Bench, {
      capabilities: { surfaces: { top: { height: (n: Fields) => n.seatHeight } } },
      relations: { hosts: ['fixture:sprout'], cascadeDelete: 'descendants' },
      renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    }),
    def('fixture:sprout', Sprout, { geometry: () => new Group() }),
    def('fixture:marker', Marker),
  ],
})

const parse = <N = AnyNode>(kind: string, data: Fields = {}) =>
  nodeRegistry.get(kind)!.schema.parse({ ...data, type: kind }) as N
const nid = (id: string) => id as AnyNodeId
const at = (x: number, z: number) => [x, 0, z]
const ofType = (nodes: Record<string, AnyNode>, type: string) =>
  Object.values(nodes).find((n) => n.type === (type as AnyNode['type']))!

function loadLevel(nodes: AnyNode[], installedPlugins?: string[]) {
  const level = LevelNode.parse({ children: nodes.map((n) => n.id) })
  const record = Object.fromEntries([
    [level.id, level],
    ...nodes.map((n) => [n.id, { ...n, parentId: level.id }]),
  ])
  useScene
    .getState()
    .setScene(
      record,
      [nid(level.id)],
      installedPlugins && { installedPlugins, hasExplicitPluginInstallState: true },
    )
  return level
}

function saved() {
  const { nodes, rootNodeIds, installedPlugins } = useScene.getState()
  return JSON.parse(JSON.stringify({ nodes, rootNodeIds, installedPlugins })) as {
    nodes: Record<AnyNodeId, AnyNode>
    rootNodeIds: AnyNodeId[]
    installedPlugins: string[]
  }
}

const previousScene = useScene.getState()
let restoreRegistry: () => void

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  useScene.getState().setReadOnly(false)
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
})

afterEach(() => {
  restoreRegistry()
  useScene.setState(previousScene)
  useScene.temporal.getState().clear()
})

describe('plugin API v1: capabilities', () => {
  test('every optional field has a safe default for a minimal plugin kind', async () => {
    await loadPlugin({ id: 'fixture:min', apiVersion: 1, nodes: [def('fixture:min', Sprout)] })
    const minimal = nodeRegistry.get('fixture:min')!

    expect(isRegistrySelectable('fixture:min')).toBe(false)
    expect(isRegistryMovable('fixture:min')).toBe(false)
    expect(isSelectionHighlightEnabled('fixture:min')).toBe(true)
    expect(isPresettable(minimal)).toBe(false)
    expect(bakePolicyOf('fixture:min')).toBe('static')
    expect(kindsWithFloorplanScope('level')).toEqual(['fixture:min'])
    expect(rendersHostedChildren(minimal)).toBe(false)
  })
})

describe('plugin API v1: ports, surfaces and relations', () => {
  test('plugin ports join the system graph and port connectivity', async () => {
    await loadPlugin(fixturePlugin())
    const pump = parse<AnyNode>('fixture:pump')
    const pipe = parse<Fields>('fixture:pipe', { path: [at(0.5, 0), at(3, 0)] })
    const stray = parse<Fields>('fixture:pipe', { path: [at(9, 9), at(12, 9)] })
    loadLevel([pump, pipe as AnyNode, stray as AnyNode])
    const nodes = useScene.getState().nodes

    const components = buildPortComponents(nodes).map((ids) => [...ids].sort())
    expect(components).toContainEqual([nid(pipe.id), nid(pump.id)].sort())
    expect(components).toContainEqual([nid(stray.id)])
    expect(analyzePortConnectivity(pump, nodes).connections).toEqual([
      { kind: 'run', nodeId: nid(pipe.id), startPath: pipe.path },
    ])
  })

  test('a plugin host publishes its top surface and accepts a plugin child', async () => {
    await loadPlugin(fixturePlugin())
    const bench = parse<AnyNode>('fixture:bench', { seatHeight: 0.5 })

    expect(getTopSurfaceHeight(bench)).toBe(0.5)
    expect(canHostSurfaceChild(bench, 'fixture:sprout')).toBe(true)
  })

  test('relations cascade dirty marks and deletion through a plugin host', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = parse<AnyNode>('fixture:sprout')
    const bench = parse<AnyNode>('fixture:bench', { children: [sprout.id] })
    loadLevel([bench])
    useScene.getState().createNode({ ...sprout, parentId: bench.id }, bench.id)
    const scene = createSceneApi(useScene)

    expect(cascadeDirty(bench.id, { scene })).toEqual(new Set([bench.id, sprout.id]))
    expect(collectDescendants(bench.id, { scene })).toEqual(new Set([bench.id, sprout.id]))
    useScene.getState().deleteNode(bench.id)
    expect(useScene.getState().nodes[sprout.id]).toBeUndefined()
  })
})

describe('plugin API v1: editing and reload', () => {
  test('plugin nodes create, update, delete and undo through the scene store', async () => {
    await loadPlugin(fixturePlugin())
    const level = loadLevel([], ['fixture:pack'])
    const planter = parse<AnyNode>('fixture:planter')
    const size = () => (useScene.getState().nodes[planter.id] as unknown as Fields)?.size
    const { temporal } = useScene
    temporal.getState().clear()

    useScene.getState().createNode(planter, nid(level.id))
    expect(useScene.getState().dirtyNodes.has(planter.id)).toBe(true)
    useScene.getState().updateNode(planter.id, { size: [2, 1, 2] } as Partial<AnyNode>)
    expect(size()).toEqual([2, 1, 2])
    temporal.getState().undo()
    expect(size()).toEqual([1.2, 0.6, 0.5])
    useScene.getState().deleteNode(planter.id)
    temporal.getState().undo()
    expect(size()).toEqual([1.2, 0.6, 0.5])
  })

  test('save, validate and reload in a fresh registry keep plugin nodes and installs', async () => {
    await loadPlugin(fixturePlugin())
    loadLevel([parse('fixture:planter', { position: [1, 0, 2] })], ['fixture:pack'])
    const before = saved()

    const validation = validateBuildJson(before)
    expect(validation.ok).toBe(true)
    expect(validation.stats.pluginTypes).toEqual({ 'fixture:planter': 1 })
    expect(validation.schemaIssues).toEqual([])

    nodeRegistry._reset()
    await loadPlugin(fixturePlugin())
    useScene.getState().unloadScene()
    useScene.getState().setScene(before.nodes, before.rootNodeIds, {
      installedPlugins: before.installedPlugins,
      hasExplicitPluginInstallState: true,
    })
    expect(saved()).toEqual(before)
    const planter = ofType(before.nodes, 'fixture:planter')
    expect(parse<AnyNode>('fixture:planter', planter)).toEqual(planter)
  })

  test('a scene loaded before its plugin registers keeps build work for the late registration', async () => {
    const planter = Planter.parse({}) as unknown as AnyNode
    loadLevel([planter], ['fixture:pack'])

    await loadPlugin(fixturePlugin())

    expect(isNodeKindEnabled('fixture:planter', useScene.getState().installedPlugins)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(planter.id)).toBe(true)
  })

  test('duplicate and project clone mint prefixed ids, rewire children and keep installs', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = parse<AnyNode>('fixture:sprout')
    const bench = parse<AnyNode>('fixture:bench', { children: [sprout.id] })

    const duplicate = cloneNodesInto([bench, { ...sprout, parentId: bench.id }], {
      rootId: bench.id,
    })
    const [root, child] = duplicate.nodes as unknown as [Fields, AnyNode]
    expect([root.id, child.id]).toEqual([
      expect.stringMatching(/^fxbench_/),
      expect.stringMatching(/^fxsprout_/),
    ])
    expect(root.children).toEqual([child.id])
    expect(child.parentId).toBe(root.id)

    loadLevel([bench, { ...sprout, parentId: bench.id }], ['fixture:pack'])
    const clone = cloneSceneGraph(saved())
    expect(clone.installedPlugins).toEqual(['fixture:pack'])
    expect(ofType(clone.nodes, 'fixture:bench').id).not.toBe(bench.id)
  })

  // Known v1 gap (R1 portable clone hook, owner P-03): a plugin cannot declare
  // which of its fields hold node ids, so project clone and subtree duplicate
  // copy them verbatim and they keep pointing at the source scene.
  test.failing('project clone remaps plugin-owned node references', async () => {
    await loadPlugin(fixturePlugin())
    const planter = parse<AnyNode>('fixture:planter')
    loadLevel([planter, parse('fixture:marker', { targetIds: [planter.id] })])

    const { nodes } = cloneSceneGraph(saved())
    expect((ofType(nodes, 'fixture:marker') as unknown as Fields).targetIds).toEqual([
      ofType(nodes, 'fixture:planter').id,
    ])
  })

  test.failing('subtree duplicate remaps plugin-owned node references', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = parse<AnyNode>('fixture:sprout')
    const marker = parse<AnyNode>('fixture:marker', { targetIds: [sprout.id] })
    const bench = parse<AnyNode>('fixture:bench', { children: [sprout.id, marker.id] })

    const { nodes, idMap } = cloneNodesInto(
      [bench, { ...sprout, parentId: bench.id }, { ...marker, parentId: bench.id }],
      { rootId: bench.id },
    )
    const record = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect((ofType(record, 'fixture:marker') as unknown as Fields).targetIds).toEqual([
      idMap.get(sprout.id),
    ])
  })
})

describe('plugin API v1: no install', () => {
  // The store never infers legacy visibility: a host rendering a saved scene
  // (viewer, bake) must pass installedPlugins or every plugin kind is off.
  test('a host that omits install state disables plugin kinds; only a missing list is legacy', async () => {
    await loadPlugin(fixturePlugin())
    loadLevel([parse('fixture:planter')])

    expect(useScene.getState().hasExplicitPluginInstallState).toBe(false)
    expect(isNodeKindEnabled('fixture:planter', useScene.getState().installedPlugins)).toBe(false)
    expect(isNodeKindEnabled('fixture:planter')).toBe(true)
  })

  test('nodes of a plugin the host never loaded survive load, validation and save', () => {
    const planter = Planter.parse({}) as unknown as AnyNode
    loadLevel([planter], ['fixture:pack'])
    const after = saved()

    expect(after.nodes[planter.id]).toMatchObject({
      type: 'fixture:planter',
      size: [1.2, 0.6, 0.5],
    })
    expect(after.installedPlugins).toEqual(['fixture:pack'])
    const validation = validateBuildJson(after)
    expect(validation.ok).toBe(true)
    expect(validation.stats.unknownTypes).toEqual({ 'fixture:planter': 1 })
  })
})
