// Pure TypeScript — no React, no Three.js, no Node.js-only imports.
// Generates a DXF ASCII string from a Pascal scene graph.

import type { AnyNode, AnyNodeId } from '../../schema/types'

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

// ─── DXF builder helpers ──────────────────────────────────────────────────────

function line(code: number, value: string | number): string {
  const pad = String(code).padStart(3, ' ')
  return `${pad}\n${value}\n`
}

function point2d(x: number, y: number, offset = 0): string {
  return line(10 + offset, x.toFixed(4)) + line(20 + offset, y.toFixed(4))
}

function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return (
    line(0, 'LINE') +
    line(8, layer) +
    point2d(x1, y1) +
    point2d(x2, y2, 1)
  )
}

function dxfPolyline(layer: string, vertices: Vec2[], closed = false): string {
  let s = line(0, 'LWPOLYLINE')
  s += line(8, layer)
  s += line(90, vertices.length) // number of vertices
  s += line(70, closed ? 1 : 0) // flags: 1 = closed
  for (const [x, y] of vertices) {
    s += line(10, x.toFixed(4))
    s += line(20, y.toFixed(4))
  }
  return s
}

function dxfText(layer: string, x: number, y: number, height: number, text: string): string {
  return (
    line(0, 'TEXT') +
    line(8, layer) +
    point2d(x, y) +
    line(40, height.toFixed(4)) +
    line(1, text)
  )
}

function dxfArc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return (
    line(0, 'ARC') +
    line(8, layer) +
    point2d(cx, cy) +
    line(40, r.toFixed(4)) +
    line(50, startDeg.toFixed(2)) +
    line(51, endDeg.toFixed(2))
  )
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function wallFaceVertices(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 1e-6) return []

  const nx = -dz / len // perpendicular X
  const nz = dx / len  // perpendicular Z
  const h = thickness / 2

  return [
    [start[0] + nx * h, start[1] + nz * h],
    [end[0]   + nx * h, end[1]   + nz * h],
    [end[0]   - nx * h, end[1]   - nz * h],
    [start[0] - nx * h, start[1] - nz * h],
  ]
}

// Resolve the world position of a door/window along its parent wall.
function openingWorldPos(
  wall: WallLike,
  localX: number, // metres from wall start along centreline
): Vec2 {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 1e-6) return wall.start
  const t = Math.max(0, Math.min(1, localX / len))
  return [wall.start[0] + dx * t, wall.start[1] + dz * t]
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function exportSceneToDxf(
  nodes: Record<AnyNodeId, AnyNode>,
): string {
  const walls: WallLike[] = []
  const zones: ZoneLike[] = []
  const doors: DoorLike[] = []
  const windows: WindowLike[] = []

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
    }
  }

  // Build a wallId → WallLike map for opening resolution.
  const wallById = new Map<string, WallLike>(walls.map(w => [w.id, w]))

  let entities = ''

  // ── Walls: face polygon + centreline ────────────────────────────────────
  for (const w of walls) {
    const isInterior =
      typeof w.metadata?.wallType === 'string' && w.metadata.wallType === 'interior'
    const faceLayer = isInterior ? 'PASCAL_WALL_INT_FACE' : 'PASCAL_WALL_EXT_FACE'
    const clLayer   = isInterior ? 'PASCAL_WALL_INT_CL'   : 'PASCAL_WALL_EXT_CL'
    const thickness = (w.thickness ?? 0.24)

    // Face polygon
    const verts = wallFaceVertices(w.start, w.end, thickness)
    if (verts.length === 4) {
      entities += dxfPolyline(faceLayer, verts, true)
    }

    // Centreline
    entities += dxfLine(clLayer, w.start[0], w.start[1], w.end[0], w.end[1])
  }

  // ── Zones: boundary polygon + label ─────────────────────────────────────
  for (const z of zones) {
    entities += dxfPolyline('PASCAL_ZONE', z.polygon, true)

    // Label at polygon centroid
    const cx = z.polygon.reduce((s, v) => s + v[0], 0) / z.polygon.length
    const cy = z.polygon.reduce((s, v) => s + v[1], 0) / z.polygon.length
    entities += dxfText('PASCAL_ZONE_LABEL', cx, cy, 0.3, z.name)
  }

  // ── Doors: arc (door swing) + sill line ─────────────────────────────────
  for (const d of doors) {
    const wall = wallById.get(d.wallId)
    if (!wall) continue
    const localX = d.position?.[0] ?? 0
    const [cx, cy] = openingWorldPos(wall, localX)
    const r = (d.width ?? 0.9) / 2
    entities += dxfArc('PASCAL_DOOR', cx, cy, r, 0, 90)
    entities += dxfLine('PASCAL_DOOR', cx, cy, cx + r, cy)
  }

  // ── Windows: line segment along wall ────────────────────────────────────
  for (const win of windows) {
    const wall = wallById.get(win.wallId)
    if (!wall) continue
    const localX = win.position?.[0] ?? 0
    const halfW = (win.width ?? 1.2) / 2
    const [cx, cy] = openingWorldPos(wall, localX)

    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    const ux = dx / len, uz = dz / len

    entities += dxfLine(
      'PASCAL_WINDOW',
      cx - ux * halfW, cy - uz * halfW,
      cx + ux * halfW, cy + uz * halfW,
    )
  }

  // ── Assemble full DXF ────────────────────────────────────────────────────
  const header =
    line(0, 'SECTION') +
    line(2, 'HEADER') +
    // INSUNITS 6 = metres
    line(9, '$INSUNITS') + line(70, 6) +
    line(0, 'ENDSEC')

  const entitiesSection =
    line(0, 'SECTION') +
    line(2, 'ENTITIES') +
    entities +
    line(0, 'ENDSEC')

  return header + entitiesSection + line(0, 'EOF')
}
