import type { McpServer } from '@modelcontextprotocol/server'
import {
  type AgentOperationOutcome,
  type CollectionScene,
  type EditCollectionInput,
  editCollection,
  listCollections,
  writeCollections,
} from '@pascal-app/core/agent-operations'
import { editCollectionTool, listCollectionsTool } from '@pascal-app/core/agent-tools'
import { untracked } from '@pascal-app/core/runtime'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { inScene } from './scene-scope'

// The collection tools share contracts and operations with the chat; they read the scene's
// collections beside its nodes, which the node-only shared operations never see.

function sceneOf(bridge: SceneOperations): CollectionScene {
  return { nodes: bridge.getNodes(), collections: bridge.getCollections() }
}

function reply(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

export function registerCollectionTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    listCollectionsTool.name,
    {
      title: listCollectionsTool.title,
      description: listCollectionsTool.description,
      inputSchema: z.object(listCollectionsTool.input),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (input: { collectionId?: string }) => {
      try {
        return reply(listCollections(sceneOf(bridge), input).result)
      } catch (error) {
        return refusalResult(error)
      }
    },
  )

  server.registerTool(
    editCollectionTool.name,
    {
      title: editCollectionTool.title,
      description: editCollectionTool.description,
      inputSchema: z.object(editCollectionTool.input),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: EditCollectionInput) => {
      let outcome: AgentOperationOutcome
      try {
        outcome = inScene(bridge, () => editCollection(sceneOf(bridge), input))
      } catch (error) {
        return refusalResult(error)
      }
      const { update, collections = {} } = outcome.changes ?? {}
      bridge.runAsSingleHistoryStep(() => {
        if (update?.length)
          bridge.applyPatch(
            update.map(({ id, data }) => ({ op: 'update' as const, id: id as AnyNodeId, data })),
          )
        // Writing the other collections back is a copy, not a read of them.
        bridge.setCollections(writeCollections(untracked(bridge.getCollections()), collections))
      })
      return reply({
        ...outcome.result,
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, editCollectionTool.name)),
      })
    },
  )
}
