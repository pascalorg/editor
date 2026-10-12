import { type AnyNodeId, isRegistrySelectable, sceneRegistry, useScene } from '@pascal-app/core'
import type { Object3D } from 'three'

let revision = -1
let owners = new Map<Object3D, string>()
/** A selectable descendant owns the hit before its host, including at equal depth. */
export function hasDescendantHit(target: Object3D, hits: readonly { object: Object3D }[]) {
  if (revision !== sceneRegistry.revision) {
    revision = sceneRegistry.revision
    owners = new Map([...sceneRegistry.nodes].map(([id, root]) => [root, id]))
  }
  return hits.some(({ object }) => {
    let owner: Object3D | null = object
    while (owner && !owners.has(owner)) owner = owner.parent
    if (!owner || owner === target) return false
    const node = useScene.getState().nodes[owners.get(owner)! as AnyNodeId]
    if (!node || !isRegistrySelectable(node.type)) return false
    let ancestor = owner.parent
    while (ancestor) {
      if (ancestor === target) return true
      ancestor = ancestor.parent
    }
    return false
  })
}
