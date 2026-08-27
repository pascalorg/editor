import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { HalfEdgeMap } from 'three-bvh-csg'

const MILLIMETERS_PER_METER = 1000
const EDGE_CONNECTIVITY_EPSILON_METERS = 1e-5
const EDGE_INCIDENCE_EPSILON_METERS = 1e-7
const MAX_EDGE_CHECK_TRIANGLES = 500_000
const DEGENERATE_CROSS_LENGTH_SQ = 1e-12

const EMPTY_POSITION_GEOMETRY = new THREE.BufferGeometry()
EMPTY_POSITION_GEOMETRY.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(new Float32Array(0), 3),
)

export type PrintExportDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  nodeIds?: string[]
}

export type PrintArtifactFormat = 'stl' | '3mf'

export type PrintExportOptions = {
  scale: number
  compiled?: boolean
  indexedTopology?: boolean
  format?: PrintArtifactFormat
  /** Original Y-up world elevation that becomes print Z=0. Omit to use geometry minimum. */
  sourceBedElevationMeters?: number
}

export type PrintExportBounds = {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
  width: number
  depth: number
  height: number
}

export type PrintExportReport = {
  kind: 'print-export-report'
  version: 2
  format: PrintArtifactFormat
  scale: number
  units: 'millimeter'
  orientation: 'z-up'
  status: 'pass' | 'warning' | 'blocked'
  bounds: PrintExportBounds | null
  triangleCount: number
  invalidTriangleCount: number
  degenerateTriangleCount: number
  boundaryEdgeCount: number | null
  nonManifoldEdgeCount: number | null
  connectedComponentCount: number | null
  solidComponentCount: number | null
  invertedWinding: boolean | null
  volumeMm3: number
  minimumFeatureThicknessMm?: number | null
  diagnostics: PrintExportDiagnostic[]
}

export type PrintStlExport = {
  buffer: ArrayBuffer
  report: PrintExportReport
}

export type PrintMeshData = {
  positions: Float64Array<ArrayBuffer>
  indices: Uint32Array<ArrayBuffer>
}

type BoundsMeasurement = {
  min: THREE.Vector3
  max: THREE.Vector3
} | null

type EdgeTopologyMeasurement = {
  boundaryEdgeCount: number | null
  nonManifoldEdgeCount: number | null
  connectedComponentCount: number | null
  componentIndexByTriangle: Int32Array<ArrayBuffer> | null
  edgeCheckComplete: boolean
}

function ensureMeshPositions(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && !mesh.geometry?.getAttribute('position')) {
      mesh.geometry = EMPTY_POSITION_GEOMETRY
    }
  })
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function forEachTriangle(
  root: THREE.Object3D,
  visit: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void,
) {
  root.updateMatrixWorld(true)

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return

    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const index = mesh.geometry.index
    const skinnedMesh = mesh as THREE.SkinnedMesh

    const readVertex = (vertexIndex: number, target: THREE.Vector3) => {
      target.fromBufferAttribute(position, vertexIndex)
      if (skinnedMesh.isSkinnedMesh) skinnedMesh.applyBoneTransform(vertexIndex, target)
      target.applyMatrix4(mesh.matrixWorld)
    }

    const visitIndices = (indexA: number, indexB: number, indexC: number) => {
      readVertex(indexA, a)
      readVertex(indexB, b)
      readVertex(indexC, c)
      visit(a, b, c)
    }

    if (index) {
      for (let offset = 0; offset + 2 < index.count; offset += 3) {
        visitIndices(index.getX(offset), index.getX(offset + 1), index.getX(offset + 2))
      }
      return
    }

    for (let offset = 0; offset + 2 < position.count; offset += 3) {
      visitIndices(offset, offset + 1, offset + 2)
    }
  })
}

function measureBounds(root: THREE.Object3D): BoundsMeasurement {
  const min = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  )
  const max = new THREE.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  )
  let hasFiniteTriangle = false

  forEachTriangle(root, (a, b, c) => {
    if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) return
    min.min(a).min(b).min(c)
    max.max(a).max(b).max(c)
    hasFiniteTriangle = true
  })

  return hasFiniteTriangle ? { min, max } : null
}

function pointKey(point: THREE.Vector3): string {
  return `${Math.round(point.x / EDGE_INCIDENCE_EPSILON_METERS)},${Math.round(
    point.y / EDGE_INCIDENCE_EPSILON_METERS,
  )},${Math.round(point.z / EDGE_INCIDENCE_EPSILON_METERS)}`
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const keyA = pointKey(a)
  const keyB = pointKey(b)
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
}

