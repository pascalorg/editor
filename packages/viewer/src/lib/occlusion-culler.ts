import * as THREE from 'three'
import { BATCHED_LAYER, SCENE_LAYER } from './layers'
import { timeSpan } from './perf-tracks'
import { isSetAsideForRender } from './scene-matrices'
import { heldReasons } from './scene-visibility'

/**
 * CPU occlusion culling for baked artifacts. Each time the eye moves, the building's big opaque
 * surfaces (walls, slabs, roofs, ceilings) are rasterized into a small depth image from the
 * camera; every drawn mesh whose box lies wholly behind that image is left out of the color
 * passes for that render. A level's floor then hides the furniture, walls and windows of the
 * levels under it, and a facade hides the rooms behind it, for a few milliseconds of CPU
 * instead of hundreds of draw encodes.
 *
 * The result is exact for the frame it is computed in (no readback, no one-frame lag, so
 * nothing pops in late), and conservative: the occluder image is eroded by a pixel so a gap
 * narrower than a pixel never hides what shows through it, a box is rasterized a little larger
 * than it is, and a box that crosses the near plane is always drawn. Culled meshes keep casting
 * shadows, so the sun's cached map never changes because of the eye.
 *
 * Only renders through the camera it was computed for are culled: the sun's shadow map and
 * captures from other cameras see everything.
 */

const OCCLUDER_KINDS = new Set(['wall', 'slab', 'roof', 'roof-segment', 'ceiling', 'column'])
const WIDTH = 256
/** An occluder must be this much nearer than a box (m) to hide it: slabs and walls are thin. */
const DEPTH_MARGIN = 0.02
/** Mesh lists are re-read this often (s), for meshes added or rebuilt after the culler starts. */
const REFRESH_INTERVAL = 1
/** With a still eye, the scene is checked for changes this often (s): doors open, levels move. */
const IDLE_INTERVAL = 0.1
/** How far outside its edges (px) a box's face still counts as covering a pixel. */
const BOX_DILATION = 0.75
/** Rounding allowance (px) at an occluder triangle's edges. */
const EDGE_SLACK = 1e-4
/** Occluder triangles smaller than this (m²) are trim and moulding: not worth rasterizing. */
const MIN_TRIANGLE_AREA = 0.01
/** Occluders narrower than this on screen (px of the depth image) hide next to nothing. */
const MIN_OCCLUDER_RADIUS = 1.5

type Occluder = {
  mesh: THREE.Mesh
  positions: Float32Array
  /** Vertex indices of the triangles worth rasterizing. */
  triangles: Uint32Array
  doubleSided: boolean
}

export type OcclusionStats = {
  occluders: number
  triangles: number
  tested: number
  culled: number
  ms: number
}

export type OcclusionCuller = {
  /** Computes which drawn meshes the camera can't see. Returns the culled meshes. */
  cull(camera: THREE.Camera): ReadonlySet<THREE.Mesh>
  /** Whether a mesh moved, appeared or vanished since the last call. */
  changed(): boolean
  readonly stats: OcclusionStats
  dispose(): void
}

type Extras = { kind?: string; pascalId?: string }

/** The 12 triangles of a box, as corner indices (bit 0: x, bit 1: y, bit 2: z), wound outward. */
const BOX_TRIANGLES = [
  0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7,
  1, 7, 5,
]

