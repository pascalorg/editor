import {
  cutterContextNodes,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getRenderableSlabPolygon,
  getSlabSlopePlane,
  hasSlabSlope,
  hostedCutterHoles,
  isDerivedNode,
  pointInPolygon,
  readFloorplanContext,
  type SlabNode,
  slabPolygonContextFromGeometry,
} from '@pascal-app/core'

/**
 * Whether the plan offers the slab's outline and hole handles: only a slab the
 * user drew. A floor plate's outline (and its room-cut holes) follow the rooms
 * and walls, so its handles would edit data the reconciler owns — the 3D view
 * hides them for the same reason.
 */
export function slabOutlineEditable(node: SlabNode): boolean {
  return !node.plateRole && !isDerivedNode(node)
}

/**
 * Stage C floor-plan builder for slab. Renders the slab polygon as a
 * filled path with holes cut out; when selected, overlays themed
 * chrome (accent stroke, hatch fill) plus the full boundary editor:
 *
 *   - Vertex handles on every polygon corner (orange dots).
 *   - Midpoint `+` handles between vertices to insert a new vertex.
 *   - Edge handles along each edge so the user can drag the whole
 *     edge perpendicular.
 *   - Same three handle sets for every hole in `node.holes`, with the
 *     `holeIndex` carried in each handle's payload.
 *
 * Uses `getRenderableSlabPolygon` for the visible fill (per-edge render
 * offsets against level walls + sibling slabs), but vertex / edge /
 * midpoint handles live on the **raw** `node.polygon` — matches the
 * legacy slab boundary editor which always operates on raw data.
 */
