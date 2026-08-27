import ManifoldModule, { type Manifold as ManifoldSolid, type ManifoldToplevel } from 'manifold-3d'
import type { PrintShellCompileDiagnostic } from './print-shell-compiler-baseline'
import type { ManifoldCompileOutput, ManifoldMeshData } from './print-shell-compiler-protocol'

let modulePromise: Promise<ManifoldToplevel> | null = null
const MANIFOLD_OUTPUT_WELD_EPSILON_METERS = 2e-5
const COLLINEAR_SEAM_CROSS_LENGTH_SQ = 1e-20

type Triangle = [number, number, number]

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

function distanceSquared(positions: Float32Array, left: number, right: number): number {
  const dx = positions[left * 3]! - positions[right * 3]!
  const dy = positions[left * 3 + 1]! - positions[right * 3 + 1]!
  const dz = positions[left * 3 + 2]! - positions[right * 3 + 2]!
  return dx * dx + dy * dy + dz * dz
}

function triangleCrossLengthSquared(positions: Float32Array, [a, b, c]: Triangle): number {
  const abX = positions[b * 3]! - positions[a * 3]!
  const abY = positions[b * 3 + 1]! - positions[a * 3 + 1]!
  const abZ = positions[b * 3 + 2]! - positions[a * 3 + 2]!
  const acX = positions[c * 3]! - positions[a * 3]!
  const acY = positions[c * 3 + 1]! - positions[a * 3 + 1]!
  const acZ = positions[c * 3 + 2]! - positions[a * 3 + 2]!
  const crossX = abY * acZ - abZ * acY
  const crossY = abZ * acX - abX * acZ
  const crossZ = abX * acY - abY * acX
  return crossX * crossX + crossY * crossY + crossZ * crossZ
}

function collinearSeam(
  positions: Float32Array,
  triangle: Triangle,
): { start: number; middle: number; end: number } | null {
  if (triangleCrossLengthSquared(positions, triangle) > COLLINEAR_SEAM_CROSS_LENGTH_SQ) {
    return null
  }

  const [a, b, c] = triangle
  const edges = [
    { start: a, middle: c, end: b, lengthSquared: distanceSquared(positions, a, b) },
    { start: b, middle: a, end: c, lengthSquared: distanceSquared(positions, b, c) },
    { start: c, middle: b, end: a, lengthSquared: distanceSquared(positions, c, a) },
  ].sort((left, right) => right.lengthSquared - left.lengthSquared)
  const longest = edges[0]!
  if (longest.lengthSquared === 0) return null

  const startOffset = longest.start * 3
  const middleOffset = longest.middle * 3
  const endOffset = longest.end * 3
  const edgeX = positions[endOffset]! - positions[startOffset]!
  const edgeY = positions[endOffset + 1]! - positions[startOffset + 1]!
  const edgeZ = positions[endOffset + 2]! - positions[startOffset + 2]!
  const middleX = positions[middleOffset]! - positions[startOffset]!
  const middleY = positions[middleOffset + 1]! - positions[startOffset + 1]!
  const middleZ = positions[middleOffset + 2]! - positions[startOffset + 2]!
  const projection = middleX * edgeX + middleY * edgeY + middleZ * edgeZ
  if (projection <= 0 || projection >= longest.lengthSquared) return null

  return longest
}

function stitchCollinearSeams(positions: Float32Array, input: Triangle[]): Triangle[] {
  const triangles: Array<Triangle | null> = [...input]

  // Manifold can encode a T-junction as one zero-area triangle: one surface owns the long
  // edge while the other owns its two segments. Split the neighboring face at the middle
  // vertex before removing the collapsed face so indexed edge incidence remains closed.
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const triangle = triangles[triangleIndex]
    if (!triangle) continue
    const seam = collinearSeam(positions, triangle)
    if (!seam) continue

    const matches: Array<{ index: number; edgeOffset: number }> = []
    for (let candidateIndex = 0; candidateIndex < triangles.length; candidateIndex += 1) {
      if (candidateIndex === triangleIndex) continue
      const candidate = triangles[candidateIndex]
      if (
        !candidate ||
        triangleCrossLengthSquared(positions, candidate) <= COLLINEAR_SEAM_CROSS_LENGTH_SQ
      ) {
        continue
      }
      for (let edgeOffset = 0; edgeOffset < 3; edgeOffset += 1) {
        const from = candidate[edgeOffset]!
        const to = candidate[(edgeOffset + 1) % 3]!
        if ((from === seam.start && to === seam.end) || (from === seam.end && to === seam.start)) {
          matches.push({ index: candidateIndex, edgeOffset })
        }
      }
    }
    if (matches.length !== 1) continue

    const match = matches[0]!
    const neighbor = triangles[match.index]!
    const from = neighbor[match.edgeOffset]!
    const to = neighbor[(match.edgeOffset + 1) % 3]!
    const opposite = neighbor[(match.edgeOffset + 2) % 3]!
    triangles[match.index] = [from, seam.middle, opposite]
    triangles.push([seam.middle, to, opposite])
    triangles[triangleIndex] = null
  }

  return triangles.filter((triangle): triangle is Triangle => triangle !== null)
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

  // Float32 boolean output can leave seam vertices just over 10 microns apart. Dropping the
  // resulting sliver triangle by area opens the shell; weld the vertices first so adjacent
  // faces inherit one indexed edge, then remove only triangles collapsed by that topology.
  const cellSize = MANIFOLD_OUTPUT_WELD_EPSILON_METERS
  const cellRoots = new Map<string, number[]>()
  const cellCoordinate = (value: number) => Math.floor(value / cellSize)
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`
  const weldDistanceSquared = cellSize * cellSize
  for (let index = 0; index < mesh.numVert; index += 1) {
    const root = find(index)
    if (root !== index) continue
    const cellX = cellCoordinate(positions[root * 3]!)
    const cellY = cellCoordinate(positions[root * 3 + 1]!)
    const cellZ = cellCoordinate(positions[root * 3 + 2]!)
    let weldedTo: number | null = null
    for (let xOffset = -1; xOffset <= 1 && weldedTo === null; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1 && weldedTo === null; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1 && weldedTo === null; zOffset += 1) {
          const candidates = cellRoots.get(
            cellKey(cellX + xOffset, cellY + yOffset, cellZ + zOffset),
          )
          for (const candidate of candidates ?? []) {
            if (distanceSquared(positions, root, candidate) <= weldDistanceSquared) {
              weldedTo = candidate
              break
            }
          }
        }
      }
    }
    if (weldedTo === null) {
      const key = cellKey(cellX, cellY, cellZ)
      const roots = cellRoots.get(key) ?? []
      roots.push(root)
      cellRoots.set(key, roots)
    } else {
      parents[root] = find(weldedTo)
    }
  }

  const triangles: Triangle[] = []
  for (let index = 0; index + 2 < mesh.triVerts.length; index += 3) {
    const a = find(mesh.triVerts[index]!)
    const b = find(mesh.triVerts[index + 1]!)
    const c = find(mesh.triVerts[index + 2]!)
    if (a === b || b === c || c === a) continue
    triangles.push([a, b, c])
  }
  const indices = stitchCollinearSeams(positions, triangles).flat()

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
