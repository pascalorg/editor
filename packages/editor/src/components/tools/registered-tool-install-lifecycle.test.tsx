import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  emitter,
  type GridEvent,
  loadPlugin,
  nodeRegistry,
  registerNode,
  type SceneApi,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { type ComponentType, useEffect } from 'react'
import { z } from 'zod'
import {
  FLOORPLAN_NODE_EXTENSION_KEY,
  type FloorplanToolContext,
} from '../../lib/floorplan/floorplan-extension'
import useEditor from '../../store/use-editor'
import useFloorplanMode from '../../store/use-floorplan-mode'
import useInteractionScope from '../../store/use-interaction-scope'
import { FloorplanRegisteredToolLayer } from '../editor-2d/floorplan-registered-tool-layer'
import { useRegistryToolContext } from './registry-tool-context'
import { ToolManager } from './tool-manager'

const PLUGIN_ID = 'test:registered-placement-plugin'
const PLUGIN_KIND = 'test:registered-placement'
const BUILTIN_KIND = 'test:builtin-placement'
const GRID_EVENT = {
  position: [1, 0, 2],
  localPosition: [1, 0, 2],
  nativeEvent: {} as GridEvent['nativeEvent'],
} satisfies GridEvent

type View = '2d' | '3d'
type Lifecycle = {
  mounts: Record<View, number>
  unmounts: Record<View, number>
}
type MountedHost = { unmount: () => Promise<void> }

const node = (id: string, type: string): AnyNode =>
  ({ id, type, object: 'node', parentId: null, visible: true, metadata: {} }) as AnyNode

function usePlacementGesture(sceneApi: SceneApi, kind: string, view: View, lifecycle: Lifecycle) {
  useEffect(() => {
    lifecycle.mounts[view] += 1
    const draft = node(`${kind}:${view}:pending`, kind)
    const begin = () => {
      useInteractionScope.getState().begin({
        kind: 'placing',
        node: draft,
        nodeId: draft.id,
        nodeType: draft.type,
        view,
        pressDrag: true,
        driver: 'registry-tool',
      })
    }
    const commit = () => {
      const scope = useInteractionScope.getState().scope
      if (scope.kind !== 'placing' || scope.nodeId !== draft.id) return
      sceneApi.upsert(draft)
      useInteractionScope
        .getState()
        .endIf((active) => active.kind === 'placing' && active.nodeId === draft.id)
    }
    emitter.on('grid:pointerdown', begin)
    emitter.on('grid:click', commit)
    return () => {
      emitter.off('grid:pointerdown', begin)
      emitter.off('grid:click', commit)
      useInteractionScope
        .getState()
        .endIf((active) => active.kind === 'placing' && active.nodeId === draft.id)
      lifecycle.unmounts[view] += 1
    }
  }, [kind, lifecycle, sceneApi, view])
}