export function buildSlabFloorplan(node: SlabNode, ctx: GeometryContext): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const visualPolygon = getRenderableSlabPolygon(node, slabPolygonContextFromGeometry(ctx))
  if (!visualPolygon || visualPolygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const outer: FloorplanPoint[] = visualPolygon.map(([x, z]) => [x, z] as FloorplanPoint)

  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }
  const segments: string[] = [ring(outer)]

  const holes = node.holes ?? []
  for (const hole of [...holes, ...hostedCutterHoles(node, cutterContextNodes(node, ctx))]) {
    if (hole.length < 3) continue
    const holePts: FloorplanPoint[] = hole.map(([x, z]) => [x, z] as FloorplanPoint)
    segments.push(ring(holePts))
  }

  const stroke = showSelectedChrome && palette ? palette.selectedStroke : '#475569'
  // On a sheet the slab is its edge: printed, the wash tinted every room the
  // colour of wet concrete.
  const fill = readFloorplanContext(ctx).drafting
    ? 'none'
    : showSelectedChrome
      ? '#ffffff'
      : '#cbd5e1'

  // Slab body. Uses `fillOpacity` / `strokeOpacity` independently so the
  // outline stays crisp while the fill stays translucent — zones under
  // the slab read through, and on the selected state the hatch overlay
  // (`{ kind: 'hatch' }` below) carries the visual weight without the
  // background going opaque-white.
  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: segments.join(' '),
      fill,
      fillOpacity: showSelectedChrome ? 0.45 : 0.6,
      stroke,
      strokeWidth: showSelectedChrome ? 0.04 : 0.03,
      strokeOpacity: showSelectedChrome ? 0.96 : 0.85,
    },
  ]

  // Hatch overlay on selected — same `<defs>` pattern as the wall.
  if (isSelected && palette) {
    children.push({
      kind: 'hatch',
      points: outer,
      color: palette.selectedHatch,
      opacity: 0.7,
    })
  }

  // Uphill slope direction arrow in 2D plan view so sloped slabs read clearly
  // as ramps or drainage falls alongside flat slabs. Placed along the widest
  // solid interior chord so cutouts and concave L/U footprints stay clean.
  if (hasSlabSlope(node)) {
    const plane = getSlabSlopePlane(node)
    if (plane.span > 0.05) {
      const desiredLen = Math.min(Math.max(plane.span * 0.45, 0.25), 1.4)
      const anchor = findSlopeArrowAnchor(outer, holes, plane.dirX, plane.dirZ, desiredLen)
      if (anchor) {
        const arrowLen = Math.min(desiredLen, anchor.chordLen * 0.72)
        const half = arrowLen / 2
        const startX = anchor.x - plane.dirX * half
        const startZ = anchor.z - plane.dirZ * half
        const endX = anchor.x + plane.dirX * half
        const endZ = anchor.z + plane.dirZ * half
        const headLen = Math.min(arrowLen * 0.3, 0.22)
        const perpX = -plane.dirZ
        const perpZ = plane.dirX
        const wing1X = endX - plane.dirX * headLen + perpX * (headLen * 0.6)
        const wing1Z = endZ - plane.dirZ * headLen + perpZ * (headLen * 0.6)
        const wing2X = endX - plane.dirX * headLen - perpX * (headLen * 0.6)
        const wing2Z = endZ - plane.dirZ * headLen - perpZ * (headLen * 0.6)
        children.push({
          kind: 'path',
          d: `M ${startX} ${startZ} L ${endX} ${endZ} M ${wing1X} ${wing1Z} L ${endX} ${endZ} L ${wing2X} ${wing2Z}`,
          fill: 'none',
          stroke,
          strokeWidth: 0.025,
          strokeOpacity: 0.85,
        })
      }
    }
  }

  // Boundary editor — visible only when the slab is the active selection, and
  // only on a slab the user drew.
  if (isSelected && slabOutlineEditable(node)) {
    // Handles operate on the STORED polygon while the fill shows the
    // band-healed render polygon; when the two diverge (edges projected
    // onto wall faces / interior centerline seams), a dashed skeleton of the
    // stored boundary shows what the handles actually grab.
    const rawDiffersFromVisual =
      polygon.length !== visualPolygon.length ||
      polygon.some((point, index) => {
        const visual = visualPolygon[index]!
        return Math.abs(point[0] - visual[0]) > 0.005 || Math.abs(point[1] - visual[1]) > 0.005
      })
    if (rawDiffersFromVisual) {
      children.push({
        kind: 'path',
        d: ring(polygon.map(([x, z]) => [x, z] as FloorplanPoint)),
        fill: 'none',
        stroke: palette ? palette.selectedStroke : '#475569',
        strokeWidth: 0.015,
        strokeOpacity: 0.55,
        strokeDasharray: '0.08 0.06',
      })
    }
    appendRingEditor(children, polygon, undefined)
    holes.forEach((hole, holeIndex) => {
      if (hole.length >= 3) appendRingEditor(children, hole, holeIndex)
    })
  }

  return { kind: 'group', children }
}

/**
 * Push vertex / midpoint / edge handles for a single ring (boundary or
 * hole). `holeIndex === undefined` targets `node.polygon`; otherwise
 * `node.holes[holeIndex]`. Emits in this order so the hit-test
 * priority is sensible: edges first (largest hit area, lowest z),
 * then midpoints, then vertices on top.
 */
function appendRingEditor(
  children: FloorplanGeometry[],
  ring: ReadonlyArray<readonly [number, number]>,
  holeIndex: number | undefined,
): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'edge-handle',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      affordance: 'move-edge',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'midpoint-handle',
      point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      affordance: 'add-vertex',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i]!
    children.push({
      kind: 'endpoint-handle',
      point: [x, z],
      state: 'idle',
      affordance: 'move-vertex',
      payload: { holeIndex, vertexIndex: i },
    })
  }
}

function rayRingHitOffsets(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  ringPts: readonly FloorplanPoint[],
): number[] {
  const hits: number[] = []
  for (let i = 0; i < ringPts.length; i++) {
    const [ax, az] = ringPts[i]!
    const [bx, bz] = ringPts[(i + 1) % ringPts.length]!
    const ex = bx - ax
    const ez = bz - az
    const denom = dx * ez - dz * ex
    if (Math.abs(denom) < 1e-12) continue
    const s = ((ax - ox) * ez - (az - oz) * ex) / denom
    const u = ((ax - ox) * dz - (az - oz) * dx) / denom
    if (u >= -1e-9 && u <= 1 + 1e-9) hits.push(s)
  }
  return hits
}