export function createOcclusionCuller(root: THREE.Object3D): OcclusionCuller {
  let occluders: Occluder[] = []
  let occludees: THREE.Mesh[] = []
  let listedAt = Number.NEGATIVE_INFINITY
  const shapes = new WeakMap<
    THREE.BufferGeometry,
    { positions: Float32Array; triangles: Uint32Array } | null
  >()
  const culled = new Set<THREE.Mesh>()
  const stats: OcclusionStats = { occluders: 0, triangles: 0, tested: 0, culled: 0, ms: 0 }

  let width = WIDTH
  let height = 0
  /** Nearest occluder depth key per pixel (−∞: nothing), then the eroded distances tested. */
  let depth = new Float32Array(0)
  let eroded = new Float32Array(0)
  /** Farthest eroded distance per 2ⁿ×2ⁿ block, n = 1, 2, … */
  let pyramid: { w: number; h: number; data: Float32Array }[] = []
  /** An occluder's vertices in view space, then on screen (x, y, depth key). */
  let scratch = new Float32Array(0)
  let screen = new Float64Array(0)

  const view = new THREE.Matrix4()
  const modelView = new THREE.Matrix4()
  const viewProjection = new THREE.Matrix4()
  const frustum = new THREE.Frustum()
  const sphere = new THREE.Sphere()
  let perspective = true
  let near = 0.1
  let p: number[] = []
  /** Screen x, y and depth key for up to 4 clipped vertices, and for a box's 8 corners. */
  const polygon = new Float64Array(12)
  const corners = new Float64Array(24)
  /** Set by the box test's rasterizer when a box pixel is not hidden. */
  let seen = false
  let lastSignature = Number.NaN
  /**
   * Whether an object and its ancestors are visible, memoized for one pass. A subtree set aside
   * for this render (`renderWithSceneMatrices`: nothing in it draws itself, e.g. merged
   * originals) still counts as shown: its walls and slabs still occlude.
   */
  const shownCache = new Map<THREE.Object3D, boolean>()
  const shown = (object: THREE.Object3D): boolean => {
    let value = shownCache.get(object)
    if (value === undefined) {
      value =
        (object.visible || isSetAsideForRender(object)) &&
        (object.parent ? shown(object.parent) : true)
      shownCache.set(object, value)
    }
    return value
  }
  /**
   * Whether the camera draws `mesh` now. An occluder may be a merged original: its batch draws
   * it, unless the level display holds it back (solo's shadow-only, isolation).
   */
  const drawn = (mesh: THREE.Mesh, occluder: boolean) => {
    if (!shown(mesh)) return false
    if (mesh.layers.isEnabled(SCENE_LAYER)) return true
    if (!occluder || !mesh.layers.isEnabled(BATCHED_LAYER)) return false
    const reasons = heldReasons(mesh)
    if (!reasons) return true
    for (const reason of reasons)
      if (reason !== 'batched' && reason !== 'wall-batched') return false
    return true
  }

  function list() {
    occluders = []
    occludees = []
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
      const occluder =
        !mesh.userData.glbBatch && OCCLUDER_KINDS.has(kindOf(mesh) ?? '') && opaque(mesh)
      if (occluder) {
        const geometry = mesh.geometry
        let shape = shapes.get(geometry)
        if (shape === undefined) {
          shape = occluderShape(geometry)
          shapes.set(geometry, shape)
        }
        if (shape) {
          if (!geometry.boundingSphere) geometry.computeBoundingSphere()
          occluders.push({
            mesh,
            ...shape,
            doubleSided: (mesh.material as THREE.Material).side !== THREE.FrontSide,
          })
        }
      }
      // A merged original is drawn by its batch, never itself.
      if (!occluder && mesh.layers.isEnabled(BATCHED_LAYER) && !mesh.layers.isEnabled(SCENE_LAYER))
        return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      occludees.push(mesh)
    })
  }

  function resize(camera: THREE.Camera) {
    const h = Math.max(32, Math.min(WIDTH, Math.round(WIDTH / aspectOf(camera))))
    if (h === height) return
    width = WIDTH
    height = h
    depth = new Float32Array(width * height)
    eroded = new Float32Array(width * height)
    pyramid = []
    let w = width
    let hh = height
    while (w > 1 || hh > 1) {
      w = Math.max(1, Math.ceil(w / 2))
      hh = Math.max(1, Math.ceil(hh / 2))
      pyramid.push({ w, h: hh, data: new Float32Array(w * hh) })
    }
  }

  function cull(camera: THREE.Camera): ReadonlySet<THREE.Mesh> {
    const start = performance.now()
    if (start / 1000 - listedAt >= REFRESH_INTERVAL) {
      list()
      listedAt = start / 1000
    }
    resize(camera)
    culled.clear()
    perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
    near = Math.max(1e-3, (camera as THREE.PerspectiveCamera).near ?? 0.1)
    view.copy(camera.matrixWorldInverse)
    viewProjection.multiplyMatrices(camera.projectionMatrix, view)
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem)
    p = camera.projectionMatrix.elements

    // 1. Occluders → nearest depth key per pixel.
    shownCache.clear()
    depth.fill(Number.NEGATIVE_INFINITY)
    let occluderCount = 0
    let triangles = 0
    // Pixels per metre at unit distance (perspective) or anywhere (orthographic).
    const pixelsPerMetre = (p[5]! * height) / 2
    for (const occluder of occluders) {
      const mesh = occluder.mesh
      if (!drawn(mesh, true)) continue
      sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
      if (!frustum.intersectsSphere(sphere)) continue
      sphere.center.applyMatrix4(view)
      const distance = Math.max(near, -sphere.center.z - sphere.radius)
      const radius = (sphere.radius * pixelsPerMetre) / (perspective ? distance : 1)
      if (radius < MIN_OCCLUDER_RADIUS) continue
      occluderCount++
      modelView.multiplyMatrices(view, mesh.matrixWorld)
      const m = modelView.elements
      const positions = occluder.positions
      const vertexCount = positions.length / 3
      if (scratch.length < vertexCount * 3) {
        scratch = new Float32Array(vertexCount * 6)
        screen = new Float64Array(vertexCount * 6)
      }
      for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3]!
        const y = positions[i * 3 + 1]!
        const z = positions[i * 3 + 2]!
        const vx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
        const vy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
        const vz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
        scratch[i * 3] = vx
        scratch[i * 3 + 1] = vy
        scratch[i * 3 + 2] = vz
        if (-vz >= near) project(vx, vy, vz, screen, i * 3)
      }
      const list = occluder.triangles
      // A mirrored transform flips which side faces the camera.
      const cullSide = occluder.doubleSided ? 0 : modelView.determinant() < 0 ? -1 : 1
      for (let t = 0; t < list.length; t += 3) {
        const a = list[t]! * 3
        const b = list[t + 1]! * 3
        const c = list[t + 2]! * 3
        triangles++
        if (-scratch[a + 2]! >= near && -scratch[b + 2]! >= near && -scratch[c + 2]! >= near)
          fill(screen, a, b, c, cullSide)
        else occluderTriangle(a, b, c, cullSide)
      }
    }

    // 2. Keys → distances, eroded by a pixel (each pixel takes its farthest neighbour), then the
    // max pyramid.
    for (let i = 0; i < depth.length; i++) {
      const key = depth[i]!
      depth[i] =
        key === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : perspective ? 1 / key : -key
    }
    for (let y = 0; y < height; y++) {
      const up = Math.max(0, y - 1) * width
      const row = y * width
      const down = Math.min(height - 1, y + 1) * width
      for (let x = 0; x < width; x++) {
        const l = Math.max(0, x - 1)
        const r = Math.min(width - 1, x + 1)
        eroded[row + x] = Math.max(
          depth[up + l]!,
          depth[up + x]!,
          depth[up + r]!,
          depth[row + l]!,
          depth[row + x]!,
          depth[row + r]!,
          depth[down + l]!,
          depth[down + x]!,
          depth[down + r]!,
        )
      }
    }
    let source: { w: number; h: number; data: Float32Array } = {
      w: width,
      h: height,
      data: eroded,
    }
    for (const level of pyramid) {
      for (let y = 0; y < level.h; y++) {
        const y0 = y * 2 * source.w
        const y1 = Math.min(source.h - 1, y * 2 + 1) * source.w
        for (let x = 0; x < level.w; x++) {
          const x0 = x * 2
          const x1 = Math.min(source.w - 1, x0 + 1)
          level.data[y * level.w + x] = Math.max(
            source.data[y0 + x0]!,
            source.data[y0 + x1]!,
            source.data[y1 + x0]!,
            source.data[y1 + x1]!,
          )
        }
      }
      source = level
    }

    // 3. Each drawn mesh's box against the image.
    let tested = 0
    if (occluderCount > 0) {
      for (const mesh of occludees) {
        if (!drawn(mesh, false)) continue
        sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
        if (!frustum.intersectsSphere(sphere)) continue
        tested++
        if (boxHidden(mesh)) culled.add(mesh)
      }
    }

    stats.occluders = occluderCount
    stats.triangles = triangles
    stats.tested = tested
    stats.culled = culled.size
    stats.ms = performance.now() - start
    return culled
  }

  /** View-space point → screen x, y (pixels, y down) and a screen-linear depth key. */
  function project(vx: number, vy: number, vz: number, out: Float64Array, o: number) {
    const cx = p[0]! * vx + p[4]! * vy + p[8]! * vz + p[12]!
    const cy = p[1]! * vx + p[5]! * vy + p[9]! * vz + p[13]!
    const cw = p[3]! * vx + p[7]! * vy + p[11]! * vz + p[15]!
    out[o] = ((cx / cw) * 0.5 + 0.5) * width
    out[o + 1] = (0.5 - (cy / cw) * 0.5) * height
    // Bigger is nearer: 1/distance (linear across the screen in perspective), or −distance.
    out[o + 2] = perspective ? 1 / -vz : vz
  }

  /** Clips one occluder triangle (view space, in `scratch`) at the near plane and rasterizes it. */
  function occluderTriangle(ia: number, ib: number, ic: number, cullSide: number) {
    const da = -scratch[ia + 2]! - near
    const db = -scratch[ib + 2]! - near
    const dc = -scratch[ic + 2]! - near
    if (da < 0 && db < 0 && dc < 0) return
    let n = 0
    for (let k = 0; k < 3; k++) {
      const i0 = k === 0 ? ia : k === 1 ? ib : ic
      const i1 = k === 0 ? ib : k === 1 ? ic : ia
      const d0 = k === 0 ? da : k === 1 ? db : dc
      const d1 = k === 0 ? db : k === 1 ? dc : da
      if (d0 >= 0) {
        project(scratch[i0]!, scratch[i0 + 1]!, scratch[i0 + 2]!, polygon, n * 3)
        n++
      }
      if (d0 >= 0 !== d1 >= 0) {
        const t = d0 / (d0 - d1)
        project(
          scratch[i0]! + (scratch[i1]! - scratch[i0]!) * t,
          scratch[i0 + 1]! + (scratch[i1 + 1]! - scratch[i0 + 1]!) * t,
          scratch[i0 + 2]! + (scratch[i1 + 2]! - scratch[i0 + 2]!) * t,
          polygon,
          n * 3,
        )
        n++
      }
    }
    for (let k = 1; k + 1 < n; k++) fill(polygon, 0, k * 3, (k + 1) * 3, cullSide)
  }

  /**
   * Rasterizes an occluder's screen triangle: pixel centres inside it keep the nearer depth key.
   * Row by row over the triangle's span, the key stepped across it.
   * `cullSide`: 0 draws both sides, 1 skips back faces, -1 front faces (mirrored).
   */
  function fill(v: Float64Array, a: number, b: number, c: number, cullSide: number) {
    const ax = v[a]!
    const ay = v[a + 1]!
    const bx = v[b]!
    const by = v[b + 1]!
    const cx = v[c]!
    const cy = v[c + 1]!
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area === 0 || !Number.isFinite(area)) return
    // Screen y points down, so a front (counter-clockwise) face has a negative area here.
    if (cullSide !== 0 && area > 0 === cullSide > 0) return
    const minX = Math.max(0, Math.round(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.round(Math.max(ax, bx, cx)) - 1)
    const minY = Math.max(0, Math.round(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.round(Math.max(ay, by, cy)) - 1)
    if (minX > maxX || minY > maxY) return
    const sign = area > 0 ? 1 : -1
    const e0x = (by - cy) * sign
    const e0y = (cx - bx) * sign
    const e1x = (cy - ay) * sign
    const e1y = (ax - cx) * sign
    const e2x = (ay - by) * sign
    const e2y = (bx - ax) * sign
    const inv = 1 / (area * sign)
    const ka = v[a + 2]!
    const kb = v[b + 2]!
    const kc = v[c + 2]!
    const step = (e0x * ka + e1x * kb + e2x * kc) * inv
    const px = minX + 0.5
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      const w0 = e0x * (px - bx) + e0y * (py - by)
      const w1 = e1x * (px - cx) + e1y * (py - cy)
      const w2 = e2x * (px - ax) + e2y * (py - ay)
      // The run of pixel centres where all three edge functions are non-negative, give or take
      // rounding: a centre on the edge two triangles share must not be left out by both.
      let lo = 0
      let hi = maxX - minX
      if (e0x > 0) lo = Math.max(lo, Math.ceil(-w0 / e0x - EDGE_SLACK))
      else if (e0x < 0) hi = Math.min(hi, Math.floor(w0 / -e0x + EDGE_SLACK))
      else if (w0 < 0) continue
      if (e1x > 0) lo = Math.max(lo, Math.ceil(-w1 / e1x - EDGE_SLACK))
      else if (e1x < 0) hi = Math.min(hi, Math.floor(w1 / -e1x + EDGE_SLACK))
      else if (w1 < 0) continue
      if (e2x > 0) lo = Math.max(lo, Math.ceil(-w2 / e2x - EDGE_SLACK))
      else if (e2x < 0) hi = Math.min(hi, Math.floor(w2 / -e2x + EDGE_SLACK))
      else if (w2 < 0) continue
      if (lo > hi) continue
      let key = (w0 * ka + w1 * kb + w2 * kc) * inv + step * lo
      const row = y * width + minX
      for (let x = lo; x <= hi; x++) {
        if (key > depth[row + x]!) depth[row + x] = key
        key += step
      }
    }
  }

  /**
   * Tests a box's screen triangle: pixels within {@link BOX_DILATION} of it are checked against
   * the eroded image, and `seen` is set at the first one not hidden.
   * `cullSide`: 1 skips back faces, -1 front faces (mirrored).
   */
  function raster(
    v: Float64Array,
    a: number,
    b: number,
    c: number,
    cullSide: number,
    test: boolean,
  ) {
    const ax = v[a]!
    const ay = v[a + 1]!
    const bx = v[b]!
    const by = v[b + 1]!
    const cx = v[c]!
    const cy = v[c + 1]!
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area === 0 || !Number.isFinite(area)) return
    // Screen y points down, so a front (counter-clockwise) face has a negative area here.
    if (cullSide !== 0 && area > 0 === cullSide > 0) return
    const pad = test ? BOX_DILATION + 1 : 0
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) - pad))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx) + pad))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) - pad))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy) + pad))
    if (minX > maxX || minY > maxY) return
    const sign = area > 0 ? 1 : -1
    // Edge functions, positive inside and summing to |area|: each is its vertex's weight.
    const e0x = (by - cy) * sign
    const e0y = (cx - bx) * sign
    const e1x = (cy - ay) * sign
    const e1y = (ax - cx) * sign
    const e2x = (ay - by) * sign
    const e2y = (bx - ax) * sign
    // How far outside each edge a tested pixel may lie, in edge-function units.
    const s0 = test ? -BOX_DILATION * Math.hypot(e0x, e0y) : 0
    const s1 = test ? -BOX_DILATION * Math.hypot(e1x, e1y) : 0
    const s2 = test ? -BOX_DILATION * Math.hypot(e2x, e2y) : 0
    const inv = 1 / (area * sign)
    const ka = v[a + 2]!
    const kb = v[b + 2]!
    const kc = v[c + 2]!
    // A dilated pixel lies off the face: give it the face's nearest depth, not an extrapolation.
    const kNear = Math.max(ka, kb, kc)
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      const row = y * width
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const w0 = e0x * (px - bx) + e0y * (py - by)
        const w1 = e1x * (px - cx) + e1y * (py - cy)
        const w2 = e2x * (px - ax) + e2y * (py - ay)
        if (w0 < s0 || w1 < s1 || w2 < s2) continue
        const inside = w0 >= 0 && w1 >= 0 && w2 >= 0
        const key = inside ? (w0 * ka + w1 * kb + w2 * kc) * inv : kNear
        const d = perspective ? 1 / key : -key
        if (test && !(eroded[row + x]! < d - DEPTH_MARGIN)) {
          seen = true
          return
        }
      }
    }
  }

  function boxHidden(mesh: THREE.Mesh): boolean {
    const box = mesh.geometry.boundingBox!
    const e = mesh.matrixWorld.elements
    const v = view.elements
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let nearest = Number.POSITIVE_INFINITY
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? box.max.x : box.min.x
      const y = k & 2 ? box.max.y : box.min.y
      const z = k & 4 ? box.max.z : box.min.z
      const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
      const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
      const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
      const vx = v[0]! * wx + v[4]! * wy + v[8]! * wz + v[12]!
      const vy = v[1]! * wx + v[5]! * wy + v[9]! * wz + v[13]!
      const vz = v[2]! * wx + v[6]! * wy + v[10]! * wz + v[14]!
      if (-vz < near) return false
      project(vx, vy, vz, corners, k * 3)
      const sx = corners[k * 3]!
      const sy = corners[k * 3 + 1]!
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sy < minY) minY = sy
      if (sy > maxY) maxY = sy
      if (-vz < nearest) nearest = -vz
    }
    // Wholly off screen: the frustum test already drops it.
    if (maxX < 0 || maxY < 0 || minX >= width || minY >= height) return false
    const x0 = Math.max(0, Math.floor(minX) - 1)
    const y0 = Math.max(0, Math.floor(minY) - 1)
    const x1 = Math.min(width - 1, Math.ceil(maxX) + 1)
    const y1 = Math.min(height - 1, Math.ceil(maxY) + 1)

    // Quick: the farthest occluder over the box's screen rectangle is nearer than its nearest
    // corner. Read from the pyramid level where the rectangle spans a few texels.
    const span = Math.max(x1 - x0 + 1, y1 - y0 + 1)
    const level = Math.min(pyramid.length, Math.max(0, Math.ceil(Math.log2(span / 4))))
    const data = level === 0 ? eroded : pyramid[level - 1]!.data
    const lw = level === 0 ? width : pyramid[level - 1]!.w
    const limit = nearest - DEPTH_MARGIN
    let quick = true
    for (let y = y0 >> level; quick && y <= y1 >> level; y++) {
      for (let x = x0 >> level; x <= x1 >> level; x++) {
        if (!(data[y * lw + x]! < limit)) {
          quick = false
          break
        }
      }
    }
    if (quick) return true

    // Exact: the box's faces, pixel by pixel, each against the occluder in front of it.
    // Faces turned away lie behind ones that face the eye, so only those are drawn.
    seen = false
    const mirrored = mesh.matrixWorld.determinant() < 0
    for (let t = 0; t < BOX_TRIANGLES.length && !seen; t += 3) {
      raster(
        corners,
        BOX_TRIANGLES[t]! * 3,
        BOX_TRIANGLES[t + 1]! * 3,
        BOX_TRIANGLES[t + 2]! * 3,
        mirrored ? -1 : 1,
        true,
      )
    }
    return !seen
  }

  /** A number that changes when any listed mesh moves or is shown or hidden. */
  function signature() {
    shownCache.clear()
    let h = 0
    for (let i = 0; i < occludees.length; i++) {
      const mesh = occludees[i]!
      if (!drawn(mesh, true)) continue
      const e = mesh.matrixWorld.elements
      h +=
        ((i % 89) + 1) *
        (e[0]! + e[2]! * 3 + e[5]! * 5 + e[10]! * 7 + e[12]! * 11 + e[13]! * 13 + e[14]! * 17 + 0.5)
    }
    return h
  }

  return {
    cull,
    changed() {
      const next = signature()
      const changed = next !== lastSignature
      lastSignature = next
      return changed
    },
    stats,
    dispose() {
      occluders = []
      occludees = []
      culled.clear()
    },
  }
}

