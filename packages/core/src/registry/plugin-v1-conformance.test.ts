import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Group } from 'three'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../schema/base'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode } from '../schema/types'
import { getTopSurfaceHeight } from '../services/hosting'
import { analyzePortConnectivity } from '../services/port-connectivity'
import { canHostSurfaceChild, rendersHostedChildren } from '../services/surface-hosting'
import { buildPortComponents } from '../services/system-graph'
import useScene from '../store/use-scene'
import { cloneSceneGraph, type SceneGraph } from '../utils/clone-scene-graph'
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
import type { AnyNodeDefinition, NodeDefinition, NodePort, Plugin } from './types'

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
const Planter = BaseNode.extend({
  id: objectId('fxplanter'),
  type: nodeType('fixture:planter'),
  size: Vec3.default([1.2, 0.6, 0.5]),
})
const Pump = BaseNode.extend({
  id: objectId('fxpump'),
  type: nodeType('fixture:pump'),
  position: Vec3.default([0, 0, 0]),
})
const Pipe = BaseNode.extend({
  id: objectId('fxpipe'),
  type: nodeType('fixture:pipe'),
  path: z.array(Vec3).default([]),
})
const Bench = BaseNode.extend({
  id: objectId('fxbench'),
  type: nodeType('fixture:bench'),
  seatHeight: z.number().default(0.45),
  children: z.array(z.string()).default([]),
})
const Sprout = BaseNode.extend({ id: objectId('fxsprout'), type: nodeType('fixture:sprout') })
// Plugin-owned node references, like a shot's ordered camera list.
const Marker = BaseNode.extend({
  id: objectId('fxmarker'),
  type: nodeType('fixture:marker'),
  targetIds: z.array(z.string()).default([]),
})

// The only casts: API v1 cannot type these boundaries. `NodeDefinition<S>` does
// not widen to `AnyNodeDefinition`, and plugin nodes are not members of the
// closed `AnyNode` union, so every shipped plugin casts here too. Fixtures stay
// typed against `NodeDefinition<S>` and their schemas, so a contract change
// fails typecheck.
const asPluginNode = <S extends z.ZodObject>(def: NodeDefinition<S>) =>
  def as unknown as AnyNodeDefinition
const asSceneNode = (node: { id: string; type: string }) => node as unknown as AnyNode
const asScenePatch = <S extends z.ZodObject>(_schema: S, patch: Partial<z.infer<S>>) =>
  patch as unknown as Partial<AnyNode>

const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const
const water = (id: string, position: NodePort['position']): NodePort => ({
  id,
  position,
  direction: [1, 0, 0],
  diameter: 0.05,
  system: 'water',
})

const planterDef: NodeDefinition<typeof Planter> = {
  kind: 'fixture:planter',
  schemaVersion: 1,
  schema: Planter,
  category: 'furnish',
  defaults: () => ({ ...base, size: [1.2, 0.6, 0.5] }),
  capabilities: {},
}
const pumpDef: NodeDefinition<typeof Pump> = {
  kind: 'fixture:pump',
  schemaVersion: 1,
  schema: Pump,
  category: 'utility',
  defaults: () => ({ ...base, position: [0, 0, 0] }),
  capabilities: {},
  distributionRole: 'equipment',
  ports: (node) => [water('outlet', [node.position[0] + 0.5, 0, 0])],
}
const pipeDef: NodeDefinition<typeof Pipe> = {
  kind: 'fixture:pipe',
  schemaVersion: 1,
  schema: Pipe,
  category: 'utility',
  defaults: () => ({ ...base, path: [] }),
  capabilities: {},
  distributionRole: 'run',
  ports: ({ path }) => {
    const start = path[0]
    const end = path.at(-1)
    return start && end && path.length > 1 ? [water('start', start), water('end', end)] : []
  },
}
const benchDef: NodeDefinition<typeof Bench> = {
  kind: 'fixture:bench',
  schemaVersion: 1,
  schema: Bench,
  category: 'furnish',
  defaults: () => ({ ...base, seatHeight: 0.45, children: [] }),
  capabilities: { surfaces: { top: { height: (node) => Bench.parse(node).seatHeight } } },
  relations: { hosts: ['fixture:sprout'], cascadeDelete: 'descendants' },
  renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
}
const sproutDef: NodeDefinition<typeof Sprout> = {
  kind: 'fixture:sprout',
  schemaVersion: 1,
  schema: Sprout,
  category: 'furnish',
  defaults: () => base,
  capabilities: {},
  geometry: () => new Group(),
}
const markerDef: NodeDefinition<typeof Marker> = {
  kind: 'fixture:marker',
  schemaVersion: 1,
  schema: Marker,
  category: 'utility',
  defaults: () => ({ ...base, targetIds: [] }),
  capabilities: {},
}

