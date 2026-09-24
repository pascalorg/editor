import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  nodeType,
  objectId,
  type Plugin,
  type SceneGraph,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Group, Mesh } from 'three'
import { GeometrySystem } from '../../systems/geometry/geometry-system'
import { NodeRenderer } from '../renderers/node-renderer'
import {
  buildGlbReferenceNodes,
  buildGlbReplaceNodes,
  GlbReferenceNodes,
} from './glb-reference-nodes'
import { GlbReplaceInstances } from './glb-replace-instances'
import { RegisteredSystems } from './registered-systems'

// Plugin API v1 at dispatch: a synthetic plugin kind reaches the scene through
// the registry-driven renderer, geometry and system mounts and the baked
// viewer's strip/replace restore — only while the project has it installed.

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const PLUGIN_ID = 'fixture:dispatch'
const schemaFor = (prefix: string, type: string) =>
  BaseNode.extend({ id: objectId(prefix), type: nodeType(type) })
const Lamp = schemaFor('fxlamp', 'fixture:lamp')
const Planter = schemaFor('fxplanter', 'fixture:planter')
const Overlay = schemaFor('fxoverlay', 'fixture:overlay')
const Meadow = schemaFor('fxmeadow', 'fixture:meadow')

let systemTicks = 0

function LampSystem({ sceneApi }: { sceneApi: { get?: unknown } }) {
  useFrame(() => {
    if (typeof sceneApi.get === 'function') systemTicks += 1
  })
  return null
}

const tagged = (tag: string) => ({
  kind: 'parametric' as const,
  module: async () => ({
    default: ({ node }: { node: Record<string, unknown> }) => (
      <group name={`${tag}:${String(node.id)}`} />
    ),
  }),
})

const def = (kind: string, schema: AnyNodeDefinition['schema'], fields: object) =>
  ({
    kind,
    schemaVersion: 1,
    schema,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    ...fields,
  }) as AnyNodeDefinition

const dispatchPlugin = (): Plugin => ({
  id: PLUGIN_ID,
  apiVersion: 1,
  nodes: [
    def('fixture:lamp', Lamp, {
      renderer: tagged('lamp'),
      system: { module: async () => ({ default: LampSystem }) },
    }),
    def('fixture:planter', Planter, {
      geometry: () => new Group().add(Object.assign(new Mesh(), { name: 'planter-body' })),
    }),
    def('fixture:overlay', Overlay, { bake: 'strip', renderer: tagged('overlay') }),
    def('fixture:meadow', Meadow, {
      bake: 'replace',
      bakeReplaceRenderer: {
        module: async () => ({
          default: ({ nodes }: { nodes: Record<string, unknown>[] }) => (
            <group name={`meadow:${nodes.map((node) => String(node.id)).join(',')}`} />
          ),
        }),
      },
    }),
  ],
})

function scene(installedPlugins: string[]) {
  const [lamp, planter, overlay, meadow] = [Lamp, Planter, Overlay, Meadow].map((s) => s.parse({}))
  const children = [lamp!, planter!, overlay!, meadow!]
  const level = LevelNode.parse({ children: children.map((node) => node.id) })
  const nodes = Object.fromEntries([
    [level.id, level],
    ...children.map((node) => [node.id, { ...node, parentId: level.id }]),
  ]) as Record<AnyNodeId, AnyNode>
  useScene.getState().setScene(nodes, [level.id as AnyNodeId], {
    installedPlugins,
    hasExplicitPluginInstallState: true,
  })
  const graph: SceneGraph = { nodes, rootNodeIds: [level.id as AnyNodeId], installedPlugins }
  return { level, lamp: lamp!, planter: planter!, overlay: overlay!, meadow: meadow!, graph }
}

type Renderer = Awaited<ReturnType<typeof create>>

async function settle(renderer: Renderer, frames = 3) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  if (frames > 0) await renderer.advanceFrames(frames, 1 / 60)
}

const named = (renderer: Renderer, name: string) =>
  renderer.scene.findAll((instance) => instance.props.name === name).length

let restoreRegistry: () => void
const previousScene = useScene.getState()

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin(dispatchPlugin())
  systemTicks = 0
})

afterEach(() => {
  restoreRegistry()
  useScene.setState(previousScene)
  sceneRegistry.clear()
})

test('renderer, geometry and system dispatch start only when the plugin is installed', async () => {
  const { lamp, planter } = scene([])
  const renderer = await create(
    <>
      <NodeRenderer nodeId={lamp.id as AnyNodeId} />
      <NodeRenderer nodeId={planter.id as AnyNodeId} />
      <GeometrySystem />
      <RegisteredSystems />
    </>,
  )
  try {
    await settle(renderer)
    expect(named(renderer, `lamp:${lamp.id}`)).toBe(0)
    expect(sceneRegistry.nodes.get(planter.id)).toBeUndefined()
    expect(systemTicks).toBe(0)

    await act(async () => {
      useScene.getState().setInstalledPlugins([PLUGIN_ID], { explicit: true })
    })
    await settle(renderer)

    expect(named(renderer, `lamp:${lamp.id}`)).toBe(1)
    expect(sceneRegistry.nodes.get(planter.id)?.getObjectByName('planter-body')).toBeDefined()
    expect(useScene.getState().dirtyNodes.has(planter.id as AnyNodeId)).toBe(false)
    expect(systemTicks).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('a plugin that registers after the systems mounted still gets its system', async () => {
  nodeRegistry._reset()
  scene([PLUGIN_ID])
  const renderer = await create(<RegisteredSystems />)
  try {
    await settle(renderer, 2)
    expect(systemTicks).toBe(0)

    await act(async () => {
      await loadPlugin(dispatchPlugin())
    })
    await settle(renderer, 2)

    expect(systemTicks).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('the baked viewer restores strip nodes and mounts the replace renderer only when installed', async () => {
  expect(buildGlbReferenceNodes(scene([]).graph, { scans: true, guides: true })).toEqual([])
  expect(buildGlbReplaceNodes(scene([]).graph)).toEqual([])

  const { level, overlay, meadow, graph } = scene([PLUGIN_ID])
  const referenceNodes = buildGlbReferenceNodes(graph, { scans: true, guides: true })
  const replaceNodes = buildGlbReplaceNodes(graph)
  const bakedLevel = new Group()
  const identity = new Map([[level.id, bakedLevel]])
  const renderer = await create(
    <>
      <primitive object={bakedLevel} />
      <GlbReferenceNodes identity={identity} nodes={referenceNodes} />
      <GlbReplaceInstances identity={identity} nodes={replaceNodes} />
    </>,
  )
  try {
    await settle(renderer, 0)

    expect(bakedLevel.getObjectByName(`overlay:${overlay.id}`)).toBeDefined()
    expect(bakedLevel.getObjectByName(`meadow:${meadow.id}`)).toBeDefined()
  } finally {
    await renderer.unmount()
  }
})
