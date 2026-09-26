/**
 * VECTOR EDGES FROM THE VIEWER — the elevation's lines taken from the same
 * meshes the picture is rendered from, with hidden-line removal.
 *
 * A drawing built from a second model of the house (plugin-sections' solids)
 * never quite matches the render: its roof sat on the plate plane while the
 * 3D roof stacks a deck and shingles on it, its door was the opening while
 * the render showed the leaf. This is how Revit and Chief Architect avoid
 * that — ONE model, the view's lines derived from it:
 *
 *   1. every visible mesh's FEATURE EDGES (creases over `thresholdDeg`,
 *      boundaries — three's EdgesGeometry, cached per geometry), carried
 *      to world space, instance by instance for Bones' InstancedMeshes;
 *   2. a DEPTH pass of the scene through the capture camera — view-space
 *      depth as a float colour, read back once;
 *   3. each edge projected through that camera and SAMPLED along its length
 *      against the depth buffer: a point deeper than what the buffer saw is
 *      behind something. The visible runs come back as world segments.
 *
 * Orthographic only (an elevation, a section): depth is linear across a face
 * so the interpolated edge depth is exact. Not a boolean operation — an
 * edge test, cheap enough to run at capture time.
 */
import * as THREE from 'three'
import { normalView, positionView, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu'

export type VisibleEdges = {
  /** World-space segments, six floats each: ax ay az bx by bz. */
  segments: Float32Array
  count: number
  /** How many candidate edges were tested, and the depth pass' size. */
  tested: number
  width: number
  height: number
  ms: number
  /** Whether the normal pass came back (without it every in-view edge is kept). */
  normals: boolean
}

const edgeCache = new WeakMap<THREE.BufferGeometry, Float32Array | null>()

/** The feature edges of a geometry, local space, as pairs of points (cached; null when the geometry is too heavy). */
function featureEdgesOf(geometry: THREE.BufferGeometry, thresholdDeg: number, maxTriangles: number): Float32Array | null {
  const cached = edgeCache.get(geometry)
  if (cached !== undefined) return cached
  const position = geometry.getAttribute('position')
  if (!position) {
    edgeCache.set(geometry, null)
    return null
  }
  const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3
  if (triangles > maxTriangles) {
    edgeCache.set(geometry, null)
    return null
  }
  let edges: Float32Array | null = null
  try {
    const eg = new THREE.EdgesGeometry(geometry, thresholdDeg)
    const attr = eg.getAttribute('position')
    edges = attr ? new Float32Array(attr.array as ArrayLike<number>) : null
    eg.dispose()
  } catch {
    edges = null
  }
  edgeCache.set(geometry, edges)
  return edges
}

function isShown(object: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = object
  while (o) {
    if (!o.visible) return false
    o = o.parent
  }
  return true
}

/**
 * Whether a material draws anything. `colorWrite: false` is how a pick-only
 * collider hides on the GPU (Bones' utility-pole proxy, 0.5 × 10.7 m, once
 * drew a tall rectangle through the elevations, 2026-09-23 — the rule
 * glb-export's `isRenderableMesh` already follows).
 */
export function materialShows(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material]
  return list.some(
    (m) => m && m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity <= 0.02),
  )
}

/**
 * The shown meshes whose own materials draw nothing — pick proxies, hit
 * boxes — hidden for the length of the buffer passes: under the passes'
 * override material they would write depth and hide the real edges behind
 * them. The returned function shows them again.
 */
export function hideUndrawnMeshes(scene: THREE.Object3D): () => void {
  const hidden: THREE.Object3D[] = []
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible || materialShows(mesh.material)) return
    mesh.visible = false
    hidden.push(mesh)
  })
  return () => {
    for (const mesh of hidden) mesh.visible = true
  }
}

/**
 * One pass of the scene through `material` into a float target, read back:
 * the depth pass writes view-space depth (metres in front of the camera) in
 * red; the normal pass the view-space normal in RGB.
 */
