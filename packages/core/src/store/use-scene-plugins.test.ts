import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { loadPlugin, nodeRegistry } from '../registry'
import type { AnyNodeDefinition } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema'
import { type SceneCommit, subscribeSceneCommits } from './history-control'
import useScene, { applySceneOperationPatch, applySceneSnapshot } from './use-scene'

describe('scene plugin installation state', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    useScene.getState().setReadOnly(false)
    useScene.getState().unloadScene()
  })

  test('loads an explicit installed plugin list with the scene', () => {
    useScene.getState().setScene({}, [], {
      installedPlugins: ['pascal:trees'],
      hasExplicitPluginInstallState: true,
    })

    expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
    expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)
  })

  test('install changes are de-duplicated and become explicit', () => {
    useScene.getState().setInstalledPlugins(['pascal:trees', 'pascal:trees'], { explicit: true })

    expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
    expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)
  })

  test('clearing geometry preserves project plugin installs', () => {
    useScene.getState().setInstalledPlugins(['pascal:trees'], { explicit: true })
    useScene.getState().clearScene()

    expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
    expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)
  })

  test('uninstall clears plugin build work and reinstall schedules it again', async () => {
    const kind = 'test:plugin-node'
    const definition = {
      kind,
      schemaVersion: 1,
      schema: z.object({ id: z.string(), type: z.literal(kind) }),
      category: 'utility',
      defaults: () => ({}),
      capabilities: {},
    } as unknown as AnyNodeDefinition
    await loadPlugin({ id: 'test:plugin', apiVersion: 1, nodes: [definition] })
    const nodeId = 'plugin_node' as AnyNodeId
    useScene.getState().setScene(
      {
        [nodeId]: { id: nodeId, type: kind } as unknown as AnyNode,
      },
      [nodeId],
      { installedPlugins: ['test:plugin'], hasExplicitPluginInstallState: true },
    )

    expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(true)

    useScene.getState().setInstalledPlugins([], { explicit: true })
    expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(false)

    useScene.getState().setInstalledPlugins(['test:plugin'], { explicit: true })
    expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(true)
  })

  test('a host patch installs and uninstalls plugins as explicit shared state', async () => {
    const kind = 'test:shared-plugin-node'
    const definition = {
      kind,
      schemaVersion: 1,
      schema: z.object({ id: z.string(), type: z.literal(kind) }),
      category: 'utility',
      defaults: () => ({}),
      capabilities: {},
    } as unknown as AnyNodeDefinition
    await loadPlugin({ id: 'test:shared', apiVersion: 1, nodes: [definition] })
    const nodeId = 'shared_plugin_node' as AnyNodeId
    useScene
      .getState()
      .setScene({ [nodeId]: { id: nodeId, type: kind } as unknown as AnyNode }, [nodeId], {
        installedPlugins: ['pascal:trees'],
      })
    expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(false)
    useScene.temporal.getState().clear()
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    const patch = { materialChanges: [], nodeUpdates: [], nodeCreates: [], nodeDeletes: [] }

    try {
      expect(
        applySceneOperationPatch({
          ...patch,
          pluginChanges: [{ id: 'test:shared', installed: true }],
        }),
      ).toBe(true)
      expect(useScene.getState().installedPlugins).toEqual(['pascal:trees', 'test:shared'])
      expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)
      expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)

      expect(
        applySceneOperationPatch({
          ...patch,
          pluginChanges: [{ id: 'test:shared', installed: false }],
        }),
      ).toBe(true)
      expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
      expect(useScene.getState().dirtyNodes.has(nodeId)).toBe(false)
      expect(commits.map((commit) => commit.origin)).toEqual(['host', 'host'])

      expect(
        applySceneOperationPatch({
          ...patch,
          pluginChanges: [
            { id: 'test:shared', installed: true },
            { id: 'test:shared', installed: false },
          ],
        }),
      ).toBe(false)
      expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
    } finally {
      unsubscribe()
    }
  })

  test('a snapshot can carry an explicit plugin install state', () => {
    const snapshot = {
      nodes: {},
      rootNodeIds: [],
      collections: {},
      materials: {},
      installedPlugins: ['pascal:trees'],
    }
    applySceneSnapshot(snapshot, { origin: 'host', explicitPluginInstallState: true })
    expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)

    applySceneSnapshot({ ...snapshot, installedPlugins: [] }, { origin: 'host' })
    expect(useScene.getState().hasExplicitPluginInstallState).toBe(false)
  })
})
