/**
 * Straightening a photo of a flat face: the plane-to-plane perspective transform (a homography)
 * between metres on the face and pixels in the photo, and the warp that draws the face head-on.
 * Several faces of one photo share its camera: the vanishing points of their lines give its focal
 * length and rotation, and each face's homography is K·[along up origin].
 * Pure over numbers and RGBA buffers, so the chat (canvas) and the MCP (any codec) share it.
 */

type Pt = [number, number]
type Segment = readonly [Pt, Pt]
export type Vec3 = [number, number, number]

/**
 * Row-major 3 × 3. A fitted one has `h[8]` normalised to 1; a camera's keeps its third row as the
 * depth in metres, positive in front of the camera.
 */
export type Homography = number[]

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray }

export function applyHomography(h: Homography, [x, y]: Pt): Pt | null {
  const w = h[6]! * x + h[7]! * y + h[8]!
  if (Math.abs(w) < 1e-12) return null
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w]
}

export function multiplyHomography(a: Homography, b: Homography): Homography {
  const m: number[] = []
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)
  return m
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h as [number, ...number[]]
  const co = [
    e! * j! - f! * i!,
    -(b! * j! - c! * i!),
    b! * f! - c! * e!,
    -(d! * j! - f! * g!),
    a * j! - c! * g!,
    -(a * f! - c! * d!),
    d! * i! - e! * g!,
    -(a * i! - b! * g!),
    a * e! - b! * d!,
  ]
  const det = a * co[0]! + b! * co[3]! + c! * co[6]!
  if (Math.abs(det) < 1e-12) return null
  const inverse = co.map((value) => value / det)
  return normalised(inverse)
}

function normalised(h: Homography): Homography | null {
  const scale = h[8]!
  if (Math.abs(scale) < 1e-12 || !h.every(Number.isFinite)) return null
  return h.map((value) => value / scale)
}

/** Moves points to their centroid and scales them to an average distance of √2 (Hartley). */
function conditioning(points: readonly Pt[]): Homography {
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
  const mean = points.reduce((sum, [x, y]) => sum + Math.hypot(x - cx, y - cy), 0) / points.length
  const s = mean > 1e-12 ? Math.SQRT2 / mean : 1
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]
}

/** Gaussian elimination with partial pivoting; null when the system is singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])
  const scale = Math.max(...m.map((row, i) => Math.abs(row[i]!)), 1e-300)
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row
    if (Math.abs(m[pivot]![col]!) < 1e-10 * scale) return null
    ;[m[col], m[pivot]] = [m[pivot]!, m[col]!]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row]![col]! / m[col]![col]!
      for (let k = col; k <= n; k++) m[row]![k]! -= factor * m[col]![k]!
    }
  }
  return m.map((row, i) => row[n]! / row[i]!)
}

/**
 * The homography taking each `from` to its `to`, fitted over all pairs by least squares on
 * conditioned coordinates, so one point picked a few pixels off moves the fit, not breaks it.
 * Null for fewer than four pairs or points that do not span the plane.
 */
export function solveHomography(pairs: readonly { from: Pt; to: Pt }[]): Homography | null {
  if (pairs.length < 4) return null
  const tFrom = conditioning(pairs.map((pair) => pair.from))
  const tTo = conditioning(pairs.map((pair) => pair.to))
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  const atb = new Array<number>(8).fill(0)
  const accumulate = (row: number[], value: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i]! += row[i]! * value
      for (let j = 0; j < 8; j++) ata[i]![j]! += row[i]! * row[j]!
    }
  }
  for (const { from, to } of pairs) {
    const [x, y] = applyHomography(tFrom, from)!
    const [u, v] = applyHomography(tTo, to)!
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  }
  const solved = solveLinear(ata, atb)
  if (!solved) return null
  const conditioned = [...solved, 1]
  const tToInverse = invertHomography(tTo)
  if (!tToInverse) return null
  return normalised(multiplyHomography(multiplyHomography(tToInverse, conditioned), tFrom))
}

