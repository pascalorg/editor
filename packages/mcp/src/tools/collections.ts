import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AgentOperationOutcome,
  type CollectionScene,
  type EditCollectionInput,
  editCollection,
  listCollections,
  writeCollections,
} from '@pascal-app/core/agent-operations'
import { editCollectionTool, listCollectionsTool } from '@pascal-app/core/agent-tools'
import type { AnyNodeId } from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'

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
      inputSchema: listCollectionsTool.input,
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
      inputSchema: editCollectionTool.input,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: EditCollectionInput) => {
      let outcome: AgentOperationOutcome
      try {
        outcome = editCollection(sceneOf(bridge), input)
      } catch (error) {
        return refusalResult(error)
      }
      const { update, collections = {} } = outcome.changes ?? {}
      bridge.runAsSingleHistoryStep(() => {
        if (update?.length)
          bridge.applyPatch(
            update.map(({ id, data }) => ({ op: 'update' as const, id: id as AnyNodeId, data })),
          )
        bridge.setCollections(writeCollections(bridge.getCollections(), collections))
      })
      return reply({
        ...outcome.result,
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, editCollectionTool.name)),
      })
    },
  )
}
