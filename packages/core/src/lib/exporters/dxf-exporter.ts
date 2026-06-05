// Pure TypeScript — no React, no Three.js, no Node.js-only imports.
// Generates a DXF ASCII string from a Pascal scene graph.

import type { AnyNode, AnyNodeId } from '../../schema/types'

// ─── Unit scale ───────────────────────────────────────────────────────────────
// Pascal internal unit = metres.  DXF output = mm ($INSUNITS 4).
const M = 1000

// ─── Types ────────────────────────────────────────────────────────────────────

type Vec2 = [number, number]

interface WallLike {
  type: 'wall'
  id: string
  start: Vec2
  end: Vec2
  thickness?: number
  height?: number
  parentId?: string | null
  metadata?: Record<string, unknown>
}

interface ZoneLike {
  type: 'zone'
  id: string
  name: string
  polygon: Vec2[]
}

interface DoorLike {
  type: 'door'
  id: string
  wallId: string
  width: number
  height?: number
  position?: [number, number, number]
}

interface WindowLike {
  type: 'window'
  id: string
  wallId: string
  width: number
  height?: number
  position?: [number, number, number]
}

interface ItemLike {
  type: 'item'
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  asset: {
    name: string
    dimensions: [number, number, number] // [w, h, d] metres
    attachTo?: string
  }
}

// ─── DXF builder helpers ──────────────────────────────────────────────────────

function grp(code: number, value: string | number): string {
  return `${String(code).padStart(3, ' ')}\n${value}\n`
}

// All coordinate arguments are in metres; converted to mm here.
function point2d(x: number, y: number, offset = 0): string {
  return grp(10 + offset, (x * M).toFixed(1)) + grp(20 + offset, (y * M).toFixed(1))
}

function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return grp(0, 'LINE') + grp(8, layer) + point2d(x1, y1) + point2d(x2, y2, 1)
}

function dxfPolyline(layer: string, vertices: Vec2[], closed = false): string {
  let s = grp(0, 'LWPOLYLINE') + grp(8, layer) + grp(90, vertices.length) + grp(70, closed ? 1 : 0)
  for (const [x, y] of vertices) {
    s += grp(10, (x * M).toFixed(1)) + grp(20, (y * M).toFixed(1))
  }
  return s
}

function dxfText(layer: string, x: number, y: number, height: number, text: string): string {
  return (
    grp(0, 'TEXT') + grp(8, layer) +
    point2d(x, y) +
    grp(40, (height * M).toFixed(1)) +
    grp(1, text)
  )
}

function dxfArc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return (
    grp(0, 'ARC') + grp(8, layer) +
    point2d(cx, cy) +
    grp(40, (r * M).toFixed(1)) +
    grp(50, startDeg.toFixed(2)) +
    grp(51, endDeg.toFixed(2))
  )
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function wallFaceVertices(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 1e-6) return []
  const nx = -dz / len
  const nz =  dx / len
  const h = thickness / 2
  return [
    [start[0] + nx * h, start[1] + nz * h],
    [end[0]   + nx * h, end[1]   + nz * h],
    [end[0]   - nx * h, end[1]   - nz * h],
    [start[0] - nx * h, start[1] - nz * h],
  ]
}

/** Parametric interpolation along a wall (t ∈ [0, 1]). */
function lerpWall(wall: WallLike, t: number): Vec2 {
  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * t,
    wall.start[1] + (wall.end[1] - wall.start[1]) * t,
  ]
}

/**
 * Given opening gaps as parametric intervals on the wall [t0, t1],
 * return the remaining solid segments as [t0, t1] pairs.
 * Handles overlapping/adjacent gaps and clamps to [0, 1].
 */
function solidSegments(gaps: { t0: number; t1: number }[]): [number, number][] {
  const sorted = gaps
    .map(g => [Math.max(0, g.t0), Math.min(1, g.t1)] as [number, number])
    .filter(([s, e]) => e > s + 1e-9)
    .sort(([a], [b]) => a - b)

  const segs: [number, number][] = []
  let cur = 0
  for (const [gs, ge] of sorted) {
    if (gs > cur + 1e-6) segs.push([cur, gs])
    cur = Math.max(cur, ge)
  }
  if (cur < 1 - 1e-6) segs.push([cur, 1])
  // No gaps → full wall
  if (segs.length === 0 && sorted.length === 0) segs.push([0, 1])
  return segs
}