/** The part of three's drawing pipeline (`renderer.drawingPipeline`) the culler hooks into. */
export type CullingPipeline = { isCulled(object: THREE.Object3D, camera: THREE.Camera): boolean }

/**
 * Culls `culler`'s meshes from the renders of `scene` through the camera `getCamera` returns:
 * recomputed when that camera moves or the scene changes, and answered through the drawing
 * pipeline's own culling test while such a render collects its draws. Nothing about the meshes
 * changes, so other cameras (the sun's shadow, captures) see them all.
 */
export function attachOcclusionCuller({
  scene,
  pipeline,
  culler,
  getCamera,
}: {
  scene: THREE.Scene
  pipeline: CullingPipeline
  culler: OcclusionCuller
  getCamera: () => THREE.Camera
}): () => void {
  const previousBefore = scene.onBeforeRender
  const previousAfter = scene.onAfterRender
  const ownCulled = Object.hasOwn(pipeline, 'isCulled')
  const previousCulled = pipeline.isCulled
  const pose = new Float32Array(POSE_SIZE)
  const computedPose = new Float32Array(POSE_SIZE)
  let computedFor: THREE.Camera | null = null
  let checkedAt = Number.NEGATIVE_INFINITY
  let moving = true
  let culled: ReadonlySet<THREE.Object3D> = new Set()
  let active: THREE.Camera | null = null

  scene.onBeforeRender = function (...args) {
    previousBefore.apply(this, args)
    const camera = args[2]
    if (active || camera !== getCamera()) return
    const now = performance.now() / 1000
    // The pose and lens, not the projection matrix: temporal AA jitters that every frame.
    readPose(camera, pose)
    let stale = computedFor !== camera || !samePose(pose, computedPose)
    if (stale) moving = true
    else if (now - checkedAt >= IDLE_INTERVAL) {
      // Once the eye settles, the scene is watched instead: the first check takes its measure
      // (and culls once more, for what changed while the eye moved), later ones compare.
      checkedAt = now
      stale = culler.changed() || moving
      moving = false
    }
    if (stale) {
      culled = timeSpan('occlusion-cull', () => culler.cull(camera))
      computedFor = camera
      checkedAt = now
      computedPose.set(pose)
    }
    active = camera
  }
  scene.onAfterRender = function (...args) {
    if (active === args[2]) active = null
    previousAfter.apply(this, args)
  }
  pipeline.isCulled = function (object, camera) {
    if (camera === active && culled.has(object)) return true
    return previousCulled.call(this, object, camera)
  }

  return () => {
    scene.onBeforeRender = previousBefore
    scene.onAfterRender = previousAfter
    if (ownCulled) pipeline.isCulled = previousCulled
    else delete (pipeline as Partial<CullingPipeline>).isCulled
  }
}

