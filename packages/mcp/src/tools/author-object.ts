import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AuthorObjectInput, authorObject } from '@pascal-app/core/agent-operations'
import { authorObjectTool } from '@pascal-app/core/agent-tools'
import type {
  AnyNode,
  CompiledGeometryScript,
  GeometryScriptParamValue,
} from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { toPatches } from './shared-tools'

/**
 * How a host runs `author_object`'s module and keeps the result. Running
 * model-written code is the host's call: it decides the isolation, and where
 * artifacts live for the active scene.
 */
export type GeometryScriptHost = {
  compile(input: {
    code: string
    params?: Record<string, GeometryScriptParamValue>
  }): Promise<CompiledGeometryScript & { glb: Uint8Array }>
  storeArtifact(input: {
    sceneId: string
    sha256: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<void>
}

/** `author_object` on the MCP: the shared contract and operation, with the host's compile in front. */
export function registerAuthorObject(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
): void {
  server.registerTool(
    authorObjectTool.name,
    {
      title: authorObjectTool.title,
      description: authorObjectTool.description,
      inputSchema: authorObjectTool.input,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: Record<string, unknown>) => {
      if (!host) {
        return toolError('This Pascal server cannot run geometry scripts.', {
          code: 'scripts_unavailable',
        })
      }
      const scene = bridge.getActiveScene()
      if (!scene) {
        return toolError('Open or save a scene first: authored objects are stored with a scene.', {
          code: 'no_active_scene',
        })
      }
      const args = input as Omit<AuthorObjectInput, 'compiled'>
      let compiled: CompiledGeometryScript
      try {
        const { glb, ...rest } = await host.compile({ code: args.code, params: args.params })
        await host.storeArtifact({
          sceneId: scene.id,
          sha256: rest.sha256,
          bytes: glb,
          mimeType: 'model/gltf-binary',
        })
        compiled = rest
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'script_failed',
        })
      }
      let outcome: ReturnType<typeof authorObject>
      try {
        outcome = authorObject(
          bridge.getNodes() as Record<string, AnyNode>,
          { ...args, compiled },
          { activeLevelId: null },
        )
      } catch (error) {
        return refusalResult(error)
      }
      const patches = outcome.changes ? toPatches(outcome.changes) : []
      if (patches.length) bridge.applyPatch(patches)
      const payload = {
        ...outcome.result,
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, authorObjectTool.name)),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