/** Where the lines through `a` and through `b` cross; null when they are parallel. */
export function lineIntersection(a: readonly [Pt, Pt], b: readonly [Pt, Pt]): Pt | null {
  const [[x1, y1], [x2, y2]] = a
  const [[x3, y3], [x4, y4]] = b
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  const size = Math.max(Math.hypot(x2 - x1, y2 - y1) * Math.hypot(x4 - x3, y4 - y3), 1e-300)
  if (Math.abs(denominator) < 1e-9 * size) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
function unit3(a: Vec3): Vec3 | null {
  const n = Math.hypot(a[0], a[1], a[2])
  return n > 1e-12 && Number.isFinite(n) ? scale3(a, 1 / n) : null
}

/** Eigenvalues ascending, with their unit eigenvectors, of a symmetric 3 × 3 (cyclic Jacobi). */
function symmetricEigen(m: number[][]): { value: number; vector: Vec3 }[] {
  const a = m.map((row) => [...row])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = a[0]![1]! ** 2 + a[0]![2]! ** 2 + a[1]![2]! ** 2
    const diagonal = a[0]![0]! ** 2 + a[1]![1]! ** 2 + a[2]![2]! ** 2
    if (off <= 1e-30 * diagonal || off === 0) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      if (Math.abs(a[p]![q]!) < 1e-300) continue
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!)
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const [kp, kq] = [a[k]![p]!, a[k]![q]!]
        a[k]![p] = c * kp - s * kq
        a[k]![q] = s * kp + c * kq
      }
      for (let k = 0; k < 3; k++) {
        const [pk, qk] = [a[p]![k]!, a[q]![k]!]
        a[p]![k] = c * pk - s * qk
        a[q]![k] = s * pk + c * qk
      }
      for (let k = 0; k < 3; k++) {
        const [kp, kq] = [v[k]![p]!, v[k]![q]!]
        v[k]![p] = c * kp - s * kq
        v[k]![q] = s * kp + c * kq
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i]![i]!, vector: [v[0]![i]!, v[1]![i]!, v[2]![i]!] as Vec3 }))
    .sort((x, y) => x.value - y.value)
}

type PhotoSize = { width: number; height: number }

/**
 * Where lines that are parallel on the building meet in the photo: their vanishing point, as a unit
 * homogeneous point (x, y, w) about the photo's centre with its longer side as unit, so lines
 * parallel in the photo give w = 0 (a point at infinity) instead of a division by zero. Least
 * squares over all the lines, each weighted by its length. Null for fewer than two distinct lines.
 */
export function vanishingPoint(segments: readonly Segment[], photo: PhotoSize): Vec3 | null {
  const unit = Math.max(photo.width, photo.height)
  const at = ([x, y]: Pt): Vec3 => [(x - photo.width / 2) / unit, (y - photo.height / 2) / unit, 1]
  const m = [0, 1, 2].map(() => [0, 0, 0])
  for (const [a, b] of segments) {
    const line = cross3(at(a), at(b))
    // |line.xy| is the segment's length: dividing by it once leaves the length as the weight.
    const length = Math.hypot(line[0], line[1])
    if (length < 1e-12) continue
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) m[i]![j]! += (line[i]! * line[j]!) / length
  }
  const [smallest, middle, largest] = symmetricEigen(m)
  // Two near-identical lines (the same corner picked twice) cross anywhere: no vanishing point.
  if (!(middle!.value > 1e-5 * largest!.value)) return null
  const point = smallest!.vector
  return point[2] < 0 ? scale3(point, -1) : point
}

