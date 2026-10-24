import {
  type AnyNode,
  type AnyNodeId,
  type ArtifactStore,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPES,
  GeometryArtifactMetadata,
  GeometryReuseFields,
  type GeometryScriptLanguage,
  type GeometryScriptParamValue,
  generateId,
  getArtifactStore,
  isScriptedNode,
  runAsSingleSceneHistoryStep,
  scriptedObjectMeta,
  useScene,
} from '@pascal-app/core'
import {
  addColumn,
  addObject,
  authoredObject,
  editedScriptLanguage,
  editedScriptParams,
  rescriptOpening,
} from '@pascal-app/core/agent-operations'
import { compileGeometryScriptInWorker } from './client'

/**
 * Builds a bpy module and stores its GLB and text, returning their hashes.
 * Blender runs outside the browser, so the host provides this (the hosted app
 * calls its Blender service); without one, bpy scripts are refused.
 */
export type BlenderScriptBuilder = (input: {
  code: string
  params?: Record<string, GeometryScriptParamValue>
  nodeId: string
  metadata: GeometryArtifactMetadata
}) => Promise<CompiledGeometryScript>

let blenderBuilder: BlenderScriptBuilder | null = null

export function configureBlenderScriptBuilder(next: BlenderScriptBuilder | null): void {
  blenderBuilder = next
}

/**
 * What a compile reads from the scene and the artifact service it stores to. By default the
 * editor's own; a detached scene passes its tracked nodes, so the reads are recorded there.
 */
export type GeometryScriptScene = {
  nodes?: Readonly<Record<string, AnyNode>>
  artifacts?: ArtifactStore
}

/**
 * The editor's compile step for `add_object`: runs the module (a three.js one
 * in the worker, a bpy one through the host's Blender builder) and stores the
 * GLB and the module text, so the core operation can reference both by hash.
 * Without `code`, the node's stored script is rebuilt; either way an edit keeps
 * the node's param values it does not override.
 *
 * Everything it reads from the scene, and the id of a new object, are taken
 * synchronously, before the first await: a detached scene records reads and
 * mints ids only inside its synchronous scope, and is disposed by the time a
 * late compile resolves.
 */
export async function compileAndStoreGeometryScript(
  input: {
    code?: string
    language?: GeometryScriptLanguage
    nodeId?: string
    params?: Record<string, GeometryScriptParamValue>
    kind?: 'item' | 'door' | 'window' | 'column'
    inputs?: Record<string, unknown>
    name?: string
    description?: string
    category?: string
    tags?: string[]
    provenance?: GeometryArtifactMetadata
  },
  scene: GeometryScriptScene = {},
): Promise<CompiledGeometryScript> {
  const nodes = scene.nodes ?? useScene.getState().nodes
  const artifacts = scene.artifacts ?? getArtifactStore()
  const node = input.nodeId ? nodes[input.nodeId as AnyNodeId] : undefined
  const language = editedScriptLanguage(node, input)
  const params = editedScriptParams(node, input.params)
  const kind =
    input.kind ??
    (node?.type === 'door' || node?.type === 'window' || node?.type === 'column'
      ? node.type
      : 'item')
  const nodeId = input.nodeId ?? generateId(kind)
  const authored = isScriptedNode(node) ? scriptedObjectMeta(node) : {}
  const script = input.code === undefined ? authoredScript(nodes, input.nodeId) : null
  const metadata = GeometryArtifactMetadata.parse({
    ...authored,
    ...input.provenance,
    ...GeometryReuseFields.parse(input),
    kind,
  })

  const code = input.code ?? (await readScript(artifacts, script!, input.nodeId!))
  if (language === 'bpy') {
    if (!blenderBuilder) throw new Error('This editor cannot run Blender (bpy) scripts')
    return { ...(await blenderBuilder({ code, params, nodeId, metadata })), nodeId }
  }
  const { glb, ...compiled } = await compileGeometryScriptInWorker({
    code,
    params,
    inputs: input.inputs,
  })
  const context = { nodeId, metadata: { ...metadata, mount: compiled.mount } }
  const [sha256] = await Promise.all([
    artifacts.put(compiled.sha256, glb, 'model/gltf-binary', context),
    artifacts.put(
      compiled.script,
      new TextEncoder().encode(code),
      GEOMETRY_SCRIPT_MIME_TYPES.three,
      context,
    ),
  ])
  return { ...compiled, sha256, nodeId }
}

/** The hash of an authored object's script, read from the scene. */
function authoredScript(nodes: Readonly<Record<string, AnyNode>>, nodeId: string | undefined) {
  if (!nodeId) throw new Error('Pass the code to build a new object')
  return authoredObject(nodes as Record<string, AnyNode>, nodeId).source.script
}

async function readScript(artifacts: ArtifactStore, script: string, nodeId: string) {
  const code = await artifacts.text(script)
  if (code === null) throw new Error(`The script of ${nodeId} could not be read`)
  return code
}

/** The module text of an authored object, read back from the artifact store. */
export async function storedScript(nodeId: string | undefined): Promise<string> {
  const script = authoredScript(useScene.getState().nodes, nodeId)
  return readScript(getArtifactStore(), script, nodeId!)
}

const rebuildGeneration = new Map<string, number>()

/**
 * Re-runs a scripted node's script with new param values, the inspector's
 * and resize handles' path: same code, new artifact, one undo step. A slower earlier rebuild of
 * the same node never overwrites a newer one.
 */
export async function rebuildAuthoredObject(
  nodeId: string,
  params: Record<string, GeometryScriptParamValue>,
  /** Where it ends up, when a resize also moves it (a side arrow keeps the opposite edge). */
  position?: [number, number, number],
): Promise<void> {
  const generation = (rebuildGeneration.get(nodeId) ?? 0) + 1
  rebuildGeneration.set(nodeId, generation)
  const compiled = await compileAndStoreGeometryScript({ nodeId, params })
  if (rebuildGeneration.get(nodeId) !== generation) return
  const changes = rebuildChanges(nodeId, compiled, params, position)
  runAsSingleSceneHistoryStep(useScene, () => {
    for (const { id, data } of changes?.update ?? []) {
      useScene.getState().updateNode(id as AnyNodeId, data)
    }
  })
}

/** What a rebuild changes, through the operation of the node's kind. */
function rebuildChanges(
  nodeId: string,
  compiled: CompiledGeometryScript,
  params: Record<string, GeometryScriptParamValue>,
  position: [number, number, number] | undefined,
) {
  const nodes = useScene.getState().nodes
  const context = { activeLevelId: null }
  switch (nodes[nodeId as AnyNodeId]?.type) {
    case 'column': {
      const at = position && { x: position[0], y: position[1], z: position[2] }
      return addColumn(nodes, { nodeId, compiled, ...at }, context).changes
    }
    case 'window':
    case 'door':
      return rescriptOpening(nodes, { nodeId, compiled, position }, context).changes
    default:
      return addObject(nodes, { params, nodeId, compiled, position }, context).changes
  }
}