const POSE_SIZE = 23

/** The camera's world matrix and lens settings. */
function readPose(camera: THREE.Camera, out: Float32Array) {
  out.set(camera.matrixWorld.elements)
  const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera
  out[16] = c.isPerspectiveCamera ? c.fov : c.left
  out[17] = c.isPerspectiveCamera ? c.aspect : c.right
  out[18] = c.isPerspectiveCamera ? 0 : c.top
  out[19] = c.isPerspectiveCamera ? 0 : c.bottom
  out[20] = c.near
  out[21] = c.far
  out[22] = c.zoom
}

function samePose(a: Float32Array, b: Float32Array) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** An occluder's vertices and the triangles of it big enough to rasterize. */
function occluderShape(
  geometry: THREE.BufferGeometry,
): { positions: Float32Array; triangles: Uint32Array } | null {
  const attribute = geometry.getAttribute('position')
  if (!attribute) return null
  const positions = new Float32Array(attribute.count * 3)
  for (let i = 0; i < attribute.count; i++) {
    positions[i * 3] = attribute.getX(i)
    positions[i * 3 + 1] = attribute.getY(i)
    positions[i * 3 + 2] = attribute.getZ(i)
  }
  const index = geometry.index
  const count = index ? index.count : attribute.count
  const kept: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t + 2 < count; t += 3) {
    const ia = index ? index.getX(t) : t
    const ib = index ? index.getX(t + 1) : t + 1
    const ic = index ? index.getX(t + 2) : t + 2
    a.fromArray(positions, ia * 3)
    b.fromArray(positions, ib * 3).sub(a)
    c.fromArray(positions, ic * 3).sub(a)
    if (b.cross(c).length() / 2 >= MIN_TRIANGLE_AREA) kept.push(ia, ib, ic)
  }
  return kept.length ? { positions, triangles: new Uint32Array(kept) } : null
}

function kindOf(mesh: THREE.Object3D): string | undefined {
  for (let x: THREE.Object3D | null = mesh; x; x = x.parent) {
    const extras = x.userData as Extras
    if (extras.pascalId && extras.kind !== 'level') return extras.kind
  }
  return undefined
}

function opaque(mesh: THREE.Mesh) {
  const materials = [mesh.material, mesh.userData.__bakedMaterial] as (THREE.Material | undefined)[]
  for (const material of materials) {
    if (!material || Array.isArray(material)) continue
    const m = material as THREE.MeshPhysicalMaterial
    if (m.transparent || m.opacity < 1 || m.transmission > 0 || m.alphaTest > 0) return false
    if (m.userData.isGlass) return false
  }
  return mesh.userData.slotId !== 'glass'
}

function aspectOf(camera: THREE.Camera) {
  const perspective = camera as THREE.PerspectiveCamera
  if (perspective.isPerspectiveCamera) return perspective.aspect
  const ortho = camera as THREE.OrthographicCamera
  return Math.abs((ortho.right - ortho.left) / (ortho.top - ortho.bottom)) || 1
}
