import type { McpServer } from '@modelcontextprotocol/server'
import { isScriptedNode, scriptedObjectMeta } from '@pascal-app/core'
import {
  type AddColumnInput,
  addColumn,
  columnScriptParams,
  editedScriptLanguage,
} from '@pascal-app/core/agent-operations'
import { addColumnTool, isAgentRefusal, refuse } from '@pascal-app/core/agent-tools'
import { type AnyNode, GeometryReuseFields, generateId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost, readScript } from './add-object'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { inScene } from './scene-scope'
import { toPatches } from './shared-tools'

export function registerAddColumn(
  server: McpServer,
  bridge: SceneOperations,
  host?: GeometryScriptHost,
) {
  server.registerTool(
    addColumnTool.name,
    {
      title: addColumnTool.title,
      description: addColumnTool.description,
      inputSchema: z.object(addColumnTool.input),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: AddColumnInput) => {
      try {
        const nodes = bridge.getNodes() as Record<string, AnyNode>
        const previous = input.nodeId ? nodes[input.nodeId] : undefined
        const params = columnScriptParams(previous?.type === 'column' ? previous : undefined, input)
        let compiled: AddColumnInput['compiled']
        if (params) {
          if (!host)
            refuse('scripts_unavailable', 'This Pascal server cannot run geometry scripts.')
          const scene = bridge.getActiveScene()
          if (!scene) refuse('no_active_scene', 'Open or save a scene first.')
          // A new column's id is the scene's, minted before anything is awaited.
          const nodeId = input.nodeId ?? inScene(bridge, () => generateId('column'))
          const language = editedScriptLanguage(previous, input)
          const code = input.code ?? (await readScript(host, scene.id, bridge, input.nodeId!))
          compiled = await compileAndStore(host, scene.id, { code, language, params }, 'column', {
            nodeId,
            metadata: {
              ...(isScriptedNode(previous) ? scriptedObjectMeta(previous) : {}),
              ...GeometryReuseFields.parse(input),
            },
          })
        }
        const outcome = inScene(bridge, () =>
          addColumn(
            nodes,
            { ...input, compiled },
            { activeLevelId: bridge.activeLevelId?.() ?? null },
          ),
        )
        if (outcome.changes) bridge.applyPatch(toPatches(outcome.changes))
        const payload = {
          ...outcome.result,
          ...persistencePayload(await publishLiveSceneSnapshot(bridge, addColumnTool.name)),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'script_failed',
        })
      }
    },
  )
}
