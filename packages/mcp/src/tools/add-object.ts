import type { McpServer } from '@modelcontextprotocol/server'
import { isScriptedNode, scriptedObjectMeta } from '@pascal-app/core'
import {
  type AddObjectInput,
  achievedChanges,
  addObject,
  authoredObject,
  editedScriptLanguage,
  editedScriptParams,
  furnishingRefusal,
  readableScript,
  readSourceResult,
  requireAddObjectReason,
  type SceneNodes,
  type ScriptReadable,
} from '@pascal-app/core/agent-operations'
import {
  addObjectTool,
  CATALOG_SOURCE,
  getSourceTool,
  isAgentRefusal,
  refuse,
} from '@pascal-app/core/agent-tools'
import { untracked } from '@pascal-app/core/runtime'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPES,
  GeometryArtifactMetadata,
  GeometryReuseFields,
  type GeometryScriptLanguage,
  type GeometryScriptParamValue,
  generateId,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { inScene } from './scene-scope'
import { briefInForce, toPatches } from './shared-tools'

/**
 * How a host runs `add_object`'s module and keeps the result. Running
 * model-written code is the host's call: it decides the isolation, and where
 * artifacts live for the active scene.
 */
export type GeometryScriptHost = {
  readonly signal?: AbortSignal
  /** Recheck the host's active authorization after a long compile and before scene mutation. */
  assertActive?(): Promise<void>
  compile(input: {
    code: string
    language: GeometryScriptLanguage
    params?: Record<string, GeometryScriptParamValue>
    /** What the host builds it for (a room's floor, a wall's face: `floorScriptInputs`, `wallFaceScriptInputs`), kept in the host's frame. */
    inputs?: Record<string, unknown>
  }): Promise<CompiledGeometryScript & { glb: Uint8Array }>
  storeArtifact(input: {
    sceneId: string
    sha256: string
    bytes: Uint8Array
    mimeType: string
    nodeId?: string
    metadata?: GeometryArtifactMetadata
  }): Promise<string>
  /** A stored artifact's bytes (an object's script), or null when missing; only for principals who may edit the scene. */
  readArtifact(input: { sceneId: string; sha256: string }): Promise<Uint8Array | null>
  /**
   * Compiles and stores in one step, for a host whose compiler keeps the artifacts itself (the
   * hosted MCP's user editor tab); preferred over `compile` + `storeArtifact` when present.
   */
  build?(input: {
    sceneId: string
    code: string
    language: GeometryScriptLanguage
    params?: Record<string, GeometryScriptParamValue>
    inputs?: Record<string, unknown>
    /** What the script builds, for the host to name it to the user. */
    kind: ScriptedKind
    nodeId: string
    metadata?: GeometryArtifactMetadata
  }): Promise<CompiledGeometryScript>
}

export type ScriptedKind = 'object' | 'window' | 'door' | 'column' | 'floor' | 'wall-face'

/** The kind an artifact records; a room's floor finish and a wall face's are none of the node kinds. */
const ARTIFACT_KIND: Record<ScriptedKind, GeometryArtifactMetadata['kind']> = {
  object: 'item',
  window: 'window',
  door: 'door',
  column: 'column',
  floor: undefined,
  'wall-face': undefined,
}

/** Compiles a module on the host and stores its GLB and text for the scene: the step every scripted tool shares. */
export async function compileAndStore(
  host: GeometryScriptHost,
  sceneId: string,
  {
    code,
    language,
    params,
    inputs,
  }: {
    code: string
    language: GeometryScriptLanguage
    params: Record<string, GeometryScriptParamValue> | undefined
    inputs?: Record<string, unknown>
  },
  kind: ScriptedKind,
  context: { nodeId?: string; metadata?: GeometryArtifactMetadata } = {},
): Promise<CompiledGeometryScript> {
  const nodeId = context.nodeId ?? generateId(ARTIFACT_KIND[kind] ?? 'item')
  const metadata = GeometryArtifactMetadata.parse({
    ...context.metadata,
    kind: ARTIFACT_KIND[kind],
  })
  if (host.build)
    return {
      ...(await host.build({ sceneId, code, language, params, inputs, kind, nodeId, metadata })),
      nodeId,
    }
  const { glb, ...compiled } = await host.compile({ code, language, params, inputs })
  metadata.mount = compiled.mount
  const [sha256] = await Promise.all([
    host.storeArtifact({
      sceneId,
      nodeId,
      metadata,
      sha256: compiled.sha256,
      bytes: glb,
      mimeType: 'model/gltf-binary',
    }),
    host.storeArtifact({
      sceneId,
      nodeId,
      metadata,
      sha256: compiled.script,
      bytes: new TextEncoder().encode(code),
      mimeType: GEOMETRY_SCRIPT_MIME_TYPES[language],
    }),
  ])
  return { ...compiled, sha256, nodeId }
}

