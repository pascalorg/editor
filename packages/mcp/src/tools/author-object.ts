import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AuthorObjectInput,
  authoredObject,
  authorObject,
  readSourceResult,
} from '@pascal-app/core/agent-operations'
import {
  authorObjectTool,
  isAgentRefusal,
  readSourceTool,
  refuse,
} from '@pascal-app/core/agent-tools'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPE,
  type GeometryScriptParamValue,
} from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
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
  /** A stored artifact's bytes (an object's script), or null when missing; only for principals who may edit the scene. */
  readArtifact(input: { sceneId: string; sha256: string }): Promise<Uint8Array | null>
}

async function readScript(
  host: GeometryScriptHost,
  sceneId: string,
  bridge: SceneOperations,
  nodeId: string,
): Promise<string> {
  const node = authoredObject(bridge.getNodes() as Record<string, AnyNode>, nodeId)
  const bytes = await host.readArtifact({ sceneId, sha256: node.source.script })
  if (!bytes) throw new Error(`The script of ${nodeId} could not be read`)
  return new TextDecoder().decode(bytes)
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
        const code =
          args.code ??
          (args.nodeId
            ? await readScript(host, scene.id, bridge, args.nodeId)
            : refuseMissingCode())
        const { glb, ...rest } = await host.compile({ code, params: args.params })
        await Promise.all([
          host.storeArtifact({
            sceneId: scene.id,
            sha256: rest.sha256,
            bytes: glb,
            mimeType: 'model/gltf-binary',
          }),
          host.storeArtifact({
            sceneId: scene.id,
            sha256: rest.script,
            bytes: new TextEncoder().encode(code),
            mimeType: GEOMETRY_SCRIPT_MIME_TYPE,
          }),
        ])
        compiled = rest
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
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

function refuseMissingCode(): never {
  refuse(
    'code_required',
    'Pass code to build a new object; params alone rebuild an existing one (nodeId).',
  )
}

/** `read_source` on the MCP: the object's module text, read back through the host's store. */
export function registerReadSource(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
): void {
  server.registerTool(
    readSourceTool.name,
    {
      title: readSourceTool.title,
      description: readSourceTool.description,
      inputSchema: readSourceTool.input,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ nodeId }: { nodeId: string }) => {
      if (!host) {
        return toolError('This Pascal server cannot read geometry scripts.', {
          code: 'scripts_unavailable',
        })
      }
      const scene = bridge.getActiveScene()
      if (!scene) return toolError('Open a scene first.', { code: 'no_active_scene' })
      try {
        const node = authoredObject(bridge.getNodes() as Record<string, AnyNode>, nodeId)
        const payload = readSourceResult(node, await readScript(host, scene.id, bridge, nodeId))
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'script_unreadable',
        })
      }
    },
  )
}
