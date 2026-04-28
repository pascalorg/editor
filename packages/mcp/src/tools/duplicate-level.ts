import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { cloneLevelSubtree } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch as BridgePatch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

export const duplicateLevelInput = {
  levelId: NodeIdSchema,
}

export const duplicateLevelOutput = {
  newLevelId: z.string(),
  newNodeIds: z.array(z.string()),
}

export function registerDuplicateLevel(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'duplicate_level',
    {
      title: 'Duplicate level',
      description:
        'Clone a level and all its descendants into a new subtree attached to the same building.',
      inputSchema: duplicateLevelInput,
      outputSchema: duplicateLevelOutput,
    },
    async ({ levelId }) => {
      const node = bridge.getNode(levelId as AnyNodeId)
      if (!node) {
        throwMcpError(ErrorCode.InvalidParams, `Level not found: ${levelId}`)
      }
      if (node.type !== 'level') {
        throwMcpError(ErrorCode.InvalidParams, `Node ${levelId} is a ${node.type}, expected level`)
      }

      // cloneLevelSubtree(nodes, levelId) — returns { clonedNodes, newLevelId, idMap }.
      const { clonedNodes, newLevelId } = cloneLevelSubtree(bridge.getNodes(), levelId as AnyNodeId)

      const buildingId = (node.parentId as AnyNodeId | null) ?? undefined

      // Flatten cloned subtree into create patches. The level node itself
      // attaches to the original building; descendants attach to their
      // already-remapped parent (encoded in `parentId`).
      const patches: BridgePatch[] = clonedNodes.map((n) => {
        const isRoot = (n.id as AnyNodeId) === newLevelId
        const parentIdForBridge = isRoot
          ? buildingId
          : ((n.parentId as AnyNodeId | null) ?? undefined)

        const createOp: BridgePatch = {
          op: 'create',
          node: n as AnyNode,
          ...(parentIdForBridge !== undefined ? { parentId: parentIdForBridge } : {}),
        }
        return createOp
      })

      const result = bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'duplicate_level')

      const payload = {
        newLevelId: newLevelId as string,
        newNodeIds: result.createdIds as unknown as string[],
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
