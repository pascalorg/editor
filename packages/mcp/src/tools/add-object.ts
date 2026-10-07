import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AddObjectInput,
  achievedChanges,
  addObject,
  authoredObject,
  editedScriptParams,
  readSourceResult,
  requireAddObjectReason,
  type SceneNodes,
} from '@pascal-app/core/agent-operations'
import { addObjectTool, getSourceTool, isAgentRefusal, refuse } from '@pascal-app/core/agent-tools'
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
 * How a host runs `add_object`'s module and keeps the result. Running
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
  /**
   * Compiles and stores in one step, for a host whose compiler keeps the artifacts itself (the
   * hosted MCP's user editor tab); preferred over `compile` + `storeArtifact` when present.
   */
  build?(input: {
    sceneId: string
    code: string
    params?: Record<string, GeometryScriptParamValue>
    /** What the script builds, for the host to name it to the user. */
    kind: ScriptedKind
  }): Promise<CompiledGeometryScript>
}

export type ScriptedKind = 'object' | 'window' | 'door' | 'column'

/** Compiles a module on the host and stores its GLB and text for the scene: the step every scripted tool shares. */
export async function compileAndStore(
  host: GeometryScriptHost,
  sceneId: string,
  code: string,
  params: Record<string, GeometryScriptParamValue> | undefined,
  kind: ScriptedKind,
): Promise<CompiledGeometryScript> {
  if (host.build) return host.build({ sceneId, code, params, kind })
  const { glb, ...compiled } = await host.compile({ code, params })
  await Promise.all([
    host.storeArtifact({
      sceneId,
      sha256: compiled.sha256,
      bytes: glb,
      mimeType: 'model/gltf-binary',
    }),
    host.storeArtifact({
      sceneId,
      sha256: compiled.script,
      bytes: new TextEncoder().encode(code),
      mimeType: GEOMETRY_SCRIPT_MIME_TYPE,
    }),
  ])
  return compiled
}

export async function readScript(
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

/** `add_object` on the MCP: the shared contract and operation, with the host's compile in front. */
export function registerAddObject(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
): void {
  server.registerTool(
    addObjectTool.name,
    {
      title: addObjectTool.title,
      description: addObjectTool.description,
      inputSchema: addObjectTool.input,
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
      const args = input as Omit<AddObjectInput, 'compiled'>
      let compiled: CompiledGeometryScript
      try {
        requireAddObjectReason(args)
        const code =
          args.code ??
          (args.nodeId
            ? await readScript(host, scene.id, bridge, args.nodeId)
            : refuseMissingCode())
        const nodes = bridge.getNodes() as Record<string, AnyNode>
        const params = editedScriptParams(args.nodeId ? nodes[args.nodeId] : undefined, args.params)
        compiled = await compileAndStore(host, scene.id, code, params, 'object')
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'script_failed',
        })
      }
      // A copy: the hosted bridge writes its map in place, and a "before" that grows with the call
      // reads every creation as unchanged.
      const before = { ...(bridge.getNodes() as Record<string, AnyNode>) }
      let outcome: ReturnType<typeof addObject>
      try {
        outcome = addObject(before, { ...args, compiled }, { activeLevelId: null })
      } catch (error) {
        return refusalResult(error)
      }
      const patches = outcome.changes ? toPatches(outcome.changes) : []
      if (patches.length) bridge.applyPatch(patches)
      const payload = {
        ...outcome.result,
        // What the scene holds now, as every write answers.
        achieved: achievedChanges(before as SceneNodes, outcome.changes ?? {}),
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, addObjectTool.name)),
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

/** `get_source` on the MCP: the object's module text, read back through the host's store. */
export function registerGetSource(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
): void {
  server.registerTool(
    getSourceTool.name,
    {
      title: getSourceTool.title,
      description: getSourceTool.description,
      inputSchema: getSourceTool.input,
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
