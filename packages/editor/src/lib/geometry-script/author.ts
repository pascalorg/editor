import {
  type AnyNodeId,
  type CompiledGeometryScript,
  type GeometryScriptParamValue,
  getArtifactStore,
  useScene,
} from '@pascal-app/core'
import { authorObject } from '@pascal-app/core/agent-operations'
import { compileGeometryScriptInWorker } from './client'

/**
 * The editor's compile step for `author_object`: runs the module in the
 * worker and stores the artifact, so the core operation can reference it by
 * hash. The GLB bytes stay out of the result.
 */
export async function compileAndStoreGeometryScript(input: {
  code: string
  params?: Record<string, GeometryScriptParamValue>
}): Promise<CompiledGeometryScript> {
  const { glb, ...compiled } = await compileGeometryScriptInWorker(input)
  await getArtifactStore().put(compiled.sha256, glb, 'model/gltf-binary')
  return compiled
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
  const node = useScene.getState().nodes[nodeId as AnyNodeId]
  if (node?.type !== 'item' || !node.source) throw new Error(`${nodeId} is not an authored object`)
  const generation = (rebuildGeneration.get(nodeId) ?? 0) + 1
  rebuildGeneration.set(nodeId, generation)
  const { code } = node.source
  const compiled = await compileAndStoreGeometryScript({ code, params })
  if (rebuildGeneration.get(nodeId) !== generation) return
  const { changes } = authorObject(
    useScene.getState().nodes,
    { code, params, nodeId, compiled },
    { activeLevelId: null },
  )
  for (const { id, data } of changes?.update ?? []) {
    useScene.getState().updateNode(id as AnyNodeId, data)
  }
}
