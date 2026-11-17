/*
 * The outer-ring path of mapbox/earcut 3.0.2, the copy three.js r186 ships in
 * src/extras/lib/earcut.js and ShapeUtils.triangulateShape calls, ported to
 * TypeScript without the hole handling. Kept line for line so a plan polygon
 * gets the very diagonals the viewer drew it with before core triangulated it.
 * https://github.com/mapbox/earcut/tree/v3.0.2
 *
 * ISC License
 *
 * Copyright (c) 2016, Mapbox
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND ISC DISCLAIMS ALL WARRANTIES WITH REGARD TO
 * THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
 * IN NO EVENT SHALL ISC BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA
 * OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 * ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

type EarNode = {
  /** Vertex index in the coordinates array. */
  i: number
  x: number
  y: number
  /** Previous and next vertex nodes in the polygon ring. */
  prev: EarNode
  next: EarNode
  /** Z-order curve value. */
  z: number
  /** Previous and next nodes in z-order. */
  prevZ: EarNode | null
  nextZ: EarNode | null
  /** Whether this is a Steiner point. */
  steiner: boolean
}

/** Earcut's triangles for one ring of flat [x0, y0, x1, y1, …] coordinates, as vertex index triples. */
function earcut(data: readonly number[], dim = 2): number[] {
  const outerLen = data.length
  const outerNode = linkedList(data, 0, outerLen, dim, true)
  const triangles: number[] = []

  if (!outerNode || outerNode.next === outerNode.prev) return triangles

  let minX = 0
  let minY = 0
  let invSize = 0

  // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
  if (data.length > 80 * dim) {
    minX = data[0] ?? 0
    minY = data[1] ?? 0
    let maxX = minX
    let maxY = minY

    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i] ?? 0
      const y = data[i + 1] ?? 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }

    // minX, minY and invSize are later used to transform coords into integers for z-order calculation
    invSize = Math.max(maxX - minX, maxY - minY)
    invSize = invSize !== 0 ? 32767 / invSize : 0
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0)

  return triangles
}

// create a circular doubly linked list from polygon points in the specified winding order
function linkedList(
  data: readonly number[],
  start: number,
  end: number,
  dim: number,
  clockwise: boolean,
): EarNode | undefined {
  let last: EarNode | undefined

  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim)
      last = insertNode((i / dim) | 0, data[i] ?? 0, data[i + 1] ?? 0, last)
  } else {
    for (let i = end - dim; i >= start; i -= dim)
      last = insertNode((i / dim) | 0, data[i] ?? 0, data[i + 1] ?? 0, last)
  }

  if (last && equals(last, last.next)) {
    removeNode(last)
    last = last.next
  }

  return last
}

// eliminate colinear or duplicate points
function filterPoints(start: EarNode, end?: EarNode): EarNode {
  let last = end ?? start

  let p = start
  let again: boolean
  do {
    again = false

    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p)
      p = last = p.prev
      if (p === p.next) break
      again = true
    } else {
      p = p.next
    }
  } while (again || p !== last)

  return last
}

// main ear slicing loop which triangulates a polygon (given as a linked list)
function earcutLinked(
  start: EarNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass: number,
) {
  let ear = start

  // interlink polygon nodes in z-order
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize)

  let stop = ear

  // iterate through ears, slicing them one by one
  while (ear.prev !== ear.next) {
    const prev = ear.prev
    const next = ear.next

    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i, ear.i, next.i) // cut off the triangle

      removeNode(ear)

      // skipping the next vertex leads to less sliver triangles
      ear = next.next
      stop = next.next

      continue
    }

    ear = next

    // if we looped through the whole remaining polygon and can't find any more ears
    if (ear === stop) {
      // try filtering points and slicing again
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1)

        // if this didn't work, try curing all small self-intersections locally
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles)
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2)

        // as a last resort, try splitting the remaining polygon into two
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize)
      }

      break
    }
  }
}

// check whether a polygon node forms a valid ear with adjacent nodes
function isEar(ear: EarNode): boolean {
  const a = ear.prev
  const b = ear
  const c = ear.next

  if (area(a, b, c) >= 0) return false // reflex, can't be an ear

  // now make sure we don't have other points inside the potential ear
  const ax = a.x
  const bx = b.x
  const cx = c.x
  const ay = a.y
  const by = b.y
  const cy = c.y

  // triangle bbox
  const x0 = Math.min(ax, bx, cx)
  const y0 = Math.min(ay, by, cy)
  const x1 = Math.max(ax, bx, cx)
  const y1 = Math.max(ay, by, cy)

  let p = c.next
  while (p !== a) {
    if (
      p.x >= x0 &&
      p.x <= x1 &&
      p.y >= y0 &&
      p.y <= y1 &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    )
      return false
    p = p.next
  }

  return true
}