function indexedNonManifoldEdgeCount(root: THREE.Object3D): number | null {
  let hasGeometry = false
  let nonManifoldEdgeCount = 0
  for (const object of root.children) object.updateMatrixWorld(true)

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position')
    if (!position || position.count === 0) return
    const index = mesh.geometry.getIndex()
    if (!index) {
      nonManifoldEdgeCount = Number.NaN
      return
    }
    hasGeometry = true
    const edges = new Map<string, number>()
    const add = (a: number, b: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
    for (let offset = 0; offset + 2 < index.count; offset += 3) {
      const a = index.getX(offset)
      const b = index.getX(offset + 1)
      const c = index.getX(offset + 2)
      add(a, b)
      add(b, c)
      add(c, a)
    }
    for (const uses of edges.values()) {
      if (uses > 2) nonManifoldEdgeCount += 1
    }
  })

  return hasGeometry && Number.isFinite(nonManifoldEdgeCount) ? nonManifoldEdgeCount : null
}

function analyzeEdgeTopology(
  root: THREE.Object3D,
  useIndexedIncidence: boolean,
): EdgeTopologyMeasurement {
  const edges = new Map<string, number>()
  const halfEdgePositions: number[] = []
  const topologyTriangleIndices: number[] = []
  const componentParents: number[] = []
  const componentRanks: number[] = []
  let edgeCheckComplete = true
  let triangleCount = 0

  const findComponent = (triangleIndex: number): number => {
    let root = triangleIndex
    while (componentParents[root] !== root) root = componentParents[root]!
    let current = triangleIndex
    while (componentParents[current] !== root) {
      const parent = componentParents[current]!
      componentParents[current] = root
      current = parent
    }
    return root
  }

  const unionComponents = (first: number, second: number) => {
    let firstRoot = findComponent(first)
    let secondRoot = findComponent(second)
    if (firstRoot === secondRoot) return
    const firstRank = componentRanks[firstRoot] ?? 0
    const secondRank = componentRanks[secondRoot] ?? 0
    if (firstRank < secondRank) [firstRoot, secondRoot] = [secondRoot, firstRoot]
    componentParents[secondRoot] = firstRoot
    if (firstRank === secondRank) componentRanks[firstRoot] = firstRank + 1
  }

  const addConnectedEdge = (a: THREE.Vector3, b: THREE.Vector3, triangleIndex: number) => {
    const key = edgeKey(a, b)
    const encoded = edges.get(key)
    if (encoded === undefined) {
      edges.set(key, triangleIndex * 4 + 1)
      return
    }
    const firstTriangle = Math.floor(encoded / 4)
    const uses = encoded % 4
    unionComponents(firstTriangle, triangleIndex)
    edges.set(key, firstTriangle * 4 + Math.min(uses + 1, 3))
  }

  forEachTriangle(root, (a, b, c) => {
    const triangleIndex = triangleCount
    triangleCount += 1
    if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) return
    if (edgeCheckComplete && triangleCount > MAX_EDGE_CHECK_TRIANGLES) {
      edges.clear()
      halfEdgePositions.length = 0
      topologyTriangleIndices.length = 0
      componentParents.length = 0
      componentRanks.length = 0
      edgeCheckComplete = false
    }
    if (!edgeCheckComplete) return

    componentParents[triangleIndex] = triangleIndex
    componentRanks[triangleIndex] = 0
    addConnectedEdge(a, b, triangleIndex)
    addConnectedEdge(b, c, triangleIndex)
    addConnectedEdge(c, a, triangleIndex)
    topologyTriangleIndices.push(triangleIndex)
    halfEdgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  })

  if (!edgeCheckComplete) {
    return {
      boundaryEdgeCount: null,
      nonManifoldEdgeCount: null,
      connectedComponentCount: null,
      componentIndexByTriangle: null,
      edgeCheckComplete,
    }
  }

  const connectivityGeometry = new THREE.BufferGeometry()
  connectivityGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float64Array(halfEdgePositions), 3),
  )
  const halfEdges = new HalfEdgeMap() as HalfEdgeMap & {
    data: Int32Array<ArrayBuffer>
    disjointConnections: Map<number, number[]> | null
    matchDisjointEdges: boolean
    degenerateEpsilon: number
    unmatchedEdges: number
  }
  halfEdges.matchDisjointEdges = true
  halfEdges.degenerateEpsilon = EDGE_CONNECTIVITY_EPSILON_METERS
  halfEdges.updateFrom(connectivityGeometry)
  const boundaryEdgeCount = halfEdges.unmatchedEdges
  for (let localEdgeIndex = 0; localEdgeIndex < halfEdges.data.length; localEdgeIndex += 1) {
    const triangleIndex = topologyTriangleIndices[Math.floor(localEdgeIndex / 3)]
    if (triangleIndex === undefined) continue
    const siblingEdgeIndex = halfEdges.data[localEdgeIndex] ?? -1
    if (siblingEdgeIndex >= 0) {
      const siblingTriangleIndex = topologyTriangleIndices[Math.floor(siblingEdgeIndex / 3)]
      if (siblingTriangleIndex !== undefined) unionComponents(triangleIndex, siblingTriangleIndex)
    }
    for (const disjointEdgeIndex of halfEdges.disjointConnections?.get(localEdgeIndex) ?? []) {
      const disjointTriangleIndex = topologyTriangleIndices[Math.floor(disjointEdgeIndex / 3)]
      if (disjointTriangleIndex !== undefined) unionComponents(triangleIndex, disjointTriangleIndex)
    }
  }
  connectivityGeometry.dispose()

  const componentIndexByTriangle = new Int32Array(triangleCount)
  componentIndexByTriangle.fill(-1)
  const componentIndexByRoot = new Map<number, number>()
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    if (componentParents[triangleIndex] === undefined) continue
    const root = findComponent(triangleIndex)
    let componentIndex = componentIndexByRoot.get(root)
    if (componentIndex === undefined) {
      componentIndex = componentIndexByRoot.size
      componentIndexByRoot.set(root, componentIndex)
    }
    componentIndexByTriangle[triangleIndex] = componentIndex
  }

  let nonManifoldEdgeCount = useIndexedIncidence ? indexedNonManifoldEdgeCount(root) : null
  if (nonManifoldEdgeCount === null) {
    nonManifoldEdgeCount = 0
    for (const encoded of edges.values()) {
      if (encoded % 4 > 2) nonManifoldEdgeCount += 1
    }
  }

  return {
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    connectedComponentCount: componentIndexByRoot.size,
    componentIndexByTriangle,
    edgeCheckComplete,
  }
}