const fixturePlugin = (): Plugin => ({
  id: 'fixture:pack',
  apiVersion: 1,
  nodes: [
    asPluginNode(planterDef),
    asPluginNode(pumpDef),
    asPluginNode(pipeDef),
    asPluginNode(benchDef),
    asPluginNode(sproutDef),
    asPluginNode(markerDef),
  ],
})

const at = (x: number, z: number): [number, number, number] => [x, 0, z]
const ofType = (nodes: Record<string, AnyNode>, type: string) => {
  const found = Object.values(nodes).find((node) => node.type === type)
  if (!found) throw new Error(`no ${type} node`)
  return found
}

function loadLevel(nodes: AnyNode[], installedPlugins?: string[]) {
  const level = LevelNode.parse({ children: nodes.map((node) => node.id) })
  const levelNode = asSceneNode(level)
  const record: Record<string, AnyNode> = { [levelNode.id]: levelNode }
  for (const node of nodes) record[node.id] = { ...node, parentId: levelNode.id }
  useScene
    .getState()
    .setScene(
      record,
      [levelNode.id],
      installedPlugins && { installedPlugins, hasExplicitPluginInstallState: true },
    )
  return levelNode
}

function saved(): Required<Pick<SceneGraph, 'nodes' | 'rootNodeIds' | 'installedPlugins'>> {
  const { nodes, rootNodeIds, installedPlugins } = useScene.getState()
  return structuredClone({ nodes, rootNodeIds, installedPlugins })
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
    await loadPlugin({
      id: 'fixture:min',
      apiVersion: 1,
      nodes: [asPluginNode({ ...markerDef, kind: 'fixture:min' })],
    })
    const minimal = nodeRegistry.get('fixture:min')

    expect(isRegistrySelectable('fixture:min')).toBe(false)
    expect(isRegistryMovable('fixture:min')).toBe(false)
    expect(isSelectionHighlightEnabled('fixture:min')).toBe(true)
    expect(minimal && isPresettable(minimal)).toBe(false)
    expect(bakePolicyOf('fixture:min')).toBe('static')
    expect(kindsWithFloorplanScope('level')).toEqual(['fixture:min'])
    expect(minimal && rendersHostedChildren(minimal)).toBe(false)
  })
})