async function bufferPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  colorNode: unknown,
): Promise<{ data: Float32Array; topDown: boolean } | null> {
  const material = new MeshBasicNodeMaterial()
  material.colorNode = colorNode as never
  material.side = THREE.DoubleSide
  material.transparent = false
  material.depthTest = true
  material.depthWrite = true
  const target = new RenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  })
  const gl = renderer as unknown as {
    getRenderTarget: () => unknown
    setRenderTarget: (t: unknown) => void
    getClearColor: (c: THREE.Color) => THREE.Color
    getClearAlpha: () => number
    setClearColor: (c: THREE.Color | number, a?: number) => void
    renderAsync: (s: THREE.Scene, c: THREE.Camera) => Promise<void>
    readRenderTargetPixelsAsync: (t: unknown, x: number, y: number, w: number, h: number) => Promise<ArrayLike<number>>
    backend?: { device?: unknown }
  }
  const previousTarget = gl.getRenderTarget()
  const previousOverride = scene.overrideMaterial
  const previousClear = gl.getClearColor(new THREE.Color())
  const previousAlpha = gl.getClearAlpha()
  try {
    scene.overrideMaterial = material
    gl.setClearColor(new THREE.Color(0, 0, 0), 0)
    gl.setRenderTarget(target)
    await gl.renderAsync(scene, camera)
    gl.setRenderTarget(null)
    const raw = await gl.readRenderTargetPixelsAsync(target, 0, 0, width, height)
    const data = raw instanceof Float32Array ? raw : new Float32Array(raw)
    if (data.length < width * height * 4) return null
    // WebGPU reads rows top-down; the WebGL fallback bottom-up
    return { data, topDown: Boolean(gl.backend?.device) }
  } catch (error) {
    console.warn('[vector-edges] buffer pass failed', error)
    return null
  } finally {
    scene.overrideMaterial = previousOverride
    gl.setClearColor(previousClear, previousAlpha)
    gl.setRenderTarget(previousTarget)
    target.dispose()
    material.dispose()
  }
}

/**
 * Every drawn mesh's feature edges in world space, six floats per edge —
 * instance by instance for an InstancedMesh. What draws nothing (a hidden
 * mesh, a pick proxy, a layer the camera does not see) has no lines.
 */
export function candidateEdges(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  thresholdDeg: number,
  maxTriangles: number,
): number[] {
  const world: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const instance = new THREE.Matrix4()
  const composed = new THREE.Matrix4()
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return
    if (!camera.layers.test(mesh.layers)) return
    if (!isShown(mesh) || !materialShows(mesh.material)) return
    const edges = featureEdgesOf(mesh.geometry, thresholdDeg, maxTriangles)
    if (!edges || edges.length < 6) return
    const instanced = mesh as unknown as THREE.InstancedMesh
    const matrices: THREE.Matrix4[] = []
    if (instanced.isInstancedMesh) {
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, instance)
        matrices.push(composed.copy(mesh.matrixWorld).multiply(instance).clone())
      }
    } else {
      matrices.push(mesh.matrixWorld)
    }
    for (const m of matrices) {
      for (let i = 0; i + 5 < edges.length; i += 6) {
        a.set(edges[i] as number, edges[i + 1] as number, edges[i + 2] as number).applyMatrix4(m)
        b.set(edges[i + 3] as number, edges[i + 4] as number, edges[i + 5] as number).applyMatrix4(m)
        world.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
  })
  return world
}

/**
 * The visible feature edges of `scene` through `camera` (orthographic), as
 * world segments. `width` sets the depth pass (a multiple of 16 keeps the
 * WebGPU readback rows unpadded); `height` follows the camera's aspect.
 */