/** Root mean square distance, in photo pixels, of each segment's ends from the line through its middle and `direction`'s vanishing point. */
export function vanishingResidualPx(
  camera: PhotoCamera,
  direction: Vec3,
  segments: readonly Segment[],
): number {
  if (!segments.length) return 0
  const point: Vec3 = [
    camera.focal * direction[0] + camera.centre[0] * direction[2],
    camera.focal * direction[1] + camera.centre[1] * direction[2],
    direction[2],
  ]
  let sum = 0
  for (const [a, b] of segments) {
    const line = cross3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1], point)
    const norm = Math.hypot(line[0], line[1]) || 1
    for (const [x, y] of [a, b]) sum += ((line[0] * x + line[1] * y + line[2]) / norm) ** 2
  }
  return Math.sqrt(sum / (segments.length * 2))
}

/**
 * The photo's camera: square pixels, no skew, no lens distortion (straight lines stay straight).
 * The principal point is at the photo's centre across; its height is fitted, since a
 * perspective-corrected or shift photo keeps verticals parallel by moving it toward the horizon.
 */
export type PhotoCamera = {
  width: number
  height: number
  /** Focal length, in photo pixels. */
  focal: number
  /** Where the optical axis meets the photo, in photo pixels. */
  centre: Pt
  /** World up, in camera coordinates: x right, y down, z forward. */
  up: Vec3
}

/** A face's axes in camera coordinates: along it left to right as seen, up, and out toward the camera. */
export type FaceAxes = { along: Vec3; up: Vec3; normal: Vec3 }

/** A face's plane: its axes, and `normal · P` of its points, negative since it faces the camera. */
export type CameraFace = FaceAxes & { distance: number }

/** A focal length below a quarter or above ten times the photo's longer side is no photo's. */
const FOCAL_RANGE = [0.25, 10]
/** How much the perpendicular pairs must say about the focal length, at least. */
const MIN_PAIR_WEIGHT = 0.02
/** The principal point stays within this many longer sides of the centre, up or down. */
const MAX_SHIFT = 1

export type CameraFailure = 'needs_second_direction' | 'at_infinity' | 'unsolved'

/**
 * The focal length and the principal point's height (in units of the photo's longer side, from
 * its centre) that make each pair of perpendicular directions perpendicular. With the principal
 * point at (0, c), a pair of vanishing points gives (x₁, y₁ − c·w₁, f·w₁)·(x₂, y₂ − c·w₂, f·w₂) = 0,
 * linear in c and g = f² + c²: −(y₁w₂ + y₂w₁)·c + w₁w₂·g = −(x₁x₂ + y₁y₂). Least squares over the
 * pairs; a vanishing point far out has a small w and says little about f. With the verticals
 * parallel (w = 0) their pairs put c on the horizon. Too few or too alike pairs keep c = 0.
 */
function focalAndCentre(pairs: readonly (readonly [Vec3, Vec3])[]) {
  const rows = pairs.map(([a, b]) => ({
    c: -(a[1] * b[2] + b[1] * a[2]),
    g: a[2] * b[2],
    rhs: -(a[0] * b[0] + a[1] * b[1]),
  }))
  const sum = (term: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + term(row), 0)
  const weight = Math.sqrt(sum((row) => row.g * row.g))
  const [cc, cg, gg] = [sum((r) => r.c * r.c), sum((r) => r.c * r.g), sum((r) => r.g * r.g)]
  const [cr, gr] = [sum((r) => r.c * r.rhs), sum((r) => r.g * r.rhs)]
  const determinant = cc * gg - cg * cg
  let centre = 0
  let squared = gr / gg
  if (rows.length > 1 && determinant > 1e-3 * cc * gg) {
    const c = (cr * gg - gr * cg) / determinant
    const g = (gr * cc - cr * cg) / determinant
    if (Math.abs(c) <= MAX_SHIFT && g - c * c > 0) {
      centre = c
      squared = g - c * c
    }
  }
  // Each well-placed pair's focal length on its own, at that centre: they agree when the picks do.
  const alone = rows
    .filter((row) => Math.abs(row.g) > 0.05)
    .map((row) => (row.rhs - row.c * centre) / row.g - centre * centre)
    .filter((value) => value > 0)
    .map(Math.sqrt)
  return { weight, focal: Math.sqrt(squared), centre, alone }
}

