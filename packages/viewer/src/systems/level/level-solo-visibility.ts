import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import type { Object3D } from 'three'
import { SCENE_LAYER } from '../../lib/layers'

const ORIGINAL_SOLO_LAYERS = Symbol('level-solo:original-layers')

type SoloLayerCarrier = Object3D & { [ORIGINAL_SOLO_LAYERS]?: number }

let soloVisibilityActive = false
let soloVisibilityKey: string | null = null

function keepObjectSubtree(keep: Set<Object3D>, root: Object3D | undefined) {
  root?.traverse((child: Object3D) => {
    keep.add(child)
  })
}

function collectNodeAndObjectSubtree(
  nodeId: string,
  keep: Set<Object3D>,
  visited: Set<string>,
  childIdsByParent: Map<string, string[]>,
) {
  if (visited.has(nodeId)) return
  visited.add(nodeId)

  const nodes = useScene.getState().nodes
  keepObjectSubtree(keep, sceneRegistry.nodes.get(nodeId))

  const node = nodes[nodeId as AnyNodeId] as { children?: string[] } | undefined
  const childIds = new Set([...(node?.children ?? []), ...(childIdsByParent.get(nodeId) ?? [])])

  for (const childId of childIds) {
    collectNodeAndObjectSubtree(childId, keep, visited, childIdsByParent)
  }
}

function hideOutsideKeep(obj: Object3D, keep: Set<Object3D>) {
  if (keep.has(obj)) return

  const carrier = obj as SoloLayerCarrier
  if (carrier[ORIGINAL_SOLO_LAYERS] === undefined) {
    carrier[ORIGINAL_SOLO_LAYERS] = obj.layers.mask
  }
  obj.layers.disable(SCENE_LAYER)

  for (const child of obj.children) {
    hideOutsideKeep(child, keep)
  }
}

export function applySoloLevelVisibility(selectedLevelId: string | null | undefined) {
  if (!selectedLevelId) {
    clearSoloLevelVisibility()
    return
  }

  const selectedRoot = sceneRegistry.nodes.get(selectedLevelId)
  if (!selectedRoot) {
    clearSoloLevelVisibility()
    return
  }

  const nextKey = `${selectedLevelId}:${sceneRegistry.nodes.size}`
  if (soloVisibilityActive && soloVisibilityKey === nextKey) return

  clearSoloLevelVisibility()

  const nodes = useScene.getState().nodes
  const childIdsByParent = new Map<string, string[]>()
  for (const node of Object.values(nodes) as Array<{ id?: string; parentId?: string }>) {
    if (!(node.id && node.parentId)) continue
    const childIds = childIdsByParent.get(node.parentId) ?? []
    childIds.push(node.id)
    childIdsByParent.set(node.parentId, childIds)
  }

  const keep = new Set<Object3D>()
  collectNodeAndObjectSubtree(selectedLevelId, keep, new Set(), childIdsByParent)
  keepObjectSubtree(keep, selectedRoot)

  for (const [, obj] of sceneRegistry.nodes) {
    hideOutsideKeep(obj, keep)
  }

  soloVisibilityActive = true
  soloVisibilityKey = nextKey
}

export function clearSoloLevelVisibility() {
  if (!soloVisibilityActive) return

  for (const [, obj] of sceneRegistry.nodes) {
    obj.traverse((child: Object3D) => {
      const carrier = child as SoloLayerCarrier
      if (carrier[ORIGINAL_SOLO_LAYERS] === undefined) return
      child.layers.mask = carrier[ORIGINAL_SOLO_LAYERS]
      delete carrier[ORIGINAL_SOLO_LAYERS]
    })
  }

  soloVisibilityActive = false
  soloVisibilityKey = null
}