/** World position of an opening centre along its parent wall. */
function openingCenter(wall: WallLike, localX: number): Vec2 {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.sqrt(dx * dx + dz * dz) || 1
  const t = Math.max(0, Math.min(1, localX / len))
  return [wall.start[0] + dx * t, wall.start[1] + dz * t]
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function exportSceneToDxf(nodes: Record<AnyNodeId, AnyNode>): string {
  const walls:   WallLike[]   = []
  const zones:   ZoneLike[]   = []
  const doors:   DoorLike[]   = []
  const windows: WindowLike[] = []
  const items:   ItemLike[]   = []

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      const w = node as unknown as WallLike
      if (Array.isArray(w.start) && Array.isArray(w.end)) walls.push(w)
    } else if (node.type === 'zone') {
      const z = node as unknown as ZoneLike
      if (Array.isArray(z.polygon) && z.polygon.length >= 3) zones.push(z)
    } else if (node.type === 'door') {
      doors.push(node as unknown as DoorLike)
    } else if (node.type === 'window') {
      windows.push(node as unknown as WindowLike)
    } else if (node.type === 'item') {
      items.push(node as unknown as ItemLike)
    }
  }

  const wallById = new Map<string, WallLike>(walls.map(w => [w.id, w]))

  // Pre-index openings by wall id for O(1) lookup during wall export.
  const doorsByWall   = new Map<string, DoorLike[]>()
  const windowsByWall = new Map<string, WindowLike[]>()
  for (const d of doors) {
    const arr = doorsByWall.get(d.wallId) ?? []; arr.push(d); doorsByWall.set(d.wallId, arr)
  }
  for (const w of windows) {
    const arr = windowsByWall.get(w.wallId) ?? []; arr.push(w); windowsByWall.set(w.wallId, arr)
  }

  let entities = ''

  // ── Walls (broken at door/window openings) ───────────────────────────────
  for (const w of walls) {
    const isInterior =
      typeof w.metadata?.wallType === 'string' && w.metadata.wallType === 'interior'
    const faceLayer = isInterior ? 'PASCAL_WALL_INT_FACE' : 'PASCAL_WALL_EXT_FACE'
    const clLayer   = isInterior ? 'PASCAL_WALL_INT_CL'   : 'PASCAL_WALL_EXT_CL'
    const thickness = w.thickness ?? 0.24

    const dx = w.end[0] - w.start[0]
    const dz = w.end[1] - w.start[1]
    const wallLen = Math.sqrt(dx * dx + dz * dz)
    if (wallLen < 1e-6) continue

    // Collect opening intervals in parametric wall space [0, 1].
    const gaps: { t0: number; t1: number }[] = []
    for (const d of doorsByWall.get(w.id) ?? []) {
      const lx = d.position?.[0] ?? 0
      const hw = (d.width ?? 0.9) / 2
      gaps.push({ t0: (lx - hw) / wallLen, t1: (lx + hw) / wallLen })
    }
    for (const win of windowsByWall.get(w.id) ?? []) {
      const lx = win.position?.[0] ?? 0
      const hw = (win.width ?? 1.2) / 2
      gaps.push({ t0: (lx - hw) / wallLen, t1: (lx + hw) / wallLen })
    }

    for (const [t0, t1] of solidSegments(gaps)) {
      const segStart = lerpWall(w, t0)
      const segEnd   = lerpWall(w, t1)

      const verts = wallFaceVertices(segStart, segEnd, thickness)
      if (verts.length === 4) entities += dxfPolyline(faceLayer, verts, true)
      entities += dxfLine(clLayer, segStart[0], segStart[1], segEnd[0], segEnd[1])
    }
  }

  // ── Zones: boundary polygon + name label ─────────────────────────────────
  for (const z of zones) {
    entities += dxfPolyline('PASCAL_ZONE', z.polygon, true)
    const cx = z.polygon.reduce((s, v) => s + v[0], 0) / z.polygon.length
    const cy = z.polygon.reduce((s, v) => s + v[1], 0) / z.polygon.length
    entities += dxfText('PASCAL_ZONE_LABEL', cx, cy, 0.3, z.name)
  }

  // ── Doors: sill line + 90° swing arc, oriented to the wall ───────────────
  for (const d of doors) {
    const wall = wallById.get(d.wallId)
    if (!wall) continue

    const lx    = d.position?.[0] ?? 0
    const width = d.width ?? 0.9
    const [cx, cy] = openingCenter(wall, lx)

    const wdx = wall.end[0] - wall.start[0]
    const wdz = wall.end[1] - wall.start[1]
    const wLen = Math.sqrt(wdx * wdx + wdz * wdz) || 1
    const ux = wdx / wLen
    const uz = wdz / wLen
    const wallAngleDeg = Math.atan2(wdz, wdx) * (180 / Math.PI)

    // Sill line across the opening
    entities += dxfLine('PASCAL_DOOR',
      cx - ux * width / 2, cy - uz * width / 2,
      cx + ux * width / 2, cy + uz * width / 2,
    )
    // Swing arc centred at the hinge end, sweeping 90° away from the wall
    entities += dxfArc('PASCAL_DOOR',
      cx - ux * width / 2, cy - uz * width / 2,
      width,
      wallAngleDeg, wallAngleDeg + 90,
    )
  }

  // ── Windows: two face lines + jamb lines (rectangle in the wall gap) ─────
  for (const win of windows) {
    const wall = wallById.get(win.wallId)
    if (!wall) continue

    const lx    = win.position?.[0] ?? 0
    const halfW = (win.width ?? 1.2) / 2
    const [cx, cy] = openingCenter(wall, lx)

    const wdx = wall.end[0] - wall.start[0]
    const wdz = wall.end[1] - wall.start[1]
    const wLen = Math.sqrt(wdx * wdx + wdz * wdz) || 1
    const ux = wdx / wLen
    const uz = wdz / wLen
    const nx = -wdz / wLen  // perpendicular (normal) to wall direction
    const nz =  wdx / wLen
    const halfT = (wall.thickness ?? 0.24) / 2

    // Front and back face lines spanning the window width
    entities += dxfLine('PASCAL_WINDOW',
      cx - ux * halfW + nx * halfT, cy - uz * halfW + nz * halfT,
      cx + ux * halfW + nx * halfT, cy + uz * halfW + nz * halfT,
    )
    entities += dxfLine('PASCAL_WINDOW',
      cx - ux * halfW - nx * halfT, cy - uz * halfW - nz * halfT,
      cx + ux * halfW - nx * halfT, cy + uz * halfW - nz * halfT,
    )
    // Jamb lines at each end connecting front and back faces
    entities += dxfLine('PASCAL_WINDOW',
      cx - ux * halfW + nx * halfT, cy - uz * halfW + nz * halfT,
      cx - ux * halfW - nx * halfT, cy - uz * halfW - nz * halfT,
    )
    entities += dxfLine('PASCAL_WINDOW',
      cx + ux * halfW + nx * halfT, cy + uz * halfW + nz * halfT,
      cx + ux * halfW - nx * halfT, cy + uz * halfW - nz * halfT,
    )
  }

  // ── Furniture: rectangle footprint on the floor plan ─────────────────────
  for (const item of items) {
    // Wall- and ceiling-attached items use parent-relative coordinates — skip.
    const att = item.asset.attachTo
    if (att === 'wall' || att === 'wall-side' || att === 'ceiling') continue

    const cx = item.position[0]   // level X
    const cy = item.position[2]   // 3D Z → floor-plan Y
    const angle = item.rotation[1] // Y-axis rotation in radians

    const [dw, , dd] = item.asset.dimensions
    const [sx, , sz] = item.scale
    const hw = (dw * sx) / 2
    const hd = (dd * sz) / 2

    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    const corners: Vec2[] = (
      [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as [number, number][]
    ).map(([lx, lz]) => [
      cx + lx * cosA - lz * sinA,
      cy + lx * sinA + lz * cosA,
    ])

    entities += dxfPolyline('PASCAL_FURNITURE', corners, true)
  }

  // ── Assemble full DXF ────────────────────────────────────────────────────
  const header =
    grp(0, 'SECTION') +
    grp(2, 'HEADER') +
    grp(9, '$INSUNITS') + grp(70, 4) +  // 4 = mm
    grp(0, 'ENDSEC')

  const entitiesSection =
    grp(0, 'SECTION') +
    grp(2, 'ENTITIES') +
    entities +
    grp(0, 'ENDSEC')

  return header + entitiesSection + grp(0, 'EOF')
}