function analyzePrintScene(
  root: THREE.Object3D,
  scale: number,
  edgeTopology: EdgeTopologyMeasurement,
  compiled: boolean,
  format: PrintArtifactFormat,
): PrintExportReport {
  const min = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  )
  const max = new THREE.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  )
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const areaCross = new THREE.Vector3()
  const volumeCross = new THREE.Vector3()
  let triangleCount = 0
  let invalidTriangleCount = 0
  let degenerateTriangleCount = 0
  let signedVolumeMm3 = 0
  let hasFiniteTriangle = false
  const componentSignedVolumesMm3 =
    edgeTopology.connectedComponentCount === null
      ? null
      : Array.from({ length: edgeTopology.connectedComponentCount }, () => 0)

  forEachTriangle(root, (a, b, c) => {
    const triangleIndex = triangleCount
    triangleCount += 1
    if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) {
      invalidTriangleCount += 1
      return
    }

    min.min(a).min(b).min(c)
    max.max(a).max(b).max(c)
    hasFiniteTriangle = true

    ab.subVectors(b, a)
    ac.subVectors(c, a)
    areaCross.crossVectors(ab, ac)
    if (areaCross.lengthSq() <= DEGENERATE_CROSS_LENGTH_SQ) {
      degenerateTriangleCount += 1
    }

    volumeCross.crossVectors(b, c)
    const triangleVolumeMm3 = a.dot(volumeCross) / 6
    signedVolumeMm3 += triangleVolumeMm3
    const componentIndex = edgeTopology.componentIndexByTriangle?.[triangleIndex] ?? -1
    if (componentSignedVolumesMm3 && componentIndex >= 0) {
      componentSignedVolumesMm3[componentIndex] =
        (componentSignedVolumesMm3[componentIndex] ?? 0) + triangleVolumeMm3
    }
  })

  const { boundaryEdgeCount, nonManifoldEdgeCount, connectedComponentCount, edgeCheckComplete } =
    edgeTopology
  const hasClosedTopology =
    edgeCheckComplete &&
    boundaryEdgeCount === 0 &&
    nonManifoldEdgeCount === 0 &&
    invalidTriangleCount === 0 &&
    degenerateTriangleCount === 0
  const solidComponentCount =
    hasClosedTopology && componentSignedVolumesMm3
      ? componentSignedVolumesMm3.filter((volume) => volume > 1e-6).length
      : null
  const inwardComponentCount =
    hasClosedTopology && componentSignedVolumesMm3
      ? componentSignedVolumesMm3.filter((volume) => volume < -1e-6).length
      : null
  const invertedWinding = hasClosedTopology && triangleCount > 0 ? signedVolumeMm3 < -1e-6 : null

  const bounds = hasFiniteTriangle
    ? {
        min: { x: min.x, y: min.y, z: min.z },
        max: { x: max.x, y: max.y, z: max.z },
        width: max.x - min.x,
        depth: max.y - min.y,
        height: max.z - min.z,
      }
    : null

  const diagnostics: PrintExportDiagnostic[] = []
  if (triangleCount === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'no_triangles',
      message: 'No printable triangles remain after applying the export scope.',
    })
  }
  if (invalidTriangleCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'non_finite_geometry',
      message: `${invalidTriangleCount.toLocaleString()} triangle${
        invalidTriangleCount === 1 ? '' : 's'
      } contain non-finite coordinates.`,
    })
  }
  if (degenerateTriangleCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'degenerate_triangles',
      message: `${degenerateTriangleCount.toLocaleString()} zero-area or near-zero-area triangle${
        degenerateTriangleCount === 1 ? '' : 's'
      } prevent a print-ready artifact.`,
    })
  }
  if (boundaryEdgeCount && boundaryEdgeCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'open_boundaries',
      message: `${boundaryEdgeCount.toLocaleString()} boundary edge${
        boundaryEdgeCount === 1 ? '' : 's'
      } leave the exported surface open.`,
    })
  }
  if (nonManifoldEdgeCount && nonManifoldEdgeCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'non_manifold_edges',
      message: `${nonManifoldEdgeCount.toLocaleString()} edge${
        nonManifoldEdgeCount === 1 ? '' : 's'
      } are shared by more than two triangles and must be repaired.`,
    })
  }
  if (!edgeCheckComplete) {
    diagnostics.push({
      severity: 'warning',
      code: 'edge_check_skipped',
      message: `Edge and connected-component checks were skipped above ${MAX_EDGE_CHECK_TRIANGLES.toLocaleString()} triangles.`,
    })
  }
  if (solidComponentCount !== null && solidComponentCount > 1) {
    diagnostics.push({
      severity: compiled ? 'error' : 'warning',
      code: 'disconnected_solids',
      message: `${solidComponentCount.toLocaleString()} disconnected outward solid components remain in this ${compiled ? 'compiled part' : 'export'}. ${
        compiled
          ? 'Each printable level must be one physically connected solid.'
          : 'Use structure compilation or split them into separate printable parts.'
      }`,
    })
  } else if (
    connectedComponentCount !== null &&
    connectedComponentCount > 1 &&
    inwardComponentCount !== null &&
    inwardComponentCount > 0
  ) {
    diagnostics.push({
      severity: 'warning',
      code: 'inward_surface_components',
      message: `${connectedComponentCount.toLocaleString()} connected surface shells include ${inwardComponentCount.toLocaleString()} inward-oriented shell${
        inwardComponentCount === 1 ? '' : 's'
      }. These may be sealed cavities; inspect the sliced layers before printing.`,
    })
  }
  if (invertedWinding) {
    diagnostics.push({
      severity: 'error',
      code: 'inverted_winding',
      message: 'The closed surface has globally inverted face winding and must be reoriented.',
    })
  }
  if (triangleCount > 0 && Math.abs(signedVolumeMm3) <= 1e-6) {
    diagnostics.push({
      severity: 'error',
      code: 'zero_volume',
      message: 'The exported surfaces enclose no measurable signed volume.',
    })
  }
  diagnostics.push(
    compiled
      ? {
          severity: 'info',
          code: 'compiler_limits',
          message:
            'The shell was boolean-unioned, but self-intersections and minimum wall thickness are not checked yet.',
        }
      : {
          severity: 'info',
          code: 'compiler_pending',
          message:
            'Boolean union, shell intersections, and minimum wall thickness are not checked yet.',
        },
  )

  const status = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? 'blocked'
    : diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
      ? 'warning'
      : 'pass'

  return {
    kind: 'print-export-report',
    version: 2,
    format,
    scale,
    units: 'millimeter',
    orientation: 'z-up',
    status,
    bounds,
    triangleCount,
    invalidTriangleCount,
    degenerateTriangleCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    connectedComponentCount,
    solidComponentCount,
    invertedWinding,
    volumeMm3: Math.abs(signedVolumeMm3),
    diagnostics,
  }
}

