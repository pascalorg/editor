import type { AnyNode, RoofSegmentNode } from '@pascal-app/core'
import { buildPrintableRoofSegmentSolids } from '@pascal-app/viewer'
import * as THREE from 'three'
import {
  compilePrintShellBaseline,
  type PrintShellCompileDiagnostic,
  type PrintShellCompileResult,
} from './print-shell-compiler-baseline'

function meshCount(root: THREE.Object3D): number {
  let count = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    const position = mesh.isMesh ? mesh.geometry?.getAttribute('position') : null
    if (position && position.count > 0) count += 1
  })
  return count
}

function replaceChild(parent: THREE.Object3D, target: THREE.Object3D, replacement: THREE.Object3D) {
  const targetIndex = parent.children.indexOf(target)
  parent.remove(target)
  parent.add(replacement)
  const appendedIndex = parent.children.indexOf(replacement)
  parent.children.splice(appendedIndex, 1)
  parent.children.splice(targetIndex, 0, replacement)
}

function copyPreparedTransform(source: THREE.Object3D, target: THREE.Object3D) {
  target.name = source.name
  target.position.copy(source.position)
  target.quaternion.copy(source.quaternion)
  target.scale.copy(source.scale)
  target.matrix.copy(source.matrix)
  target.matrixAutoUpdate = source.matrixAutoUpdate
  target.visible = source.visible
  target.layers.mask = source.layers.mask
  target.userData = { ...source.userData, printSource: 'canonical-roof' }
}

function disposeGenerated(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.dispose()
  })
}

/**
 * Compiles a semantic structural source instead of trusting display aggregates.
 * Roof segments are replaced as complete identity subtrees so their hosted
 * display CSG and accessory meshes cannot leak into the manufacturing shell.
 */
export function compileSemanticPrintShell(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
): PrintShellCompileResult {
  const scene = new THREE.Group()
  scene.name = 'semantic-print-source'
  scene.add(source.clone(true))

  const roofTargets: { node: RoofSegmentNode; object: THREE.Object3D }[] = []
  scene.traverse((object) => {
    const id = object.userData.pascalId
    const node = typeof id === 'string' ? nodes[id] : undefined
    if (node?.type === 'roof-segment') roofTargets.push({ node, object })
  })

  const diagnostics: PrintShellCompileDiagnostic[] = []
  const replacements: { target: THREE.Object3D; replacement: THREE.Group }[] = []
  for (const { node, object } of roofTargets) {
    const result = buildPrintableRoofSegmentSolids(node, nodes)
    if (result.status === 'blocked') {
      diagnostics.push(...result.diagnostics)
      continue
    }
    copyPreparedTransform(object, result.object)
    replacements.push({ target: object, replacement: result.object })
  }

  if (diagnostics.length > 0) {
    for (const { replacement } of replacements) disposeGenerated(replacement)
    return {
      backend: 'pascal-three-bvh-csg',
      status: 'blocked',
      scene: null,
      inputMeshCount: meshCount(scene),
      sourceNodeIds: Array.from(
        new Set(diagnostics.flatMap((diagnostic) => diagnostic.nodeIds)),
      ).sort(),
      diagnostics,
    }
  }

  for (const { target, replacement } of replacements) {
    if (target.parent) replaceChild(target.parent, target, replacement)
  }

  try {
    return compilePrintShellBaseline(scene)
  } finally {
    for (const { replacement } of replacements) disposeGenerated(replacement)
  }
}