export async function extractVisibleEdges(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  options: { width?: number; thresholdDeg?: number; maxTriangles?: number; bias?: number } = {},
): Promise<VisibleEdges | null> {
  const started = performance.now()
  const thresholdDeg = options.thresholdDeg ?? 20
  const maxTriangles = options.maxTriangles ?? 400_000
  const aspect = (camera.right - camera.left) / Math.max(1e-6, camera.top - camera.bottom)
  const width = Math.max(16, Math.round((options.width ?? 2048) / 16) * 16)
  const height = Math.max(16, Math.round(width / aspect / 16) * 16)
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)

  const showUndrawn = hideUndrawnMeshes(scene)
  let pass: Awaited<ReturnType<typeof bufferPass>>
  let normalPass: Awaited<ReturnType<typeof bufferPass>> = null
  try {
    pass = await bufferPass(renderer, scene, camera, width, height, vec4(positionView.z.negate(), 0, 0, 1))
    if (pass) normalPass = await bufferPass(renderer, scene, camera, width, height, vec4(normalView, 1))
  } finally {
    showUndrawn()
  }
  if (!pass) return null
  const { data: depth, topDown } = pass
  const normals = normalPass?.data ?? null

  const world = candidateEdges(scene, camera, thresholdDeg, maxTriangles)

  // ── the visibility test ──────────────────────────────────────────────
  const view = camera.matrixWorldInverse
  const proj = camera.projectionMatrix
  const bias = options.bias ?? 0.008
  const out: number[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const indexAt = (px: number, py: number): number => {
    const x = Math.floor(px)
    const y = Math.floor(py)
    if (x < 0 || y < 0 || x >= width || y >= height) return -1
    const row = topDown ? y : height - 1 - y
    return (row * width + x) * 4
  }
  const sampleAt = (px: number, py: number): number => {
    const k = indexAt(px, py)
    return k < 0 ? Number.POSITIVE_INFINITY : (depth[k] as number)
  }
  // A line is only a line where the render CHANGES across it: a step in
  // depth (a silhouette, a reveal, the far side of a box) or a crease in
  // the normal (wall meets roof, the corner of a post). A flat face's own
  // triangulation — the CSG walls come with T-junctions, so the edge
  // finder cannot pair those triangles — shows neither and is dropped.
  const CREASE = Math.cos((15 * Math.PI) / 180)
  const ACROSS = 2
  const featureAt = (px: number, py: number, nx: number, ny: number): boolean => {
    const c = sampleAt(px, py)
    const l = sampleAt(px + nx * ACROSS, py + ny * ACROSS)
    const r = sampleAt(px - nx * ACROSS, py - ny * ACROSS)
    // the sky on either side, or off the frame: a silhouette
    if (c === 0 || l === 0 || r === 0) return true
    if (!Number.isFinite(l) || !Number.isFinite(r) || !Number.isFinite(c)) return true
    // a step, not a slope: the second difference is zero on any plane
    if (Math.abs(l + r - 2 * c) > 0.012) return true
    if (!normals) return true
    const kl = indexAt(px + nx * ACROSS, py + ny * ACROSS)
    const kr = indexAt(px - nx * ACROSS, py - ny * ACROSS)
    if (kl < 0 || kr < 0) return true
    // unsigned: a CSG face's triangles may wind either way, and a flipped
    // normal on a flat wall is not a corner
    const dot =
      (normals[kl] as number) * (normals[kr] as number) +
      (normals[kl + 1] as number) * (normals[kr + 1] as number) +
      (normals[kl + 2] as number) * (normals[kr + 2] as number)
    return Math.abs(dot) < CREASE
  }
  const tested = world.length / 6
  for (let i = 0; i + 5 < world.length; i += 6) {
    va.set(world[i] as number, world[i + 1] as number, world[i + 2] as number).applyMatrix4(view)
    vb.set(world[i + 3] as number, world[i + 4] as number, world[i + 5] as number).applyMatrix4(view)
    const da = -va.z
    const db = -vb.z
    if (da <= camera.near && db <= camera.near) continue
    pa.copy(va).applyMatrix4(proj)
    pb.copy(vb).applyMatrix4(proj)
    const ax = ((pa.x + 1) / 2) * width
    const ay = ((1 - pa.y) / 2) * height
    const bx = ((pb.x + 1) / 2) * width
    const by = ((1 - pb.y) / 2) * height
    // wholly off the frame: nothing to test
    if ((ax < 0 && bx < 0) || (ax >= width && bx >= width) || (ay < 0 && by < 0) || (ay >= height && by >= height)) {
      continue
    }
    const lengthPx = Math.hypot(bx - ax, by - ay)
    const n = Math.min(4096, Math.max(2, Math.ceil(lengthPx)))
    const slope = Math.abs(db - da) / n
    const tolerance = bias + slope * 1.5
    // the screen-space perpendicular, to look across the edge
    const nx = lengthPx > 1e-6 ? -(by - ay) / lengthPx : 1
    const ny = lengthPx > 1e-6 ? (bx - ax) / lengthPx : 0
    let runStart = -1
    let gap = 0
    const emit = (t0: number, t1: number) => {
      if (t1 - t0 <= 0) return
      out.push(
        (world[i] as number) + ((world[i + 3] as number) - (world[i] as number)) * t0,
        (world[i + 1] as number) + ((world[i + 4] as number) - (world[i + 1] as number)) * t0,
        (world[i + 2] as number) + ((world[i + 5] as number) - (world[i + 2] as number)) * t0,
        (world[i] as number) + ((world[i + 3] as number) - (world[i] as number)) * t1,
        (world[i + 1] as number) + ((world[i + 4] as number) - (world[i + 1] as number)) * t1,
        (world[i + 2] as number) + ((world[i + 5] as number) - (world[i + 2] as number)) * t1,
      )
    }
    for (let s = 0; s <= n; s++) {
      const t = s / n
      const px = ax + (bx - ax) * t
      const py = ay + (by - ay) * t
      const d = da + (db - da) * t
      const seen = sampleAt(px, py)
      // the background (nothing drawn) reads 0; off the frame reads Infinity — both leave the edge in view
      const inView = seen === 0 || seen === Number.POSITIVE_INFINITY || d <= seen + tolerance
      const visible = inView && featureAt(px, py, nx, ny)
      if (visible) {
        if (runStart < 0) runStart = t
        gap = 0
      } else if (runStart >= 0) {
        // a single hidden sample inside a run is rasterisation noise, not an occluder
        gap++
        if (gap > 1) {
          emit(runStart, (s - gap) / n)
          runStart = -1
          gap = 0
        }
      }
    }
    if (runStart >= 0) emit(runStart, 1)
  }
  return {
    segments: new Float32Array(out),
    count: out.length / 6,
    tested,
    width,
    height,
    ms: Math.round(performance.now() - started),
    normals: normals !== null,
  }
}