function solidChordSpan(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  outer: readonly FloorplanPoint[],
  holes: readonly (readonly FloorplanPoint[])[],
): { sNeg: number; sPos: number; len: number } | null {
  let sNeg = Number.NEGATIVE_INFINITY
  let sPos = Number.POSITIVE_INFINITY
  const rings: Array<readonly FloorplanPoint[]> = [outer, ...holes.filter((h) => h.length >= 3)]
  for (const r of rings) {
    for (const s of rayRingHitOffsets(px, pz, dx, dz, r)) {
      if (s <= 1e-9 && s > sNeg) sNeg = s
      if (s >= -1e-9 && s < sPos) sPos = s
    }
  }
  if (!Number.isFinite(sNeg) || !Number.isFinite(sPos)) return null
  const len = sPos - sNeg
  return len > 1e-4 ? { sNeg, sPos, len } : null
}

function findSlopeArrowAnchor(
  outer: readonly FloorplanPoint[],
  holes: readonly (readonly FloorplanPoint[])[],
  dirX: number,
  dirZ: number,
  desiredLen: number,
): { x: number; z: number; chordLen: number } | null {
  const outerPoly = outer as Array<[number, number]>
  const holePolys = holes.filter((h) => h.length >= 3) as Array<Array<[number, number]>>
  const isInsideSolid = (x: number, z: number) =>
    pointInPolygon(x, z, outerPoly) && !holePolys.some((hole) => pointInPolygon(x, z, hole))

  let cx = 0
  let cz = 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of outer) {
    cx += x
    cz += z
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  cx /= outer.length
  cz /= outer.length

  const perpX = -dirZ
  const perpZ = dirX
  const evaluate = (px: number, pz: number) => {
    if (!isInsideSolid(px, pz)) return null
    const along = solidChordSpan(px, pz, dirX, dirZ, outer, holes)
    if (!along || along.len < 0.15) return null
    const midS = (along.sNeg + along.sPos) / 2
    const mx = px + dirX * midS
    const mz = pz + dirZ * midS
    if (!isInsideSolid(mx, mz)) return null
    const across = solidChordSpan(mx, mz, perpX, perpZ, outer, holes)
    const perpClearance = across ? Math.min(-across.sNeg, across.sPos) : 0
    return { x: mx, z: mz, chordLen: along.len, perpClearance }
  }

  // Keep convex hole-free polygons dead-center just like before.
  const centerCandidate = evaluate(cx, cz)
  if (
    centerCandidate &&
    centerCandidate.chordLen >= desiredLen * 1.25 &&
    centerCandidate.perpClearance >= 0.15
  ) {
    return { x: cx, z: cz, chordLen: centerCandidate.chordLen }
  }

  let best = centerCandidate
  const steps = 9
  for (let ix = 0; ix < steps; ix++) {
    const px = minX + ((ix + 0.5) / steps) * (maxX - minX)
    for (let iz = 0; iz < steps; iz++) {
      const pz = minZ + ((iz + 0.5) / steps) * (maxZ - minZ)
      const cand = evaluate(px, pz)
      if (!cand) continue
      const candEff = Math.min(cand.chordLen, desiredLen / 0.72)
      const bestEff = best ? Math.min(best.chordLen, desiredLen / 0.72) : -1
      if (
        !best ||
        candEff > bestEff + 0.05 ||
        (Math.abs(candEff - bestEff) <= 0.05 && cand.perpClearance > best.perpClearance + 0.02)
      ) {
        best = cand
      }
    }
  }

  return best ? { x: best.x, z: best.z, chordLen: best.chordLen } : null
}