/**
 * The photo's camera from vanishing points (from `vanishingPoint`): the vertical one when the
 * verticals were picked, one per face, and which faces meet at a right angle. First the focal
 * length and the principal point's height (`focalAndCentre`), then the rotation: up from the
 * verticals (or across two faces), each face's direction from its vanishing point, made level, and
 * turned so the face looks at the camera (`probe` is a photo pixel on it). `focalSpread` is the
 * ratio between the largest and the smallest focal length the well-placed pairs give on their own:
 * 1 when they agree.
 */
export function solvePhotoCamera(input: {
  photo: PhotoSize
  vertical: Vec3 | null
  faces: readonly { vanishing: Vec3; probe: Pt }[]
  perpendicular: readonly (readonly [number, number])[]
}): { camera: PhotoCamera; faces: FaceAxes[]; focalSpread: number } | { failure: CameraFailure } {
  const { photo, vertical, faces } = input
  const pairs = [
    ...(vertical ? faces.map((face) => [vertical, face.vanishing] as const) : []),
    ...input.perpendicular.map(([i, j]) => [faces[i]!.vanishing, faces[j]!.vanishing] as const),
  ]
  if (!pairs.length) return { failure: 'needs_second_direction' }
  const { weight, focal, centre, alone } = focalAndCentre(pairs)
  if (weight < MIN_PAIR_WEIGHT) return { failure: 'at_infinity' }
  if (!(focal >= FOCAL_RANGE[0]! && focal <= FOCAL_RANGE[1]!)) return { failure: 'unsolved' }

  const direction = (v: Vec3) => unit3([v[0], v[1] - centre * v[2], focal * v[2]])
  const directions = faces.map((face) => direction(face.vanishing))
  const [i, j] = input.perpendicular[0] ?? []
  let up =
    (vertical && direction(vertical)) ??
    (i !== undefined && directions[i] && directions[j!]
      ? unit3(cross3(directions[i]!, directions[j!]!))
      : null)
  if (!up) return { failure: 'unsolved' }
  if (up[1] > 0) up = scale3(up, -1)

  const unitPx = Math.max(photo.width, photo.height)
  const camera: PhotoCamera = {
    ...photo,
    focal: focal * unitPx,
    centre: [photo.width / 2, photo.height / 2 + centre * unitPx],
    up,
  }
  const axes: FaceAxes[] = []
  for (const [index, face] of faces.entries()) {
    const raw = directions[index]
    let along = raw && unit3(add3(raw, scale3(up, -dot3(raw, up))))
    if (!along) return { failure: 'unsolved' }
    let normal = cross3(along, up)
    if (dot3(normal, photoRay(camera, face.probe)) > 0) {
      along = scale3(along, -1)
      normal = scale3(normal, -1)
    }
    axes.push({ along, up, normal })
  }
  const focalSpread = alone.length > 1 ? Math.max(...alone) / Math.min(...alone) : 1
  return { camera, faces: axes, focalSpread }
}

/** The ray from the camera through a photo pixel, in camera coordinates (its depth is 1). */
export function photoRay(camera: PhotoCamera, [x, y]: Pt): Vec3 {
  return [(x - camera.centre[0]) / camera.focal, (y - camera.centre[1]) / camera.focal, 1]
}

/** Where a photo pixel's ray meets a face's plane, in camera coordinates; null behind the camera. */
export function pointOnFace(camera: PhotoCamera, face: CameraFace, pixel: Pt): Vec3 | null {
  const ray = photoRay(camera, pixel)
  const depth = face.distance / dot3(face.normal, ray)
  return depth > 0 && Number.isFinite(depth) ? scale3(ray, depth) : null
}