describe('plugin API v1: ports, surfaces and relations', () => {
  test('plugin ports join the system graph and port connectivity', async () => {
    await loadPlugin(fixturePlugin())
    const pump = asSceneNode(Pump.parse({}))
    const pipe = Pipe.parse({ path: [at(0.5, 0), at(3, 0)] })
    const pipeNode = asSceneNode(pipe)
    const stray = asSceneNode(Pipe.parse({ path: [at(9, 9), at(12, 9)] }))
    loadLevel([pump, pipeNode, stray])
    const nodes = useScene.getState().nodes

    const components = buildPortComponents(nodes).map((ids) => [...ids].sort())
    expect(components).toContainEqual([pipeNode.id, pump.id].sort())
    expect(components).toContainEqual([stray.id])
    expect(analyzePortConnectivity(pump, nodes).connections).toEqual([
      { kind: 'run', nodeId: pipeNode.id, startPath: pipe.path },
    ])
  })

  test('a plugin host publishes its top surface and accepts a plugin child', async () => {
    await loadPlugin(fixturePlugin())
    const bench = asSceneNode(Bench.parse({ seatHeight: 0.5 }))

    expect(getTopSurfaceHeight(bench)).toBe(0.5)
    expect(canHostSurfaceChild(bench, 'fixture:sprout')).toBe(true)
  })

  test('relations cascade dirty marks and deletion through a plugin host', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = asSceneNode(Sprout.parse({}))
    const bench = asSceneNode(Bench.parse({ children: [sprout.id] }))
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
  test('creating, updating and deleting a plugin node each undo and redo in one step', async () => {
    await loadPlugin(fixturePlugin())
    const level = loadLevel([], ['fixture:pack'])
    const planter = asSceneNode(Planter.parse({}))
    const { temporal } = useScene
    temporal.getState().clear()
    const children = (): string[] => {
      const current = useScene.getState().nodes[level.id]
      return current?.type === 'level' ? current.children : []
    }
    const size = () => {
      const current = useScene.getState().nodes[planter.id]
      return current && Planter.parse(current).size
    }

    useScene.getState().createNode(planter, level.id)
    expect(children()).toEqual([planter.id])
    expect(useScene.getState().dirtyNodes.has(planter.id)).toBe(true)
    temporal.getState().undo()
    expect(useScene.getState().nodes[planter.id]).toBeUndefined()
    expect(children()).toEqual([])
    temporal.getState().redo()
    expect(children()).toEqual([planter.id])

    useScene.getState().updateNode(planter.id, asScenePatch(Planter, { size: [2, 1, 2] }))
    expect(size()).toEqual([2, 1, 2])
    temporal.getState().undo()
    expect(size()).toEqual([1.2, 0.6, 0.5])

    useScene.getState().deleteNode(planter.id)
    expect(children()).toEqual([])
    temporal.getState().undo()
    expect(children()).toEqual([planter.id])
    expect(size()).toEqual([1.2, 0.6, 0.5])
  })

  test('save, validate and reload in a fresh registry keep plugin nodes and installs', async () => {
    await loadPlugin(fixturePlugin())
    loadLevel([asSceneNode(Planter.parse({ size: [1, 2, 3] }))], ['fixture:pack'])
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
    expect(nodeRegistry.get('fixture:planter')?.schema.parse(planter)).toEqual(planter)
  })

  test('a scene loaded before its plugin registers keeps build work for the late registration', async () => {
    const planter = asSceneNode(Planter.parse({}))
    loadLevel([planter], ['fixture:pack'])

    await loadPlugin(fixturePlugin())

    expect(isNodeKindEnabled('fixture:planter', useScene.getState().installedPlugins)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(planter.id)).toBe(true)
  })

  test('duplicate and project clone mint prefixed ids, rewire children and keep installs', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = asSceneNode(Sprout.parse({}))
    const bench = asSceneNode(Bench.parse({ children: [sprout.id] }))

    const duplicate = cloneNodesInto([bench, { ...sprout, parentId: bench.id }], {
      rootId: bench.id,
    })
    const [root, child] = duplicate.nodes
    expect([root?.id, child?.id]).toEqual([
      expect.stringMatching(/^fxbench_/),
      expect.stringMatching(/^fxsprout_/),
    ])
    expect(root && Bench.parse(root).children).toEqual([String(child?.id)])
    expect(child?.parentId).toBe(root?.id)

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
    const planter = asSceneNode(Planter.parse({}))
    loadLevel([planter, asSceneNode(Marker.parse({ targetIds: [planter.id] }))])

    const { nodes } = cloneSceneGraph(saved())
    expect(Marker.parse(ofType(nodes, 'fixture:marker')).targetIds).toEqual([
      ofType(nodes, 'fixture:planter').id,
    ])
  })

  test.failing('subtree duplicate remaps plugin-owned node references', async () => {
    await loadPlugin(fixturePlugin())
    const sprout = asSceneNode(Sprout.parse({}))
    const marker = asSceneNode(Marker.parse({ targetIds: [sprout.id] }))
    const bench = asSceneNode(Bench.parse({ children: [sprout.id, marker.id] }))

    const { nodes, idMap } = cloneNodesInto(
      [bench, { ...sprout, parentId: bench.id }, { ...marker, parentId: bench.id }],
      { rootId: bench.id },
    )
    const record = Object.fromEntries(nodes.map((node) => [node.id, node]))
    expect(Marker.parse(ofType(record, 'fixture:marker')).targetIds).toEqual([
      String(idMap.get(sprout.id)),
    ])
  })
})

describe('plugin API v1: no install', () => {
  // The store never infers legacy visibility: a host rendering a saved scene
  // (viewer, bake) must pass installedPlugins or every plugin kind is off.
  test('a host that omits install state disables plugin kinds; only a missing list is legacy', async () => {
    await loadPlugin(fixturePlugin())
    loadLevel([asSceneNode(Planter.parse({}))])

    expect(useScene.getState().hasExplicitPluginInstallState).toBe(false)
    expect(isNodeKindEnabled('fixture:planter', useScene.getState().installedPlugins)).toBe(false)
    expect(isNodeKindEnabled('fixture:planter')).toBe(true)
  })

  test('nodes of a plugin the host never loaded survive load, validation and save', () => {
    const planter = asSceneNode(Planter.parse({}))
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