export function prepareSceneForPrint(
  source: THREE.Object3D,
  options: PrintExportOptions,
): { scene: THREE.Object3D; report: PrintExportReport } {
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new RangeError('Print scale must be a positive finite denominator')
  }
  if (
    options.sourceBedElevationMeters !== undefined &&
    !Number.isFinite(options.sourceBedElevationMeters)
  ) {
    throw new RangeError('Print bed elevation must be finite')
  }

  ensureMeshPositions(source)

  const physicalScale = MILLIMETERS_PER_METER / options.scale
  // Connectivity is invariant under print scale and orientation. Checking it
  // in model-space meters avoids scale-dependent ray tolerances and π/2 drift.
  const edgeTopology = analyzeEdgeTopology(source, options.indexedTopology ?? false)

  const scene = new THREE.Group()
  scene.name = 'print-export'
  scene.add(source)
  scene.rotation.x = Math.PI / 2
  scene.scale.setScalar(physicalScale)
  scene.updateMatrixWorld(true)

  const initialBounds = measureBounds(scene)
  if (initialBounds) {
    const bedElevation =
      options.sourceBedElevationMeters === undefined
        ? initialBounds.min.z
        : options.sourceBedElevationMeters * physicalScale
    scene.position.set(
      -(initialBounds.min.x + initialBounds.max.x) / 2,
      -(initialBounds.min.y + initialBounds.max.y) / 2,
      -bedElevation,
    )
    scene.updateMatrixWorld(true)
  }

  return {
    scene,
    report: analyzePrintScene(
      scene,
      options.scale,
      edgeTopology,
      options.compiled ?? false,
      options.format ?? 'stl',
    ),
  }
}

