import * as THREE from 'three'
import {
  collectPrintShellInput,
  type PrintShellCompileDiagnostic,
  type PrintShellCompileResult,
} from './print-shell-compiler-baseline'
import { compileManifoldMeshData } from './print-shell-compiler-manifold-core'
import {
  geometryFromManifoldMeshData,
  geometryToManifoldMeshData,
} from './print-shell-compiler-mesh-data'

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

  const meshes = geometries.map((geometry, index) =>
    geometryToManifoldMeshData(geometry, geometryNodeIds[index]!),
  )
  for (const geometry of geometries) geometry.dispose()
  const output = await compileManifoldMeshData(meshes)
  diagnostics.push(...output.diagnostics)
  if (output.status === 'blocked') {
    return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
  }

  const geometry = geometryFromManifoldMeshData(output.positions, output.indices)
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
    message: `Compiled with the in-process Manifold candidate in ${output.durationMs.toFixed(1)} ms.`,
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
}
