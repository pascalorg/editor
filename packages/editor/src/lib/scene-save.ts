import type { SceneGraph } from './scene'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripTransientNodeMetadata(node: unknown): unknown {
  if (!isRecord(node) || !isRecord(node.metadata) || node.metadata.isNew !== true) return node

  const metadata = { ...node.metadata }
  delete metadata.isNew
  return { ...node, metadata }
}

export function prepareSceneGraphForSave(scene: SceneGraph): SceneGraph {
  return {
    ...scene,
    nodes: Object.fromEntries(
      Object.entries(scene.nodes).map(([id, node]) => [id, stripTransientNodeMetadata(node)]),
    ),
  }
}