function definition(kind: string, lifecycle: Lifecycle): AnyNodeDefinition {
  const Tool3D = () => {
    usePlacementGesture(useRegistryToolContext().sceneApi, kind, '3d', lifecycle)
    return null
  }
  const Tool2D = ({ sceneApi }: FloorplanToolContext) => {
    usePlacementGesture(sceneApi, kind, '2d', lifecycle)
    return null
  }
  const load3D = async () => ({ default: Tool3D as ComponentType })
  const load2D = async () => ({ default: Tool2D as ComponentType<FloorplanToolContext> })

  return {
    kind,
    schemaVersion: 1,
    schema: z
      .object({
        id: z.string(),
        type: z.literal(kind),
        object: z.literal('node'),
        parentId: z.string().nullable(),
        visible: z.boolean(),
        metadata: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
    category: 'utility',
    defaults: () => ({}),
    capabilities: {},
    tool: load3D,
    extensions: {
      [FLOORPLAN_NODE_EXTENSION_KEY]: { tool: load2D },
    },
  } as AnyNodeDefinition
}

const hosts: Array<{ name: string; view: View; component: ComponentType }> = [
  { name: '3D ToolManager', view: '3d', component: ToolManager },
  { name: '2D FloorplanRegisteredToolLayer', view: '2d', component: FloorplanRegisteredToolLayer },
]

for (const host of hosts) {
  test(`${host.name} cancels an uninstalled registered placement tool and requires explicit reactivation`, async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    const previousScene = useScene.getState()
    const previousHistory = useScene.temporal.getState()
    const previousEditor = useEditor.getState()
    const previousViewer = useViewer.getState()
    const previousFloorplanMode = useFloorplanMode.getState()
    const previousInteraction = useInteractionScope.getState()
    const lifecycle: Lifecycle = {
      mounts: { '2d': 0, '3d': 0 },
      unmounts: { '2d': 0, '3d': 0 },
    }
    const persisted = node('test:registered-placement:persisted', PLUGIN_KIND)
    const persistedExpected = node('test:registered-placement:persisted', PLUGIN_KIND)
    const pluginPendingId = node(`${PLUGIN_KIND}:${host.view}:pending`, PLUGIN_KIND).id
    const builtinPendingId = node(`${BUILTIN_KIND}:${host.view}:pending`, BUILTIN_KIND).id
    let renderer: MountedHost | undefined

    try {
      nodeRegistry._reset()
      await loadPlugin({
        id: PLUGIN_ID,
        apiVersion: 1,
        nodes: [definition(PLUGIN_KIND, lifecycle)],
      })
      registerNode(definition(BUILTIN_KIND, lifecycle))
      useScene.setState({
        nodes: { [persisted.id]: persisted },
        rootNodeIds: [persisted.id],
        installedPlugins: [PLUGIN_ID],
        hasExplicitPluginInstallState: true,
        readOnly: false,
      } as never)
      useViewer.setState({
        selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      } as never)
      useFloorplanMode.setState({ mode: 'default' })
      useInteractionScope.getState().end()
      useEditor.getState().armToolMode({ mode: 'build', tool: PLUGIN_KIND as never })

      const Host = host.component
      renderer = await create(<Host />)
      expect(lifecycle.mounts[host.view]).toBeGreaterThan(0)
      const pluginMountsWhileInstalled = lifecycle.mounts[host.view]

      await act(async () => {
        emitter.emit('grid:pointerdown', GRID_EVENT)
      })
      expect(useInteractionScope.getState().scope).toMatchObject({
        kind: 'placing',
        nodeType: PLUGIN_KIND,
        view: host.view,
      })
      const pluginUnmountsBeforeRemoval = lifecycle.unmounts[host.view]

      await act(async () => {
        useScene.getState().setInstalledPlugins([], { explicit: true })
      })
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(lifecycle.unmounts[host.view]).toBeGreaterThan(pluginUnmountsBeforeRemoval)
      expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
      expect(useScene.getState().nodes[persisted.id]).toEqual(persistedExpected)
      expect(useScene.getState().rootNodeIds).toEqual([persisted.id])

      await act(async () => {
        emitter.emit('grid:click', GRID_EVENT)
      })
      expect(useScene.getState().nodes[pluginPendingId]).toBeUndefined()

      await act(async () => {
        useScene.getState().setInstalledPlugins([PLUGIN_ID], { explicit: true })
      })
      expect(lifecycle.mounts[host.view]).toBe(pluginMountsWhileInstalled)
      expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
      expect(useScene.getState().nodes[persisted.id]).toEqual(persistedExpected)
      expect(useScene.getState().rootNodeIds).toEqual([persisted.id])

      await act(async () => {
        useEditor.getState().armToolMode({ mode: 'build', tool: PLUGIN_KIND as never })
      })
      expect(lifecycle.mounts[host.view]).toBeGreaterThan(pluginMountsWhileInstalled)
      const pluginMountsAfterReactivation = lifecycle.mounts[host.view]
      await act(async () => {
        emitter.emit('grid:pointerdown', GRID_EVENT)
        emitter.emit('grid:click', GRID_EVENT)
      })
      expect(useScene.getState().nodes[pluginPendingId]).toMatchObject({
        type: PLUGIN_KIND,
      })

      await act(async () => {
        useEditor.getState().armToolMode({ mode: 'build', tool: BUILTIN_KIND as never })
      })
      expect(lifecycle.mounts[host.view]).toBeGreaterThan(pluginMountsAfterReactivation)
      const builtinMountsBeforeUninstall = lifecycle.mounts[host.view]
      await act(async () => {
        emitter.emit('grid:pointerdown', GRID_EVENT)
      })
      expect(useInteractionScope.getState().scope).toMatchObject({
        kind: 'placing',
        nodeType: BUILTIN_KIND,
        view: host.view,
      })

      await act(async () => {
        useScene.getState().setInstalledPlugins([], { explicit: true })
      })
      expect(useInteractionScope.getState().scope).toMatchObject({
        kind: 'placing',
        nodeType: BUILTIN_KIND,
        view: host.view,
      })
      expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: BUILTIN_KIND })
      expect(lifecycle.mounts[host.view]).toBe(builtinMountsBeforeUninstall)

      await act(async () => {
        emitter.emit('grid:click', GRID_EVENT)
      })
      expect(useScene.getState().nodes[builtinPendingId]).toMatchObject({
        type: BUILTIN_KIND,
      })
    } finally {
      await renderer?.unmount()
      useInteractionScope.setState(previousInteraction, true)
      useFloorplanMode.setState(previousFloorplanMode, true)
      useViewer.setState(previousViewer, true)
      useScene.setState(previousScene, true)
      useScene.temporal.setState(previousHistory, true)
      useEditor.setState(previousEditor, true)
      restoreRegistry()
    }
  })
}
