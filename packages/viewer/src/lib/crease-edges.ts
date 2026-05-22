import { type BufferGeometry, Vector3 } from 'three'

const triA = new Vector3()
const triB = new Vector3()
const triC = new Vector3()
const edgeAB = new Vector3()
const edgeAC = new Vector3()
const faceNormal = new Vector3()

type EdgeRecord = {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  n1x: number
  n1y: number
  n1z: number
  n2x: number
  n2y: number
  n2z: number
  count: number
}

/**
 * Crease-only edge extraction. Unlike `EdgesGeometry`, it keeps an edge ONLY
 * when it is shared by exactly two faces whose dihedral angle exceeds
 * `thresholdDeg`, and DROPS every unpaired edge (boundary / T-junction /
 * non-manifold).
 *
 * Why: walls/slabs are cut with CSG (three-bvh-csg), whose output is a
 * non-manifold triangle soup. `EdgesGeometry` draws every unpaired triangle
 * edge → a "spiderweb" across flat cut faces. CSG solids are watertight, so
 * every *real* edge is shared by two faces; dropping unpaired edges removes the
 * T-junction artifacts, and the angle test removes the coplanar interior fans —
 * leaving only true corners + opening outlines. Open meshes (a bare ground
 * plane, billboard leaves) lose their outline, an acceptable trade for clean
 * architectural edges.
 *
 * Returns a flat `[x0,y0,z0, x1,y1,z1, ...]` segment buffer for
 * `LineSegmentsGeometry.setPositions`.
 */
export function buildCreaseEdges(geometry: BufferGeometry, thresholdDeg: number): Float32Array {
  const position = geometry.getAttribute('position')
  if (!position) return new Float32Array(0)

  const index = geometry.index
  const triCount = Math.floor((index ? index.count : position.count) / 3)
  const thresholdCos = Math.cos((thresholdDeg * Math.PI) / 180)

  // Weld coincident positions (quantised to ~1mm at metre scale) so adjacency
  // is detected across the soup's duplicated vertices AND across small CSG /
  // ExtrudeGeometry seam drift (e.g. the cap↔side-wall top edge), which a
  // tighter tolerance leaves unpaired and therefore dropped.
  const PRECISION = 1e3
  const idByKey = new Map<string, number>()
  const weldX: number[] = []
  const weldY: number[] = []
  const weldZ: number[] = []
  const weld = (v: Vector3): number => {
    const key = `${Math.round(v.x * PRECISION)}_${Math.round(v.y * PRECISION)}_${Math.round(v.z * PRECISION)}`
    const existing = idByKey.get(key)
    if (existing !== undefined) return existing
    const id = weldX.length
    weldX.push(v.x)
    weldY.push(v.y)
    weldZ.push(v.z)
    idByKey.set(key, id)
    return id
  }

  const edges = new Map<string, EdgeRecord>()
  const addEdge = (a: number, b: number) => {
    if (a === b) return
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = `${lo}_${hi}`
    const rec = edges.get(key)
    if (rec) {
      rec.count++
      rec.n2x = faceNormal.x
      rec.n2y = faceNormal.y
      rec.n2z = faceNormal.z
      return
    }
    edges.set(key, {
      ax: weldX[lo]!,
      ay: weldY[lo]!,
      az: weldZ[lo]!,
      bx: weldX[hi]!,
      by: weldY[hi]!,
      bz: weldZ[hi]!,
      n1x: faceNormal.x,
      n1y: faceNormal.y,
      n1z: faceNormal.z,
      n2x: 0,
      n2y: 0,
      n2z: 0,
      count: 1,
    })
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    triA.fromBufferAttribute(position, i0)
    triB.fromBufferAttribute(position, i1)
    triC.fromBufferAttribute(position, i2)
    edgeAB.subVectors(triB, triA)
    edgeAC.subVectors(triC, triA)
    faceNormal.crossVectors(edgeAB, edgeAC)
    if (faceNormal.lengthSq() === 0) continue // degenerate triangle
    faceNormal.normalize()
    addEdge(weld(triA), weld(triB))
    addEdge(weld(triB), weld(triC))
    addEdge(weld(triC), weld(triA))
  }

  const out: number[] = []
  for (const rec of edges.values()) {
    if (rec.count !== 2) continue // boundary / T-junction / non-manifold
    const dot = rec.n1x * rec.n2x + rec.n1y * rec.n2y + rec.n1z * rec.n2z
    if (dot >= thresholdCos) continue // coplanar-ish → not a crease
    out.push(rec.ax, rec.ay, rec.az, rec.bx, rec.by, rec.bz)
  }
  return new Float32Array(out)
}
