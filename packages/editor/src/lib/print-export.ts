import { HalfEdgeMap } from '@pascal-app/viewer'
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

const MILLIMETERS_PER_METER = 1000
const EDGE_CONNECTIVITY_EPSILON_METERS = 1e-5
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
}

export type PrintExportBounds = {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
  width: number
  depth: number
  height: number
}

export type PrintExportReport = {
  kind: 'print-stl-report'
  version: 1
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
  volumeMm3: number
  diagnostics: PrintExportDiagnostic[]
}

export type PrintStlExport = {
  buffer: ArrayBuffer
  report: PrintExportReport
}

type BoundsMeasurement = {
  min: THREE.Vector3
  max: THREE.Vector3
} | null

type EdgeTopologyMeasurement = {
  boundaryEdgeCount: number | null
  nonManifoldEdgeCount: number | null
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
  return `${Math.round(point.x / EDGE_CONNECTIVITY_EPSILON_METERS)},${Math.round(
    point.y / EDGE_CONNECTIVITY_EPSILON_METERS,
  )},${Math.round(point.z / EDGE_CONNECTIVITY_EPSILON_METERS)}`
}

function addEdge(edges: Map<string, number>, a: THREE.Vector3, b: THREE.Vector3) {
  const keyA = pointKey(a)
  const keyB = pointKey(b)
  const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
  edges.set(key, (edges.get(key) ?? 0) + 1)
}

function analyzeEdgeTopology(root: THREE.Object3D): EdgeTopologyMeasurement {
  const edges = new Map<string, number>()
  const halfEdgePositions: number[] = []
  let edgeCheckComplete = true
  let triangleCount = 0

  forEachTriangle(root, (a, b, c) => {
    triangleCount += 1
    if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) return
    if (edgeCheckComplete && triangleCount > MAX_EDGE_CHECK_TRIANGLES) {
      edges.clear()
      halfEdgePositions.length = 0
      edgeCheckComplete = false
    }
    if (!edgeCheckComplete) return

    addEdge(edges, a, b)
    addEdge(edges, b, c)
    addEdge(edges, c, a)
    halfEdgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  })

  if (!edgeCheckComplete) {
    return { boundaryEdgeCount: null, nonManifoldEdgeCount: null, edgeCheckComplete }
  }

  const connectivityGeometry = new THREE.BufferGeometry()
  connectivityGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float64Array(halfEdgePositions), 3),
  )
  const halfEdges = new HalfEdgeMap() as HalfEdgeMap & {
    matchDisjointEdges: boolean
    degenerateEpsilon: number
    unmatchedEdges: number
  }
  halfEdges.matchDisjointEdges = true
  halfEdges.degenerateEpsilon = EDGE_CONNECTIVITY_EPSILON_METERS
  halfEdges.updateFrom(connectivityGeometry)
  const boundaryEdgeCount = halfEdges.unmatchedEdges
  connectivityGeometry.dispose()

  let nonManifoldEdgeCount = 0
  for (const count of edges.values()) {
    if (count > 2) nonManifoldEdgeCount += 1
  }

  return { boundaryEdgeCount, nonManifoldEdgeCount, edgeCheckComplete }
}

function analyzePrintScene(
  root: THREE.Object3D,
  scale: number,
  edgeTopology: EdgeTopologyMeasurement,
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

  forEachTriangle(root, (a, b, c) => {
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
    signedVolumeMm3 += a.dot(volumeCross) / 6
  })

  const { boundaryEdgeCount, nonManifoldEdgeCount, edgeCheckComplete } = edgeTopology

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
      message: `Edge checks were skipped above ${MAX_EDGE_CHECK_TRIANGLES.toLocaleString()} triangles.`,
    })
  }
  if (triangleCount > 0 && Math.abs(signedVolumeMm3) <= 1e-6) {
    diagnostics.push({
      severity: 'error',
      code: 'zero_volume',
      message: 'The exported surfaces enclose no measurable signed volume.',
    })
  }
  diagnostics.push({
    severity: 'info',
    code: 'compiler_pending',
    message: 'Boolean union, shell intersections, and minimum wall thickness are not checked yet.',
  })

  const status = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? 'blocked'
    : diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
      ? 'warning'
      : 'pass'

  return {
    kind: 'print-stl-report',
    version: 1,
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
    volumeMm3: Math.abs(signedVolumeMm3),
    diagnostics,
  }
}

export function prepareSceneForPrint(
  source: THREE.Object3D,
  options: { scale: number },
): { scene: THREE.Object3D; report: PrintExportReport } {
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new RangeError('Print scale must be a positive finite denominator')
  }

  ensureMeshPositions(source)

  const physicalScale = MILLIMETERS_PER_METER / options.scale
  // Connectivity is invariant under print scale and orientation. Checking it
  // in model-space meters avoids scale-dependent ray tolerances and π/2 drift.
  const edgeTopology = analyzeEdgeTopology(source)

  const scene = new THREE.Group()
  scene.name = 'print-export'
  scene.add(source)
  scene.rotation.x = Math.PI / 2
  scene.scale.setScalar(physicalScale)
  scene.updateMatrixWorld(true)

  const initialBounds = measureBounds(scene)
  if (initialBounds) {
    scene.position.set(
      -(initialBounds.min.x + initialBounds.max.x) / 2,
      -(initialBounds.min.y + initialBounds.max.y) / 2,
      -initialBounds.min.z,
    )
    scene.updateMatrixWorld(true)
  }

  return { scene, report: analyzePrintScene(scene, options.scale, edgeTopology) }
}

export function exportSceneToPrintStl(
  source: THREE.Object3D,
  options: { scale: number },
): PrintStlExport {
  const { scene, report } = prepareSceneForPrint(source, options)
  const exporter = new STLExporter()
  const output = exporter.parse(scene, { binary: true }) as ArrayBuffer | DataView
  const buffer =
    output instanceof DataView
      ? (output.buffer.slice(
          output.byteOffset,
          output.byteOffset + output.byteLength,
        ) as ArrayBuffer)
      : output
  return { buffer, report }
}

export function isPrintExportReport(value: unknown): value is PrintExportReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<PrintExportReport>
  return report.kind === 'print-stl-report' && report.version === 1
}
