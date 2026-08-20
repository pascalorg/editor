import ManifoldModule, { type Manifold as ManifoldSolid, type ManifoldToplevel } from 'manifold-3d'
import * as THREE from 'three'
import {
  collectPrintShellInput,
  type PrintShellCompileDiagnostic,
  type PrintShellCompileResult,
} from './print-shell-compiler-baseline'

let modulePromise: Promise<ManifoldToplevel> | null = null

async function getManifoldModule(): Promise<ManifoldToplevel> {
  modulePromise ??= ManifoldModule().then((module) => {
    module.setup()
    return module
  })
  return modulePromise
}

function manifoldMesh(
  module: ManifoldToplevel,
  geometry: THREE.BufferGeometry,
): InstanceType<ManifoldToplevel['Mesh']> {
  const position = geometry.getAttribute('position')
  const vertProperties = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    vertProperties[index * 3] = position.getX(index)
    vertProperties[index * 3 + 1] = position.getY(index)
    vertProperties[index * 3 + 2] = position.getZ(index)
  }

  const geometryIndex = geometry.getIndex()
  const triVerts = new Uint32Array(geometryIndex?.count ?? position.count)
  for (let index = 0; index < triVerts.length; index += 1) {
    triVerts[index] = geometryIndex?.getX(index) ?? index
  }
  return new module.Mesh({ numProp: 3, vertProperties, triVerts })
}

function threeGeometry(solid: ManifoldSolid): THREE.BufferGeometry {
  const mesh = solid.getMesh()
  const positions = new Float32Array(mesh.numVert * 3)
  for (let index = 0; index < mesh.numVert; index += 1) {
    const sourceOffset = index * mesh.numProp
    positions[index * 3] = mesh.vertProperties[sourceOffset]!
    positions[index * 3 + 1] = mesh.vertProperties[sourceOffset + 1]!
    positions[index * 3 + 2] = mesh.vertProperties[sourceOffset + 2]!
  }

  const parents = new Uint32Array(mesh.numVert)
  for (let index = 0; index < parents.length; index += 1) parents[index] = index
  const find = (index: number): number => {
    let root = index
    while (parents[root] !== root) root = parents[root]!
    while (parents[index] !== index) {
      const next = parents[index]!
      parents[index] = root
      index = next
    }
    return root
  }
  for (let index = 0; index < mesh.mergeFromVert.length; index += 1) {
    parents[find(mesh.mergeFromVert[index]!)] = find(mesh.mergeToVert[index]!)
  }

  const triVerts: number[] = []
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let index = 0; index + 2 < mesh.triVerts.length; index += 3) {
    const a = find(mesh.triVerts[index]!)
    const b = find(mesh.triVerts[index + 1]!)
    const c = find(mesh.triVerts[index + 2]!)
    if (a === b || b === c || c === a) continue
    ab.set(
      positions[b * 3]! - positions[a * 3]!,
      positions[b * 3 + 1]! - positions[a * 3 + 1]!,
      positions[b * 3 + 2]! - positions[a * 3 + 2]!,
    )
    ac.set(
      positions[c * 3]! - positions[a * 3]!,
      positions[c * 3 + 1]! - positions[a * 3 + 1]!,
      positions[c * 3 + 2]! - positions[a * 3 + 2]!,
    )
    if (ab.cross(ac).lengthSq() <= 1e-12) continue
    triVerts.push(a, b, c)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(triVerts)
  geometry.computeVertexNormals()
  return geometry
}

function blockedResult(
  inputMeshCount: number,
  sourceNodeIds: Set<string>,
  diagnostics: PrintShellCompileDiagnostic[],
): PrintShellCompileResult {
  return {
    backend: 'manifold-3d',
    status: 'blocked',
    scene: null,
    inputMeshCount,
    sourceNodeIds: Array.from(sourceNodeIds).sort(),
    diagnostics,
  }
}

export async function compilePrintShellWithManifold(
  source: THREE.Object3D,
): Promise<PrintShellCompileResult> {
  const { diagnostics, geometries, geometryNodeIds, inputMeshCount, sourceNodeIds } =
    collectPrintShellInput(source)
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    for (const geometry of geometries) geometry.dispose()
    return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
  }

  const solids: ManifoldSolid[] = []
  let result: ManifoldSolid | null = null
  try {
    const module = await getManifoldModule()
    for (const [index, geometry] of geometries.entries()) {
      const nodeId = geometryNodeIds[index]!
      try {
        solids.push(new module.Manifold(manifoldMesh(module, geometry)))
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'manifold_input_failed',
          message: `Node ${nodeId}: ${
            error instanceof Error ? error.message : 'Manifold rejected the shell input.'
          }`,
          nodeIds: [nodeId],
        })
      }
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
    }
    const union = module.Manifold.union(solids)
    result = union.asOriginal()
    union.delete()
    const status = result.status()
    if (status !== 'NoError') {
      diagnostics.push({
        severity: 'error',
        code: 'manifold_union_failed',
        message: `Manifold union failed with ${status}.`,
        nodeIds: Array.from(sourceNodeIds).sort(),
      })
      return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
    }

    const geometry = threeGeometry(result)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    mesh.name = 'print-shell-manifold'
    mesh.userData = {
      printCompiler: 'manifold-3d',
      sourceNodeIds: Array.from(sourceNodeIds).sort(),
    }
    const scene = new THREE.Group()
    scene.name = 'compiled-print-shell'
    scene.add(mesh)
    diagnostics.push({
      severity: 'info',
      code: 'manifold_compiler_candidate',
      message:
        'Compiled with the test-only Manifold WASM candidate; worker packaging and production bundle impact remain unapproved.',
      nodeIds: Array.from(sourceNodeIds).sort(),
    })
    return {
      backend: 'manifold-3d',
      status: 'compiled',
      scene,
      inputMeshCount,
      sourceNodeIds: Array.from(sourceNodeIds).sort(),
      diagnostics,
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'manifold_input_failed',
      message: error instanceof Error ? error.message : 'Manifold rejected the shell input.',
      nodeIds: Array.from(sourceNodeIds).sort(),
    })
    return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
  } finally {
    for (const geometry of geometries) geometry.dispose()
    for (const solid of solids) solid.delete()
    result?.delete()
  }
}