function isEarHashed(ear: EarNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev
  const b = ear
  const c = ear.next

  if (area(a, b, c) >= 0) return false // reflex, can't be an ear

  const ax = a.x
  const bx = b.x
  const cx = c.x
  const ay = a.y
  const by = b.y
  const cy = c.y

  // triangle bbox
  const x0 = Math.min(ax, bx, cx)
  const y0 = Math.min(ay, by, cy)
  const x1 = Math.max(ax, bx, cx)
  const y1 = Math.max(ay, by, cy)

  // z-order range for the current triangle bbox;
  const minZ = zOrder(x0, y0, minX, minY, invSize)
  const maxZ = zOrder(x1, y1, minX, minY, invSize)

  const blocks = (q: EarNode) =>
    q.x >= x0 &&
    q.x <= x1 &&
    q.y >= y0 &&
    q.y <= y1 &&
    q !== a &&
    q !== c &&
    pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, q.x, q.y) &&
    area(q.prev, q, q.next) >= 0

  let p = ear.prevZ
  let n = ear.nextZ

  // look for points inside the triangle in both directions
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (blocks(p)) return false
    p = p.prevZ

    if (blocks(n)) return false
    n = n.nextZ
  }

  // look for remaining points in decreasing z-order
  while (p && p.z >= minZ) {
    if (blocks(p)) return false
    p = p.prevZ
  }

  // look for remaining points in increasing z-order
  while (n && n.z <= maxZ) {
    if (blocks(n)) return false
    n = n.nextZ
  }

  return true
}

// go through all polygon nodes and cure small local self-intersections
function cureLocalIntersections(start: EarNode, triangles: number[]): EarNode {
  let first = start
  let p = start
  do {
    const a = p.prev
    const b = p.next.next

    if (
      !equals(a, b) &&
      intersects(a, p, p.next, b) &&
      locallyInside(a, b) &&
      locallyInside(b, a)
    ) {
      triangles.push(a.i, p.i, b.i)

      // remove two nodes involved
      removeNode(p)
      removeNode(p.next)

      p = first = b
    }
    p = p.next
  } while (p !== first)

  return filterPoints(p)
}

// try splitting polygon into two and triangulate them independently
function splitEarcut(
  start: EarNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
) {
  // look for a valid diagonal that divides the polygon into two
  let a = start
  do {
    let b = a.next.next
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        // split the polygon in two by the diagonal
        let c = splitPolygon(a, b)

        // filter colinear points around the cuts
        a = filterPoints(a, a.next)
        c = filterPoints(c, c.next)

        // run earcut on each half
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0)
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0)
        return
      }
      b = b.next
    }
    a = a.next
  } while (a !== start)
}

// interlink polygon nodes in z-order
function indexCurve(start: EarNode, minX: number, minY: number, invSize: number) {
  let p = start
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize)
    p.prevZ = p.prev
    p.nextZ = p.next
    p = p.next
  } while (p !== start)

  if (p.prevZ) p.prevZ.nextZ = null
  p.prevZ = null

  sortLinked(p)
}

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
function sortLinked(start: EarNode) {
  let list: EarNode | null = start
  let numMerges: number
  let inSize = 1

  do {
    let p: EarNode | null = list
    let e: EarNode
    list = null
    let tail: EarNode | null = null
    numMerges = 0

    while (p) {
      numMerges++
      let q: EarNode | null = p
      let pSize = 0
      for (let i = 0; i < inSize; i++) {
        pSize++
        q = q.nextZ
        if (!q) break
      }
      let qSize = inSize

      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || (p && p.z <= q.z))) {
          e = p as EarNode
          p = e.nextZ
          pSize--
        } else {
          e = q as EarNode
          q = e.nextZ
          qSize--
        }

        if (tail) tail.nextZ = e
        else list = e

        e.prevZ = tail
        tail = e
      }

      p = q
    }

    if (tail) tail.nextZ = null
    inSize *= 2
  } while (numMerges > 1)

  return list
}

// z-order of a point given coords and inverse of the longer side of data bbox
function zOrder(px: number, py: number, minX: number, minY: number, invSize: number): number {
  // coords are transformed into non-negative 15-bit integer range
  let x = ((px - minX) * invSize) | 0
  let y = ((py - minY) * invSize) | 0

  x = (x | (x << 8)) & 0x00ff00ff
  x = (x | (x << 4)) & 0x0f0f0f0f
  x = (x | (x << 2)) & 0x33333333
  x = (x | (x << 1)) & 0x55555555

  y = (y | (y << 8)) & 0x00ff00ff
  y = (y | (y << 4)) & 0x0f0f0f0f
  y = (y | (y << 2)) & 0x33333333
  y = (y | (y << 1)) & 0x55555555

  return x | (y << 1)
}

// check if a point lies within a convex triangle
function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  )
}

// check if a point lies within a convex triangle but false if its equal to the first point of the triangle
function pointInTriangleExceptFirst(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py)
}

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
function isValidDiagonal(a: EarNode, b: EarNode): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) && // doesn't intersect other edges
    ((locallyInside(a, b) &&
      locallyInside(b, a) &&
      middleInside(a, b) && // locally visible
      Boolean(area(a.prev, a, b.prev) || area(a, b.prev, b))) || // does not create opposite-facing sectors
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0)) // special zero-length case
  )
}

