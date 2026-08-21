import { type AnyNode, nodeRegistry } from '@pascal-app/core'
import * as THREE from 'three'

export type PrintContentScope = 'structure' | 'everything'

const EMPTY_POSITION_GEOMETRY = new THREE.BufferGeometry()
EMPTY_POSITION_GEOMETRY.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(new Float32Array(0), 3),
)

function identityId(object: THREE.Object3D): string | null {
  const id = object.userData.pascalId
  return typeof id === 'string' ? id : null
}

function structureIds(nodes: Record<string, AnyNode>): Set<string> {
  return new Set(
    Object.values(nodes)
      .filter((node) => nodeRegistry.get(node.type)?.category === 'structure')
      .map((node) => node.id),
  )
}

function retainedIds(
  includedIds: ReadonlySet<string>,
  nodes: Record<string, AnyNode>,
): Set<string> {
  const retained = new Set(includedIds)
  for (const id of includedIds) {
    const visited = new Set<string>([id])
    let parentId = nodes[id]?.parentId ?? null
    while (parentId && !visited.has(parentId)) {
      retained.add(parentId)
      visited.add(parentId)
      parentId = nodes[parentId]?.parentId ?? null
    }
  }
  return retained
}

function neutralizeRenderable(object: THREE.Object3D) {
  const renderable = object as THREE.Mesh & { isLine?: boolean; isPoints?: boolean }
  if (renderable.isMesh || renderable.isLine || renderable.isPoints) {
    renderable.geometry = EMPTY_POSITION_GEOMETRY
  }
}

/**
 * Keep registered structural nodes plus the minimum semantic/Three ancestry
 * needed to preserve their world transforms. Unknown, furnishing, analysis,
 * utility, and site-owned geometry is removed unless it is only a transform
 * container leading to retained structure.
 */
export function filterPreparedSceneForPrintContent(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  scope: PrintContentScope,
): THREE.Object3D {
  const scene = source.clone(true)
  if (scope === 'everything') return scene

  const includedIds = structureIds(nodes)
  const retained = retainedIds(includedIds, nodes)

  const prune = (object: THREE.Object3D, inheritedStructure: boolean, isRoot = false): boolean => {
    const id = identityId(object)
    let carriesStructure = inheritedStructure

    if (id) {
      if (includedIds.has(id)) carriesStructure = true
      else if (retained.has(id)) carriesStructure = false
      else return false
    }

    for (const child of [...object.children]) {
      if (!prune(child, carriesStructure)) child.removeFromParent()
    }

    if (carriesStructure || isRoot) return true
    if (object.children.length === 0) return false

    neutralizeRenderable(object)
    return true
  }

  prune(scene, false, true)
  scene.name = 'print-content-structure'
  return scene
}