export function extractPreparedPrintMesh(root: THREE.Object3D): PrintMeshData {
  root.updateMatrixWorld(true)

  const positions: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return

    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const index = mesh.geometry.getIndex()
    const skinnedMesh = mesh as THREE.SkinnedMesh
    const outputIndexByPosition = new Map<string, number>()

    const outputIndexFor = (vertexIndex: number): number => {
      point.fromBufferAttribute(position, vertexIndex)
      if (skinnedMesh.isSkinnedMesh) skinnedMesh.applyBoneTransform(vertexIndex, point)
      point.applyMatrix4(mesh.matrixWorld)
      if (!isFiniteVector(point)) {
        throw new RangeError(
          'Print geometry contains non-finite coordinates and cannot be encoded.',
        )
      }

      const x = Object.is(point.x, -0) ? 0 : point.x
      const y = Object.is(point.y, -0) ? 0 : point.y
      const z = Object.is(point.z, -0) ? 0 : point.z
      const key = `${x},${y},${z}`
      const existing = outputIndexByPosition.get(key)
      if (existing !== undefined) return existing

      const next = positions.length / 3
      positions.push(x, y, z)
      outputIndexByPosition.set(key, next)
      return next
    }

    const appendTriangle = (a: number, b: number, c: number) => {
      indices.push(outputIndexFor(a), outputIndexFor(b), outputIndexFor(c))
    }

    if (index) {
      for (let offset = 0; offset + 2 < index.count; offset += 3) {
        appendTriangle(index.getX(offset), index.getX(offset + 1), index.getX(offset + 2))
      }
      return
    }

    for (let offset = 0; offset + 2 < position.count; offset += 3) {
      appendTriangle(offset, offset + 1, offset + 2)
    }
  })

  return {
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
  }
}

export function encodePreparedPrintSceneToStl(scene: THREE.Object3D): ArrayBuffer {
  const exporter = new STLExporter()
  const output = exporter.parse(scene, { binary: true }) as ArrayBuffer | DataView
  return output instanceof DataView
    ? (output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer)
    : output
}

export function exportSceneToPrintStl(
  source: THREE.Object3D,
  options: PrintExportOptions,
): PrintStlExport {
  const { scene, report } = prepareSceneForPrint(source, options)
  return { buffer: encodePreparedPrintSceneToStl(scene), report }
}

export function mergePrintExportDiagnostics(
  report: PrintExportReport,
  diagnostics: PrintExportDiagnostic[],
  omitCodes: ReadonlySet<string> = new Set(),
): PrintExportReport {
  const merged = [
    ...report.diagnostics.filter((diagnostic) => !omitCodes.has(diagnostic.code)),
    ...diagnostics,
  ]
  const status = merged.some((diagnostic) => diagnostic.severity === 'error')
    ? 'blocked'
    : merged.some((diagnostic) => diagnostic.severity === 'warning')
      ? 'warning'
      : 'pass'
  return { ...report, status, diagnostics: merged }
}

export function isPrintExportReport(value: unknown): value is PrintExportReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<PrintExportReport>
  return report.kind === 'print-export-report' && report.version === 2
}