async function scriptText(
  host: GeometryScriptHost,
  sceneId: string,
  node: ScriptReadable,
): Promise<string> {
  const bytes = await host.readArtifact({ sceneId, sha256: node.source.script })
  if (!bytes) throw new Error(`The script of ${node.id} could not be read`)
  return new TextDecoder().decode(bytes)
}

export function readScript(
  host: GeometryScriptHost,
  sceneId: string,
  bridge: SceneOperations,
  nodeId: string,
): Promise<string> {
  return scriptText(
    host,
    sceneId,
    authoredObject(bridge.getNodes() as Record<string, AnyNode>, nodeId),
  )
}

/**
 * One object's module compiled and stored by the host: a new one from its code, an edit from its
 * code or its stored script, with the params it keeps. The step a lone add_object and each
 * add_object of a run_batch share. What it reads from the scene it reads before its first await;
 * `nodeId` is a new object's id, minted by the caller in the scene's scope.
 */
export async function compileObject(
  host: GeometryScriptHost,
  sceneId: string,
  bridge: SceneOperations,
  args: Omit<AddObjectInput, 'compiled'>,
  nodeId = args.nodeId,
): Promise<CompiledGeometryScript> {
  const nodes = bridge.getNodes() as Record<string, AnyNode>
  const previous = args.nodeId ? nodes[args.nodeId] : undefined
  const language = editedScriptLanguage(previous, args)
  const params = editedScriptParams(previous, args.params)
  const metadata = {
    ...(isScriptedNode(previous) ? scriptedObjectMeta(previous) : {}),
    ...GeometryReuseFields.parse(args),
  }
  const code =
    args.code ??
    (args.nodeId ? await readScript(host, sceneId, bridge, args.nodeId) : refuseMissingCode())
  return compileAndStore(host, sceneId, { code, language, params }, 'object', { nodeId, metadata })
}

/** What a batch's add_object builds with: the host's compile, on the scene open now. */
export async function compileObjectOnHost(
  host: GeometryScriptHost | undefined,
  bridge: SceneOperations,
  args: Omit<AddObjectInput, 'compiled'>,
): Promise<CompiledGeometryScript> {
  if (!host) refuse('scripts_unavailable', 'This Pascal server cannot run geometry scripts.')
  const scene = bridge.getActiveScene()
  if (!scene)
    refuse(
      'no_active_scene',
      'Open or save a scene first: authored objects are stored with a scene.',
    )
  const nodeId = args.nodeId ?? inScene(bridge, () => generateId('item'))
  return compileObject(host, scene.id, bridge, args, nodeId)
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
      inputSchema: z.object(addObjectTool.input),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: Record<string, unknown>) => {
      const brief = briefInForce(bridge)
      if (brief !== undefined) {
        const refusal = furnishingRefusal(addObjectTool.name, input, brief)
        if (refusal) return refusalResult(refusal)
      }
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
      // A new object's id is the scene's, minted before anything is awaited.
      const nodeId = args.nodeId ?? inScene(bridge, () => generateId('item'))
      let compiled: CompiledGeometryScript
      try {
        requireAddObjectReason(args)
        compiled = await compileObject(host, scene.id, bridge, args, nodeId)
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(
          `${error instanceof Error ? error.message : String(error)} ${CATALOG_SOURCE}`,
          { code: 'script_failed' },
        )
      }
      // A copy: the hosted bridge writes its map in place, and a "before" that grows with the call
      // reads every creation as unchanged.
      // Copying is not a read: on a detached scene the operation records what it selects.
      const nodes = bridge.getNodes() as Record<string, AnyNode>
      const before = { ...untracked(nodes) }
      let outcome: ReturnType<typeof addObject>
      try {
        outcome = inScene(bridge, () =>
          addObject(
            nodes,
            { ...args, compiled },
            { activeLevelId: bridge.activeLevelId?.() ?? null },
          ),
        )
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
      inputSchema: z.object(getSourceTool.input),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ nodeId, face }: { nodeId: string; face?: 'a' | 'b' }) => {
      if (!host) {
        return toolError('This Pascal server cannot read geometry scripts.', {
          code: 'scripts_unavailable',
        })
      }
      const scene = bridge.getActiveScene()
      if (!scene) return toolError('Open a scene first.', { code: 'no_active_scene' })
      try {
        const node = readableScript(bridge.getNodes() as Record<string, AnyNode>, nodeId, face)
        const payload = readSourceResult(node, await scriptText(host, scene.id, node))
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
