import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'

/** Closed field with a flat centre and bevels on both faces, including a true recessed profile. */
export function buildPanelField(
  contour: Vector2[],
  leafDepth: number,
  panelDepth: number,
  panelInset: number,
  flushPullAt?: { x: number; y: number },
) {
  if (contour.length > 1 && contour[0]!.equals(contour[contour.length - 1]!))
    contour = contour.slice(0, -1)
  const outer = contour.filter((point, i) => {
    const previous = contour[(i + contour.length - 1) % contour.length]!
    const next = contour[(i + 1) % contour.length]!
    return Math.abs(point.clone().sub(previous).cross(next.clone().sub(point))) > 1e-9
  })
  if (ShapeUtils.isClockWise(outer)) outer.reverse()
  const depth = Math.max(-leafDepth / 2 + 0.001, panelDepth)
  const xs = outer.map((p) => p.x)
  const ys = outer.map((p) => p.y)
  const bevel = Math.min(
    Math.abs(depth),
    panelInset / 2,
    (Math.max(...xs) - Math.min(...xs)) / 4,
    (Math.max(...ys) - Math.min(...ys)) / 4,
  )
  const inner = outer.map((point, i) => {
    const incoming = point
      .clone()
      .sub(outer[(i + outer.length - 1) % outer.length]!)
      .normalize()
    const outgoing = outer[(i + 1) % outer.length]!.clone().sub(point).normalize()
    const n1 = new Vector2(-incoming.y, incoming.x)
    const n2 = new Vector2(-outgoing.y, outgoing.x)
    const scale = bevel / (1 + n1.dot(n2))
    return point.clone().add(n1.add(n2).multiplyScalar(scale))
  })
  const positions: number[] = []
  const uvs: number[] = []
  const triangle = (
    a: Vector3,
    b: Vector3,
    c: Vector3,
    u = new Vector3(1, 0, 0),
    v = new Vector3(0, 1, 0),
  ) => {
    const polygons = flushPullAt ? outsidePull([a, b, c], flushPullAt) : [[a, b, c]]
    for (const polygon of polygons)
      for (let i = 1; i < polygon.length - 1; i++) {
        const points = [polygon[0]!, polygon[i]!, polygon[i + 1]!]
        if (
          points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).lengthSq() <
          1e-20
        )
          continue
        for (const p of points) {
          positions.push(p.x, p.y, p.z)
          uvs.push(p.dot(u), p.dot(v))
        }
      }
  }
  const point3 = (p: Vector2, z: number) => new Vector3(p.x, p.y, z)
  for (const face of [-1, 1]) {
    const z = face * (leafDepth / 2 + depth)
    for (const [a, b, c] of ShapeUtils.triangulateShape(inner, [])) {
      const points = [point3(inner[a!]!, z), point3(inner[b!]!, z), point3(inner[c!]!, z)]
      if (face < 0) points.reverse()
      triangle(points[0]!, points[1]!, points[2]!)
    }
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length
      const a = point3(outer[i]!, (face * leafDepth) / 2)
      const b = point3(outer[j]!, (face * leafDepth) / 2)
      const c = point3(inner[j]!, z)
      const d = point3(inner[i]!, z)
      const u = b.clone().sub(a).normalize()
      const normal = b.clone().sub(a).cross(d.clone().sub(a)).normalize()
      const v = normal.clone().cross(u)
      if (face > 0) {
        triangle(a, b, c, u, v)
        triangle(a, c, d, u, v)
      } else {
        triangle(a, c, b, u, v)
        triangle(a, d, c, u, v)
      }
    }
  }
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length
    const a = point3(outer[i]!, -leafDepth / 2)
    const b = point3(outer[j]!, -leafDepth / 2)
    const c = point3(outer[j]!, leafDepth / 2)
    const d = point3(outer[i]!, leafDepth / 2)
    const u = b.clone().sub(a).normalize()
    const v = new Vector3(0, 0, 1)
    triangle(a, b, c, u, v)
    triangle(a, c, d, u, v)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

// Clip each field triangle around the same through-hole the stile boxes leave for the flush cup.
function outsidePull(triangle: Vector3[], pull: { x: number; y: number }): Vector3[][] {
  const clip = (polygon: Vector3[], axis: 'x' | 'y', edge: number, sign: number) => {
    const result: Vector3[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      const da = sign * (a[axis] - edge)
      const db = sign * (b[axis] - edge)
      if (da >= 0) result.push(a)
      if (da >= 0 !== db >= 0) result.push(a.clone().lerp(b, da / (da - db)))
    }
    return result
  }
  const left = pull.x - 0.02
  const right = pull.x + 0.02
  const middle = clip(clip(triangle, 'x', left, 1), 'x', right, -1)
  return [
    clip(triangle, 'x', left, -1),
    clip(triangle, 'x', right, 1),
    clip(middle, 'y', pull.y - 0.06, -1),
    clip(middle, 'y', pull.y + 0.06, 1),
  ]
}
