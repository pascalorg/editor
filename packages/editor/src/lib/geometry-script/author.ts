import {
  type AnyNodeId,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPE,
  type GeometryScriptParamValue,
  getArtifactStore,
  useScene,
} from '@pascal-app/core'
import { authoredObject, authorObject } from '@pascal-app/core/agent-operations'
import { compileGeometryScriptInWorker } from './client'

/**
 * The editor's compile step for `author_object`: runs the module in the
 * worker and stores the GLB and the module text, so the core operation can
 * reference both by hash. Without `code`, the node's stored script is rebuilt
 * with the new params.
 */
export async function compileAndStoreGeometryScript(input: {
  code?: string
  nodeId?: string
  params?: Record<string, GeometryScriptParamValue>
}): Promise<CompiledGeometryScript> {
  const code = input.code ?? (await storedScript(input.nodeId))
  const { glb, ...compiled } = await compileGeometryScriptInWorker({ code, params: input.params })
  const store = getArtifactStore()
  await Promise.all([
    store.put(compiled.sha256, glb, 'model/gltf-binary'),
    store.put(compiled.script, new TextEncoder().encode(code), GEOMETRY_SCRIPT_MIME_TYPE),
  ])
  return compiled
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
 * Re-runs an authored object's script with new param values, the inspector's
 * path: same code, new artifact, one undo step. A slower earlier rebuild of
 * the same node never overwrites a newer one.
 */
export async function rebuildAuthoredObject(
  nodeId: string,
  params: Record<string, GeometryScriptParamValue>,
): Promise<void> {
  const generation = (rebuildGeneration.get(nodeId) ?? 0) + 1
  rebuildGeneration.set(nodeId, generation)
  const compiled = await compileAndStoreGeometryScript({ nodeId, params })
  if (rebuildGeneration.get(nodeId) !== generation) return
  const { changes } = authorObject(
    useScene.getState().nodes,
    { params, nodeId, compiled },
    { activeLevelId: null },
  )
  for (const { id, data } of changes?.update ?? []) {
    useScene.getState().updateNode(id as AnyNodeId, data)
  }
}
