import {
  type AnyNodeId,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPE,
  GeometryArtifactMetadata,
  GeometryReuseFields,
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
  editedScriptParams,
  rescriptOpening,
} from '@pascal-app/core/agent-operations'
import { compileGeometryScriptInWorker } from './client'

/**
 * The editor's compile step for `add_object`: runs the module in the
 * worker and stores the GLB and the module text, so the core operation can
 * reference both by hash. Without `code`, the node's stored script is rebuilt;
 * either way an edit keeps the node's param values it does not override.
 */
export async function compileAndStoreGeometryScript(input: {
  code?: string
  nodeId?: string
  params?: Record<string, GeometryScriptParamValue>
  kind?: 'item' | 'door' | 'window' | 'column'
  name?: string
  description?: string
  category?: string
  tags?: string[]
  provenance?: GeometryArtifactMetadata
}): Promise<CompiledGeometryScript> {
  const code = input.code ?? (await storedScript(input.nodeId))
  const node = input.nodeId ? useScene.getState().nodes[input.nodeId as AnyNodeId] : undefined
  const params = editedScriptParams(node, input.params)
  const { glb, ...compiled } = await compileGeometryScriptInWorker({ code, params })
  const kind =
    input.kind ??
    (node?.type === 'door' || node?.type === 'window' || node?.type === 'column'
      ? node.type
      : 'item')
  const nodeId = input.nodeId ?? generateId(kind)
  const metadata = GeometryArtifactMetadata.parse({
    ...(isScriptedNode(node) ? scriptedObjectMeta(node) : {}),
    ...input.provenance,
    ...GeometryReuseFields.parse(input),
    kind,
    mount: compiled.mount,
  })
  const context = { nodeId, metadata }
  const store = getArtifactStore()
  const [sha256] = await Promise.all([
    store.put(compiled.sha256, glb, 'model/gltf-binary', context),
    store.put(compiled.script, new TextEncoder().encode(code), GEOMETRY_SCRIPT_MIME_TYPE, context),
  ])
  return { ...compiled, sha256, nodeId }
}

/** The module text of an authored object, read back from the artifact store. */
export async function storedScript(nodeId: string | undefined): Promise<string> {
  if (!nodeId) throw new Error('Pass the code to build a new object')
  const node = authoredObject(useScene.getState().nodes, nodeId)
  const code = await getArtifactStore().text(node.source.script)
  if (code === null) throw new Error(`The script of ${nodeId} could not be read`)
  return code
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