/** A photo pixel's place on a face, (along, up) in the face's units, from where its normal meets it. */
export function faceCoordinates(camera: PhotoCamera, face: CameraFace, pixel: Pt): Pt | null {
  const point = pointOnFace(camera, face, pixel)
  return point && [dot3(face.along, point), dot3(face.up, point)]
}

/**
 * The plane of a face from the camera and its two vertical edges `width` apart (the walls' extent):
 * the one distance that puts them so far apart. Null when the edges come out the wrong way round.
 */
export function faceAtWidth(
  camera: PhotoCamera,
  axes: FaceAxes,
  edges: { left: readonly Pt[]; right: readonly Pt[] },
  width: number,
): CameraFace | null {
  const across = (points: readonly Pt[]) =>
    points.reduce((sum, pixel) => {
      const ray = photoRay(camera, pixel)
      return sum + dot3(axes.along, ray) / dot3(axes.normal, ray)
    }, 0) / points.length
  const distance = width / (across(edges.right) - across(edges.left))
  return distance < 0 && Number.isFinite(distance) ? { ...axes, distance } : null
}

/** The plane of a face through the corner it shares with another: `corner` is that edge's pixels. */
export function faceThroughCorner(
  camera: PhotoCamera,
  axes: FaceAxes,
  other: CameraFace,
  corner: readonly Pt[],
): CameraFace | null {
  const points = corner.map((pixel) => pointOnFace(camera, other, pixel))
  if (points.some((point) => !point)) return null
  const middle = scale3(
    points.reduce<Vec3>((sum, point) => add3(sum, point!), [0, 0, 0]),
    1 / points.length,
  )
  const distance = dot3(axes.normal, middle)
  return distance < 0 ? { ...axes, distance } : null
}

/**
 * Metres on a face, from `origin` (its face coordinates), to photo pixels: K·[along up origin].
 * Its third row is the depth in metres, so a point behind the camera has w < 0.
 */
export function cameraFaceHomography(
  camera: PhotoCamera,
  face: CameraFace,
  origin: Pt,
): Homography {
  const offset = add3(
    add3(scale3(face.along, origin[0]), scale3(face.up, origin[1])),
    scale3(face.normal, face.distance),
  )
  const [a, u, t] = [face.along, face.up, offset].map(
    (v): Vec3 => [
      camera.focal * v[0] + camera.centre[0] * v[2],
      camera.focal * v[1] + camera.centre[1] * v[2],
      v[2],
    ],
  )
  return [a![0], u![0], t![0], a![1], u![1], t![1], a![2], u![2], t![2]]
}

/**
 * An image `width` × `height` whose every pixel samples `src` (bilinear) where `toSource` maps
 * its centre. What falls outside the source stays transparent.
 */
export function warpImage(
  src: RgbaImage,
  toSource: Homography,
  width: number,
  height: number,
): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4)
  const { width: sw, height: sh, data } = src
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const w = toSource[6]! * (u + 0.5) + toSource[7]! * (v + 0.5) + toSource[8]!
      // Behind the camera: a face running past the photo's side would wrap round.
      if (w < 1e-12) continue
      const sx = (toSource[0]! * (u + 0.5) + toSource[1]! * (v + 0.5) + toSource[2]!) / w - 0.5
      const sy = (toSource[3]! * (u + 0.5) + toSource[4]! * (v + 0.5) + toSource[5]!) / w - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0))
      const fy = Math.max(0, Math.min(1, sy - y0))
      const o = (v * width + u) * 4
      for (let c = 0; c < 4; c++) {
        const top = data[(y0 * sw + x0) * 4 + c]! * (1 - fx) + data[(y0 * sw + x1) * 4 + c]! * fx
        const bottom = data[(y1 * sw + x0) * 4 + c]! * (1 - fx) + data[(y1 * sw + x1) * 4 + c]! * fx
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return { width, height, data: out }
}