// signed area of a triangle
function area(p: EarNode, q: EarNode, r: EarNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
}

// check if two points are equal
function equals(p1: EarNode, p2: EarNode): boolean {
  return p1.x === p2.x && p1.y === p2.y
}

// check if two segments intersect
function intersects(p1: EarNode, q1: EarNode, p2: EarNode, q2: EarNode): boolean {
  const o1 = sign(area(p1, q1, p2))
  const o2 = sign(area(p1, q1, q2))
  const o3 = sign(area(p2, q2, p1))
  const o4 = sign(area(p2, q2, q1))

  if (o1 !== o2 && o3 !== o4) return true // general case

  if (o1 === 0 && onSegment(p1, p2, q1)) return true // p1, q1 and p2 are collinear and p2 lies on p1q1
  if (o2 === 0 && onSegment(p1, q2, q1)) return true // p1, q1 and q2 are collinear and q2 lies on p1q1
  if (o3 === 0 && onSegment(p2, p1, q2)) return true // p2, q2 and p1 are collinear and p1 lies on p2q2
  if (o4 === 0 && onSegment(p2, q1, q2)) return true // p2, q2 and q1 are collinear and q1 lies on p2q2

  return false
}

// for collinear points p, q, r, check if point q lies on segment pr
function onSegment(p: EarNode, q: EarNode, r: EarNode): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  )
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0
}

// check if a polygon diagonal intersects any polygon segments
function intersectsPolygon(a: EarNode, b: EarNode): boolean {
  let p = a
  do {
    if (
      p.i !== a.i &&
      p.next.i !== a.i &&
      p.i !== b.i &&
      p.next.i !== b.i &&
      intersects(p, p.next, a, b)
    )
      return true
    p = p.next
  } while (p !== a)

  return false
}

// check if a polygon diagonal is locally inside the polygon
function locallyInside(a: EarNode, b: EarNode): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0
}

// check if the middle point of a polygon diagonal is inside the polygon
function middleInside(a: EarNode, b: EarNode): boolean {
  let p = a
  let inside = false
  const px = (a.x + b.x) / 2
  const py = (a.y + b.y) / 2
  do {
    if (
      p.y > py !== p.next.y > py &&
      p.next.y !== p.y &&
      px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
    )
      inside = !inside
    p = p.next
  } while (p !== a)

  return inside
}

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two
function splitPolygon(a: EarNode, b: EarNode): EarNode {
  const a2 = createNode(a.i, a.x, a.y)
  const b2 = createNode(b.i, b.x, b.y)
  const an = a.next
  const bp = b.prev

  a.next = b
  b.prev = a

  a2.next = an
  an.prev = a2

  b2.next = a2
  a2.prev = b2

  bp.next = b2
  b2.prev = bp

  return b2
}

// create a node and optionally link it with previous one (in a circular doubly linked list)
function insertNode(i: number, x: number, y: number, last: EarNode | undefined): EarNode {
  const p = createNode(i, x, y)

  if (last) {
    p.next = last.next
    p.prev = last
    last.next.prev = p
    last.next = p
  }
  return p
}

function removeNode(p: EarNode) {
  p.next.prev = p.prev
  p.prev.next = p.next

  if (p.prevZ) p.prevZ.nextZ = p.nextZ
  if (p.nextZ) p.nextZ.prevZ = p.prevZ
}

// a node starts linked to itself: alone in its ring until it is inserted
function createNode(i: number, x: number, y: number): EarNode {
  const node = { i, x, y, z: 0, prevZ: null, nextZ: null, steiner: false } as Omit<
    EarNode,
    'prev' | 'next'
  > as EarNode
  node.prev = node
  node.next = node
  return node
}

function signedArea(data: readonly number[], start: number, end: number, dim: number): number {
  let sum = 0
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += ((data[j] ?? 0) - (data[i] ?? 0)) * ((data[i + 1] ?? 0) + (data[j + 1] ?? 0))
    j = i
  }
  return sum
}

/**
 * The triangles of a simple plan polygon (no holes), as vertex index triples:
 * exactly what three's `ShapeUtils.triangulateShape` returns for it, a closing
 * point that repeats the first one dropped as it drops it. A curved shed's
 * drawn surface bends each of them, so the viewer and a seat on it share
 * these diagonals.
 */
export function triangulatePlanPolygon(
  polygon: readonly [number, number][],
): [number, number, number][] {
  const first = polygon[0]
  const last = polygon.at(-1)
  const ring =
    polygon.length > 2 && first && last && last[0] === first[0] && last[1] === first[1]
      ? polygon.slice(0, -1)
      : polygon
  const indices = earcut(ring.flat())
  const triangles: [number, number, number][] = []
  for (let index = 0; index + 2 < indices.length; index += 3) {
    triangles.push([indices[index] ?? 0, indices[index + 1] ?? 0, indices[index + 2] ?? 0])
  }
  return triangles
}
