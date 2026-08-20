import type { AnyNode, RoofSegmentNode, WallNode } from '@pascal-app/core'
import { buildPrintableRoofSegmentSolids, buildPrintableWallSolids } from '@pascal-app/viewer'
import * as THREE from 'three'
import {
  compilePrintShellBaseline,
  type PrintShellCompileDiagnostic,
  type PrintShellCompileResult,
} from './print-shell-compiler-baseline'

export type SemanticPrintCompileOptions = {
  wallSolids?: boolean
}

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

function copyPreparedTransform(
  source: THREE.Object3D,
  target: THREE.Object3D,
  printSource: 'canonical-roof' | 'canonical-wall',
) {
  target.name = source.name
  target.position.copy(source.position)
  target.quaternion.copy(source.quaternion)
  target.scale.copy(source.scale)
  target.matrix.copy(source.matrix)
  target.matrixAutoUpdate = source.matrixAutoUpdate
  target.visible = source.visible
  target.layers.mask = source.layers.mask
  target.userData = { ...source.userData, printSource }
}

function disposeGenerated(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.dispose()
  })
}

function exportedIdentityIds(root: THREE.Object3D): Set<string> {
  const ids = new Set<string>()
  root.traverse((object) => {
    if (typeof object.userData.pascalId === 'string') ids.add(object.userData.pascalId)
  })
  return ids
}

function ownedLocalYBounds(root: THREE.Object3D): { min: number; max: number } | null {
  root.updateMatrixWorld(true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const point = new THREE.Vector3()
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  const visit = (object: THREE.Object3D) => {
    if (
      object !== root &&
      typeof object.userData.pascalId === 'string' &&
      object.userData.pascalId !== root.userData.pascalId
    ) {
      return
    }
    const mesh = object as THREE.Mesh
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : null
    if (position) {
      const toRoot = inverseRoot.clone().multiply(object.matrixWorld)
      for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index).applyMatrix4(toRoot)
        min = Math.min(min, point.y)
        max = Math.max(max, point.y)
      }
    }
    for (const child of object.children) visit(child)
  }
  visit(root)
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
}

function preparedWallHeight(
  node: WallNode,
  object: THREE.Object3D,
):
  | { height: number; diagnostic: null }
  | { height: null; diagnostic: PrintShellCompileDiagnostic } {
  const bounds = ownedLocalYBounds(object)
  if (!bounds || bounds.max <= 1e-7) {
    return {
      height: null,
      diagnostic: {
        severity: 'error',
        code: 'invalid_wall_print_dimensions',
        message: `Wall ${node.id} has no finite prepared height for print compilation.`,
        nodeIds: [node.id],
      },
    }
  }
  if (bounds.min < -1e-5 || bounds.min > 1e-5) {
    return {
      height: null,
      diagnostic: {
        severity: 'error',
        code: 'unsupported_wall_print_base',
        message: `Wall ${node.id} has a stepped or displaced local base that does not yet have a canonical printable solid.`,
        nodeIds: [node.id],
      },
    }
  }
  return { height: bounds.max, diagnostic: null }
}

/**
 * Compiles a semantic structural source instead of trusting display aggregates.
 * Roof segments are replaced as complete identity subtrees so their hosted
 * display CSG and accessory meshes cannot leak into the manufacturing shell.
 */
export function compileSemanticPrintShell(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: SemanticPrintCompileOptions = {},
): PrintShellCompileResult {
  const scene = new THREE.Group()
  scene.name = 'semantic-print-source'
  scene.add(source.clone(true))

  const includedNodeIds = exportedIdentityIds(scene)
  const roofTargets: { node: RoofSegmentNode; object: THREE.Object3D }[] = []
  const wallTargets: { node: WallNode; object: THREE.Object3D }[] = []
  scene.traverse((object) => {
    const id = object.userData.pascalId
    const node = typeof id === 'string' ? nodes[id] : undefined
    if (node?.type === 'roof-segment') roofTargets.push({ node, object })
    if (options.wallSolids && node?.type === 'wall') wallTargets.push({ node, object })
  })

  const diagnostics: PrintShellCompileDiagnostic[] = []
  const replacements: { target: THREE.Object3D; replacement: THREE.Group }[] = []
  for (const { node, object } of roofTargets) {
    const result = buildPrintableRoofSegmentSolids(node, nodes)
    if (result.status === 'blocked') {
      diagnostics.push(...result.diagnostics)
      continue
    }
    copyPreparedTransform(object, result.object, 'canonical-roof')
    replacements.push({ target: object, replacement: result.object })
  }
  for (const { node, object } of wallTargets) {
    const prepared = preparedWallHeight(node, object)
    if (prepared.diagnostic) {
      diagnostics.push(prepared.diagnostic)
      continue
    }
    const result = buildPrintableWallSolids(
      node,
      { effectiveHeight: prepared.height, includedNodeIds },
      nodes,
    )
    if (result.status === 'blocked') {
      diagnostics.push(...result.diagnostics)
      continue
    }
    copyPreparedTransform(object, result.object, 'canonical-wall')
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
