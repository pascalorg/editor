import {
  type CompiledGeometryScript,
  type GeometryScriptParamValue,
  getArtifactStore,
} from '@pascal-app/core'
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
