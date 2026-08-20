import ManifoldModule, { type Manifold as ManifoldSolid, type ManifoldToplevel } from 'manifold-3d'
import type { PrintShellCompileDiagnostic } from './print-shell-compiler-baseline'
import type { ManifoldCompileOutput, ManifoldMeshData } from './print-shell-compiler-protocol'

let modulePromise: Promise<ManifoldToplevel> | null = null

async function getManifoldModule(wasmUrl?: string): Promise<ManifoldToplevel> {
  modulePromise ??= ManifoldModule(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then(
    (module) => {
      module.setup()
      return module
    },
  )
  return modulePromise
}

function manifoldMesh(
  module: ManifoldToplevel,
  mesh: ManifoldMeshData,
): InstanceType<ManifoldToplevel['Mesh']> {
  return new module.Mesh({
    numProp: 3,
    vertProperties: mesh.positions,
    triVerts: mesh.indices,
  })
}

function manifoldOutput(solid: ManifoldSolid): { positions: Float32Array; indices: Uint32Array } {
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

  const indices: number[] = []
  for (let index = 0; index + 2 < mesh.triVerts.length; index += 3) {
    const a = find(mesh.triVerts[index]!)
    const b = find(mesh.triVerts[index + 1]!)
    const c = find(mesh.triVerts[index + 2]!)
    if (a === b || b === c || c === a) continue

    const abX = positions[b * 3]! - positions[a * 3]!
    const abY = positions[b * 3 + 1]! - positions[a * 3 + 1]!
    const abZ = positions[b * 3 + 2]! - positions[a * 3 + 2]!
    const acX = positions[c * 3]! - positions[a * 3]!
    const acY = positions[c * 3 + 1]! - positions[a * 3 + 1]!
    const acZ = positions[c * 3 + 2]! - positions[a * 3 + 2]!
    const crossX = abY * acZ - abZ * acY
    const crossY = abZ * acX - abX * acZ
    const crossZ = abX * acY - abY * acX
    if (crossX * crossX + crossY * crossY + crossZ * crossZ <= 1e-12) continue
    indices.push(a, b, c)
  }

  return { positions, indices: new Uint32Array(indices) }
}

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt)
}

export async function compileManifoldMeshData(
  meshes: ManifoldMeshData[],
  wasmUrl?: string,
): Promise<ManifoldCompileOutput> {
  const startedAt = performance.now()
  const sourceNodeIds = Array.from(new Set(meshes.map((mesh) => mesh.nodeId))).sort()
  const diagnostics: PrintShellCompileDiagnostic[] = []
  const solids: ManifoldSolid[] = []
  let union: ManifoldSolid | null = null
  let result: ManifoldSolid | null = null

  if (meshes.length === 0) {
    return {
      status: 'blocked',
      positions: null,
      indices: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'no_shell_meshes',
          message: 'No structural meshes are available for Manifold compilation.',
          nodeIds: [],
        },
      ],
      durationMs: elapsed(startedAt),
    }
  }

  try {
    const module = await getManifoldModule(wasmUrl)
    for (const mesh of meshes) {
      try {
        solids.push(new module.Manifold(manifoldMesh(module, mesh)))
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'manifold_input_failed',
          message: `Node ${mesh.nodeId}: ${
            error instanceof Error ? error.message : 'Manifold rejected the shell input.'
          }`,
          nodeIds: [mesh.nodeId],
        })
      }
    }
    if (diagnostics.length > 0) {
      return {
        status: 'blocked',
        positions: null,
        indices: null,
        diagnostics,
        durationMs: elapsed(startedAt),
      }
    }

    union = module.Manifold.union(solids)
    result = union.asOriginal()
    const status = result.status()
    if (status !== 'NoError') {
      return {
        status: 'blocked',
        positions: null,
        indices: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'manifold_union_failed',
            message: `Manifold union failed with ${status}.`,
            nodeIds: sourceNodeIds,
          },
        ],
        durationMs: elapsed(startedAt),
      }
    }

    const output = manifoldOutput(result)
    if (output.indices.length === 0) {
      return {
        status: 'blocked',
        positions: null,
        indices: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'manifold_union_failed',
            message: 'Manifold produced no printable triangles.',
            nodeIds: sourceNodeIds,
          },
        ],
        durationMs: elapsed(startedAt),
      }
    }
    return {
      status: 'compiled',
      positions: output.positions,
      indices: output.indices,
      diagnostics: [],
      durationMs: elapsed(startedAt),
    }
  } catch (error) {
    return {
      status: 'blocked',
      positions: null,
      indices: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'manifold_worker_failed',
          message: error instanceof Error ? error.message : 'Manifold compilation failed.',
          nodeIds: sourceNodeIds,
        },
      ],
      durationMs: elapsed(startedAt),
    }
  } finally {
    for (const solid of solids) solid.delete()
    union?.delete()
    result?.delete()
  }
}
