import type { SceneGraph } from './actions'

const DEFAULT_NODE_TYPES = ['site', 'building', 'level']

export function isSceneGraphEmpty(sceneGraph: SceneGraph | any): boolean {
  if (!sceneGraph?.nodes) return true

  const nodes = Object.values(sceneGraph.nodes) as any[]

  if (nodes.length > 3) {
    return false
  }

  const hasNonDefaultNodes = nodes.some((n) => !DEFAULT_NODE_TYPES.includes(n.type))
  if (hasNonDefaultNodes) {
    return false
  }

  const levelNode = nodes.find((n) => n.type === 'level')
  if (Array.isArray(levelNode?.children) && levelNode.children.length > 0) {
    return false
  }

  return true
}
