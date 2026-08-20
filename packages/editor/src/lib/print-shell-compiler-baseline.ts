import { ADDITION, Brush, csgEvaluator, csgGeometry, prepareBrushForCSG } from '@pascal-app/viewer'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type PrintShellCompileDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  nodeIds: string[]
}

export type PrintShellCompileResult = {
  backend: 'pascal-three-bvh-csg'
  status: 'compiled' | 'blocked'
  scene: THREE.Object3D | null
  inputMeshCount: number
  sourceNodeIds: string[]
  diagnostics: PrintShellCompileDiagnostic[]
}

function nearestPascalId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const id = current.userData.pascalId
    if (typeof id === 'string') return id
    current = current.parent
  }
  return null
}

function hasFinitePositions(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0 || position.itemSize !== 3) return false
  for (let index = 0; index < position.count; index += 1) {
    if (
      !Number.isFinite(position.getX(index)) ||
      !Number.isFinite(position.getY(index)) ||
      !Number.isFinite(position.getZ(index))
    ) {
      return false
    }
  }
  return true
}

function worldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name)
  }
  geometry.morphAttributes = {}
  geometry.clearGroups()

  const indexed = mergeVertices(geometry, 1e-5)
  geometry.dispose()
  indexed.computeVertexNormals()
  const count = indexed.getIndex()?.count ?? indexed.getAttribute('position').count
  if (count > 0) indexed.addGroup(0, count, 0)
  return indexed
}

function blockedResult(
  inputMeshCount: number,
  sourceNodeIds: Set<string>,
  diagnostics: PrintShellCompileDiagnostic[],
): PrintShellCompileResult {
  return {
    backend: 'pascal-three-bvh-csg',
    status: 'blocked',
    scene: null,
    inputMeshCount,
    sourceNodeIds: Array.from(sourceNodeIds).sort(),
    diagnostics,
  }
}

/**
 * Synchronous baseline used only by print fixtures while backend correctness
 * is evaluated. It unions world-space static meshes and preserves source node
 * IDs at result level; it does not yet run in a worker or provide face-level
 * provenance.
 */
export function compilePrintShellBaseline(source: THREE.Object3D): PrintShellCompileResult {
  source.updateMatrixWorld(true)

  const diagnostics: PrintShellCompileDiagnostic[] = []
  const sourceNodeIds = new Set<string>()
  const geometries: THREE.BufferGeometry[] = []
  let inputMeshCount = 0

  source.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return

    const position = mesh.geometry?.getAttribute('position')
    if (!position || position.count === 0) return
    inputMeshCount += 1

    const nodeId = nearestPascalId(mesh)
    if (!nodeId) {
      diagnostics.push({
        severity: 'error',
        code: 'missing_node_provenance',
        message: 'A structural mesh has no Pascal node identity.',
        nodeIds: [],
      })
      return
    }
    sourceNodeIds.add(nodeId)

    const specialized = mesh as THREE.SkinnedMesh & THREE.InstancedMesh
    if (specialized.isSkinnedMesh || specialized.isInstancedMesh) {
      diagnostics.push({
        severity: 'error',
        code: 'unsupported_dynamic_mesh',
        message: `Node ${nodeId} uses skinned or instanced geometry that the baseline compiler cannot flatten safely.`,
        nodeIds: [nodeId],
      })
      return
    }
    if (!hasFinitePositions(mesh.geometry)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid_shell_input',
        message: `Node ${nodeId} has empty or non-finite structural geometry.`,
        nodeIds: [nodeId],
      })
      return
    }

    geometries.push(worldGeometry(mesh))
  })

  if (inputMeshCount === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'no_shell_meshes',
      message: 'No structural meshes are available for shell compilation.',
      nodeIds: [],
    })
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    for (const geometry of geometries) geometry.dispose()
    return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
  }

  const material = new THREE.MeshStandardMaterial()
  const ownedGeometries = new Set<THREE.BufferGeometry>(geometries)
  const brushes = geometries.map((geometry) => {
    const brush = new Brush(geometry, material)
    prepareBrushForCSG(brush)
    return brush
  })

  let current = brushes[0]!
  try {
    for (let index = 1; index < brushes.length; index += 1) {
      const next = csgEvaluator.evaluate(current, brushes[index]!, ADDITION) as Brush
      prepareBrushForCSG(next)
      ownedGeometries.add(next.geometry)
      current = next
    }

    const geometry = csgGeometry(current).clone()
    geometry.clearGroups()
    const count = geometry.getIndex()?.count ?? geometry.getAttribute('position').count
    if (count > 0) geometry.addGroup(0, count, 0)
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    mesh.name = 'print-shell-baseline'
    mesh.userData = {
      printCompiler: 'pascal-three-bvh-csg',
      sourceNodeIds: Array.from(sourceNodeIds).sort(),
    }
    const scene = new THREE.Group()
    scene.name = 'compiled-print-shell'
    scene.add(mesh)

    diagnostics.push({
      severity: 'info',
      code: 'baseline_compiler',
      message:
        'Compiled with the synchronous Pascal Three/CSG baseline; worker scheduling and face-level provenance remain pending.',
      nodeIds: Array.from(sourceNodeIds).sort(),
    })

    return {
      backend: 'pascal-three-bvh-csg',
      status: 'compiled',
      scene,
      inputMeshCount,
      sourceNodeIds: Array.from(sourceNodeIds).sort(),
      diagnostics,
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'shell_union_failed',
      message: error instanceof Error ? error.message : 'The baseline shell union failed.',
      nodeIds: Array.from(sourceNodeIds).sort(),
    })
    return blockedResult(inputMeshCount, sourceNodeIds, diagnostics)
  } finally {
    for (const geometry of ownedGeometries) geometry.dispose()
    material.dispose()
  }
}
