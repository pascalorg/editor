import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BaseNode,
  LevelNode,
  loadPlugin,
  type NodeDefinition,
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
const Lamp = BaseNode.extend({ id: objectId('fxlamp'), type: nodeType('fixture:lamp') })
const Planter = BaseNode.extend({ id: objectId('fxplanter'), type: nodeType('fixture:planter') })
const Overlay = BaseNode.extend({ id: objectId('fxoverlay'), type: nodeType('fixture:overlay') })
const Meadow = BaseNode.extend({ id: objectId('fxmeadow'), type: nodeType('fixture:meadow') })

// The only casts: API v1 cannot type these boundaries (typed definitions do not
// widen to `AnyNodeDefinition`; plugin nodes are outside the `AnyNode` union).
const asPluginNode = <S extends AnyNodeDefinition['schema']>(def: NodeDefinition<S>) =>
  def as unknown as AnyNodeDefinition
const asSceneNode = (node: { id: string; type: string }) => node as unknown as AnyNode

const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const
let systemTicks = 0

function LampSystem({ sceneApi }: { sceneApi: { get: unknown } }) {
  useFrame(() => {
    if (typeof sceneApi.get === 'function') systemTicks += 1
  })
  return null
}

function tagged(tag: string) {
  return {
    kind: 'parametric',
    module: async () => ({
      default: ({ node }: { node: { id: string } }) => <group name={`${tag}:${node.id}`} />,
    }),
  } as const
}

const lampDef: NodeDefinition<typeof Lamp> = {
  kind: 'fixture:lamp',
  schemaVersion: 1,
  schema: Lamp,
  category: 'furnish',
  defaults: () => base,
  capabilities: {},
  renderer: tagged('lamp'),
  system: { module: async () => ({ default: LampSystem }) },
}
const planterDef: NodeDefinition<typeof Planter> = {
  kind: 'fixture:planter',
  schemaVersion: 1,
  schema: Planter,
  category: 'furnish',
  defaults: () => base,
  capabilities: {},
  geometry: () => new Group().add(Object.assign(new Mesh(), { name: 'planter-body' })),
}
const overlayDef: NodeDefinition<typeof Overlay> = {
  kind: 'fixture:overlay',
  schemaVersion: 1,
  schema: Overlay,
  category: 'furnish',
  defaults: () => base,
  capabilities: {},
  bake: 'strip',
  renderer: tagged('overlay'),
}
const meadowDef: NodeDefinition<typeof Meadow> = {
  kind: 'fixture:meadow',
  schemaVersion: 1,
  schema: Meadow,
  category: 'furnish',
  defaults: () => base,
  capabilities: {},
  bake: 'replace',
  bakeReplaceRenderer: {
    module: async () => ({
      default: ({ nodes }: { nodes: { id: string }[] }) => (
        <group name={`meadow:${nodes.map((node) => node.id).join(',')}`} />
      ),
    }),
  },
}

const dispatchPlugin = (): Plugin => ({
  id: PLUGIN_ID,
  apiVersion: 1,
  nodes: [
    asPluginNode(lampDef),
    asPluginNode(planterDef),
    asPluginNode(overlayDef),
    asPluginNode(meadowDef),
  ],
})

function scene(installedPlugins: string[]) {
  const lamp = asSceneNode(Lamp.parse({}))
  const planter = asSceneNode(Planter.parse({}))
  const overlay = asSceneNode(Overlay.parse({}))
  const meadow = asSceneNode(Meadow.parse({}))
  const children = [lamp, planter, overlay, meadow]
  const level = asSceneNode(LevelNode.parse({ children: children.map((node) => node.id) }))
  const nodes: Record<string, AnyNode> = { [level.id]: level }
  for (const node of children) nodes[node.id] = { ...node, parentId: level.id }
  useScene.getState().setScene(nodes, [level.id], {
    installedPlugins,
    hasExplicitPluginInstallState: true,
  })
  const graph: SceneGraph = { nodes, rootNodeIds: [level.id], installedPlugins }
  return { level, lamp, planter, overlay, meadow, graph }
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

function mountDispatch(lamp: AnyNode, planter: AnyNode) {
  return create(
    <>
      <NodeRenderer nodeId={lamp.id} />
      <NodeRenderer nodeId={planter.id} />
      <GeometrySystem />
      <RegisteredSystems />
    </>,
  )
}

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
  const renderer = await mountDispatch(lamp, planter)
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
    expect(useScene.getState().dirtyNodes.has(planter.id)).toBe(false)
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

// Known gap: NodeRenderer reads the registry at render time without
// subscribing to it, so nodes mounted before async plugin discovery stay
// invisible (and their geometry unbuilt) until something else re-renders them.
test.failing('nodes mounted before their plugin registers render once it registers', async () => {
  nodeRegistry._reset()
  const { lamp, planter } = scene([PLUGIN_ID])
  const renderer = await mountDispatch(lamp, planter)
  try {
    await settle(renderer)

    await act(async () => {
      await loadPlugin(dispatchPlugin())
    })
    await settle(renderer)

    expect(named(renderer, `lamp:${lamp.id}`)).toBe(1)
    expect(sceneRegistry.nodes.get(planter.id)?.getObjectByName('planter-body')).toBeDefined()
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
