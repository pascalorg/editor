import {
  type AnyNodeId,
  type GeometryArtifactManifest,
  type GeometryScriptParamValue,
  getArtifactStore,
  type ItemNode,
  useScene,
} from '@pascal-app/core'
import {
  createScriptItem,
  type GeometryScriptMount,
  type ScriptItemFields,
  updateScriptItem,
} from '@pascal-app/geometry-script'
import { compileGeometryScriptInWorker } from './client'

export type AuthorScriptItemInput = ScriptItemFields & {
  params?: Record<string, GeometryScriptParamValue>
  /** Update this item; omit to create one. */
  nodeId?: string
  /** Required on create: the level, wall, ceiling or item that hosts it. */
  parentId?: string
}

export type AuthorScriptItemResult = {
  nodeId: string
  sha256: string
  mount: GeometryScriptMount
  params: Record<string, GeometryScriptParamValue>
  manifest: GeometryArtifactManifest
}

/**
 * Compiles a three.js geometry script in the worker, stores the artifact and
 * creates or updates the item that references it.
 */
export async function authorScriptItem(
  input: AuthorScriptItemInput,
): Promise<AuthorScriptItemResult> {
  const scene = useScene.getState()
  const existing = input.nodeId ? scene.nodes[input.nodeId as AnyNodeId] : undefined
  if (input.nodeId && existing?.type !== 'item') throw new Error(`No item with id ${input.nodeId}`)
  const previous = existing as ItemNode | undefined
  const parent = input.parentId ? scene.nodes[input.parentId as AnyNodeId] : undefined
  if (!previous && !parent) {
    throw new Error(input.parentId ? `No node with id ${input.parentId}` : 'parentId is required')
  }

  const output = await compileGeometryScriptInWorker({
    code: input.code,
    params: input.params ?? previous?.source?.params,
  })
  await getArtifactStore().put(output.sha256, output.glb, 'model/gltf-binary')

  const node = previous
    ? updateScriptItem(previous, output, input)
    : createScriptItem(output, input, parent!)
  if (previous) scene.updateNode(previous.id as AnyNodeId, node)
  else scene.createNode(node, parent!.id as AnyNodeId)
  return {
    nodeId: node.id,
    sha256: output.sha256,
    mount: output.mount,
    params: output.params,
    manifest: output.manifest,
  }
}
