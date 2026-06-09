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

// Single handle counter — every entity in the DXF must have a globally
// unique handle (group code 5). Using one counter avoids the eHandleInUse
// error that occurs when separate counters for tables/blocks/entities overlap.
function makeHandleGen() {
  let n = 1
  return () => (n++).toString(16).toUpperCase()
}

// Attach handle + owner to any entity header.
const hdl = (handle: string, owner = '0') =>
  grp(5, handle) + grp(330, owner)

// All coordinate arguments are in metres.
// Y is negated on output: Pascal stores Y = −DXF_Y (same flip applied during
// DXF import in madori-xml-parser.ts), so we negate Y when writing back to
// DXF to restore the correct orientation.
// 3D point with Z=0. LINE, TEXT, ARC centers all need group codes 10/20/30
// (or 11/21/31 for end-points). LWPOLYLINE vertices use only 10/20 — those
// are written inline without this helper.
function point2d(x: number, y: number, offset = 0): string {
  return (
    grp(10 + offset, (x * M).toFixed(1)) +
    grp(20 + offset, (-y * M).toFixed(1)) +
    grp(30 + offset, '0.0')
  )
}

// DXF strings must use \U+XXXX for code points > 127 when the file declares
// ANSI_1252 encoding, otherwise parsers reject or mis-decode the text.
function encodeDxfStr(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    out += code > 127
      ? `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`
      : ch
  }
  return out
}

// Each entity builder accepts a handle and an owner so callers can assign
// unique IDs and set the correct owning block record.
// Order per AC1015 spec: 0 type → 5 handle → 330 owner → 100 AcDbEntity →
//   8 layer → 100 AcDb<Type> → geometry

function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number, h: string, owner = '0'): string {
  return (
    grp(0, 'LINE') + hdl(h, owner) +
    grp(100, 'AcDbEntity') + grp(8, layer) +
    grp(100, 'AcDbLine') +
    point2d(x1, y1) + point2d(x2, y2, 1)
  )
}

function dxfPolyline(layer: string, vertices: Vec2[], closed: boolean, h: string, owner = '0'): string {
  let s = (
    grp(0, 'LWPOLYLINE') + hdl(h, owner) +
    grp(100, 'AcDbEntity') + grp(8, layer) +
    grp(100, 'AcDbPolyline') +
    grp(90, vertices.length) + grp(70, closed ? 1 : 0)
  )
  for (const [x, y] of vertices) {
    s += grp(10, (x * M).toFixed(1)) + grp(20, (-y * M).toFixed(1))
  }
  return s
}

function dxfText(layer: string, x: number, y: number, height: number, text: string, h: string, owner = '0'): string {
  // R2000 TEXT requires two AcDbText subclass markers: one before geometry,
  // one at the end as a "class separator" — even with no trailing group codes.
  return (
    grp(0, 'TEXT') + hdl(h, owner) +
    grp(100, 'AcDbEntity') + grp(8, layer) +
    grp(100, 'AcDbText') +
    point2d(x, y) +
    grp(40, (height * M).toFixed(1)) +
    grp(1, encodeDxfStr(text)) +
    grp(100, 'AcDbText')
  )
}

// Arc angles are passed in Pascal convention (CCW from +X, Y-down).
// After Y-flip, a CCW arc [s→e] becomes CCW [-e→-s] in DXF (Y-up).
// ARC uses two subclass markers: AcDbCircle owns center+radius, AcDbArc owns angles.
function dxfArc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number, h: string, owner = '0'): string {
  return (
    grp(0, 'ARC') + hdl(h, owner) +
    grp(100, 'AcDbEntity') + grp(8, layer) +
    grp(100, 'AcDbCircle') +
    point2d(cx, cy) +
    grp(40, (r * M).toFixed(1)) +
    grp(100, 'AcDbArc') +
    grp(50, (-endDeg).toFixed(2)) +
    grp(51, (-startDeg).toFixed(2))
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

  // Single handle counter shared across ALL sections (tables, blocks, entities).
  const nextH = makeHandleGen()

  // Pre-allocate structural handles that are cross-referenced across sections.
  // These must be allocated before any other handles so the values are known
  // when building LAYER entries (390), BLOCKS owners, and OBJECTS content.
  const rootDictH          = nextH()  // root DICTIONARY in OBJECTS
  const plotStyleNameDictH = nextH()  // ACAD_PLOTSTYLENAME dictionary
  const plotStyleH         = nextH()  // ACDBPLACEHOLDER "Normal" plot style
  const blockRecTableH     = nextH()  // BLOCK_RECORD TABLE handle
  const modelSpaceRecH     = nextH()  // *Model_Space BLOCK_RECORD handle
  const paperSpaceRecH     = nextH()  // *Paper_Space BLOCK_RECORD handle
  const layoutDictH        = nextH()  // ACAD_LAYOUT dictionary handle
  const modelLayoutH       = nextH()  // LAYOUT "Model" object handle
  const paperLayoutH       = nextH()  // LAYOUT "Layout1" object handle
  // Standard sub-dictionaries required by Autodesk viewer
  const colorDictH         = nextH()  // ACAD_COLOR
  const groupDictH         = nextH()  // ACAD_GROUP
  const materialDictH      = nextH()  // ACAD_MATERIAL
  const mleaderDictH       = nextH()  // ACAD_MLEADERSTYLE
  const mlineDictH         = nextH()  // ACAD_MLINESTYLE
  const plotSettingsDictH  = nextH()  // ACAD_PLOTSETTINGS
  const scaleDictH         = nextH()  // ACAD_SCALELIST
  const tableDictH         = nextH()  // ACAD_TABLESTYLE
  const visualDictH        = nextH()  // ACAD_VISUALSTYLE
  const matByBlockH        = nextH()  // MATERIAL ByBlock
  const matByLayerH        = nextH()  // MATERIAL ByLayer
  const matGlobalH         = nextH()  // MATERIAL Global
  const mlineStyleH        = nextH()  // MLINESTYLE Standard
  const mleaderStyleH      = nextH()  // MLEADERSTYLE Standard

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
      if (verts.length === 4) entities += dxfPolyline(faceLayer, verts, true, nextH(), modelSpaceRecH)
      entities += dxfLine(clLayer, segStart[0], segStart[1], segEnd[0], segEnd[1], nextH(), modelSpaceRecH)
    }
  }

  // ── Zones: boundary polygon + name label ─────────────────────────────────
  for (const z of zones) {
    entities += dxfPolyline('PASCAL_ZONE', z.polygon, true, nextH(), modelSpaceRecH)
    const cx = z.polygon.reduce((s, v) => s + v[0], 0) / z.polygon.length
    const cy = z.polygon.reduce((s, v) => s + v[1], 0) / z.polygon.length
    entities += dxfText('PASCAL_ZONE_LABEL', cx, cy, 0.3, z.name, nextH(), modelSpaceRecH)
  }

  // ── Doors: closed sector symbol (sill + arc + open-door line) ────────────
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
    const hingeX = cx - ux * width / 2
    const hingeZ = cy - uz * width / 2
    // Edge 1: door leaf (closed position, along wall opening)
    entities += dxfLine('PASCAL_DOOR',
      hingeX, hingeZ,
      cx + ux * width / 2, cy + uz * width / 2, nextH(), modelSpaceRecH)
    // Edge 2: 90° swing arc opening toward the exterior (−Z normal side).
    // Pascal angles (wallAngleDeg−90 → wallAngleDeg). dxfArc maps (s,e) → DXF CCW from −e to −s,
    // yielding DXF 0° → 90° for a horizontal wall.
    entities += dxfArc('PASCAL_DOOR',
      hingeX, hingeZ, width,
      wallAngleDeg - 90, wallAngleDeg, nextH(), modelSpaceRecH)
    // Edge 3: open-door line — closes the sector (from free end at open position back to hinge)
    entities += dxfLine('PASCAL_DOOR',
      hingeX + uz * width, hingeZ - ux * width,
      hingeX, hingeZ, nextH(), modelSpaceRecH)
  }

  // ── Windows: two face lines + jamb lines ─────────────────────────────────
  for (const win of windows) {
    const wall = wallById.get(win.wallId)
    if (!wall) continue
    const lx    = win.position?.[0] ?? 0
    const halfW = (win.width ?? 1.2) / 2
    const [cx, cy] = openingCenter(wall, lx)
    const wdx = wall.end[0] - wall.start[0]
    const wdz = wall.end[1] - wall.start[1]
    const wLen = Math.sqrt(wdx * wdx + wdz * wdz) || 1
    const ux = wdx / wLen; const uz = wdz / wLen
    const nx = -wdz / wLen; const nz = wdx / wLen
    const halfT = (wall.thickness ?? 0.24) / 2
    entities += dxfLine('PASCAL_WINDOW', cx - ux*halfW + nx*halfT, cy - uz*halfW + nz*halfT, cx + ux*halfW + nx*halfT, cy + uz*halfW + nz*halfT, nextH(), modelSpaceRecH)
    entities += dxfLine('PASCAL_WINDOW', cx - ux*halfW - nx*halfT, cy - uz*halfW - nz*halfT, cx + ux*halfW - nx*halfT, cy + uz*halfW - nz*halfT, nextH(), modelSpaceRecH)
    entities += dxfLine('PASCAL_WINDOW', cx - ux*halfW + nx*halfT, cy - uz*halfW + nz*halfT, cx - ux*halfW - nx*halfT, cy - uz*halfW - nz*halfT, nextH(), modelSpaceRecH)
    entities += dxfLine('PASCAL_WINDOW', cx + ux*halfW + nx*halfT, cy + uz*halfW + nz*halfT, cx + ux*halfW - nx*halfT, cy + uz*halfW - nz*halfT, nextH(), modelSpaceRecH)
  }

  // ── Furniture: rectangle footprint on the floor plan ─────────────────────
  for (const item of items) {
    const att = item.asset.attachTo
    if (att === 'wall' || att === 'wall-side' || att === 'ceiling') continue
    const cx = item.position[0]
    const cy = item.position[2]
    const angle = item.rotation[1]
    const [dw, , dd] = item.asset.dimensions
    const [sx, , sz] = item.scale
    const hw = (dw * sx) / 2; const hd = (dd * sz) / 2
    const cosA = Math.cos(angle); const sinA = Math.sin(angle)
    const corners: Vec2[] = (
      [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as [number, number][]
    ).map(([lx, lz]) => [cx + lx*cosA - lz*sinA, cy + lx*sinA + lz*cosA])
    entities += dxfPolyline('PASCAL_FURNITURE', corners, true, nextH(), modelSpaceRecH)
  }

  // ── Compute drawing extents for $EXTMIN/$EXTMAX ──────────────────────────
  // Coordinates in DXF mm space (metres × 1000, Y negated).
  let extMinX = Infinity, extMinY = Infinity, extMaxX = -Infinity, extMaxY = -Infinity
  const expandExt = (x: number, y: number) => {
    const dx = x * M, dy = -y * M
    if (dx < extMinX) extMinX = dx; if (dx > extMaxX) extMaxX = dx
    if (dy < extMinY) extMinY = dy; if (dy > extMaxY) extMaxY = dy
  }
  for (const w of walls) { expandExt(w.start[0], w.start[1]); expandExt(w.end[0], w.end[1]) }
  for (const z of zones)  { for (const [x, y] of z.polygon) expandExt(x, y) }
  const validExt = isFinite(extMinX)
  const pad = 1000
  const eMinX = validExt ? (extMinX - pad).toFixed(1) : '0.0'
  const eMinY = validExt ? (extMinY - pad).toFixed(1) : '0.0'
  const eMaxX = validExt ? (extMaxX + pad).toFixed(1) : '100000.0'
  const eMaxY = validExt ? (extMaxY + pad).toFixed(1) : '100000.0'

  // ── Assemble full DXF (AC1015 / R2000) ──────────────────────────────────
  // Section order: HEADER → CLASSES → TABLES → BLOCKS → ENTITIES → OBJECTS → EOF

  // ── CLASSES ───────────────────────────────────────────────────────────────
  // ACDBDICTIONARYWDFLT is needed for the AcDbDictionaryWithDefault subclass
  // used in the ACAD_PLOTSTYLENAME dictionary in OBJECTS.
  const classes =
    grp(0, 'SECTION') + grp(2, 'CLASSES') +
    grp(0, 'CLASS') +
    grp(1, 'ACDBDICTIONARYWDFLT') +
    grp(2, 'AcDbDictionaryWithDefault') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'LAYOUT') +
    grp(2, 'AcDbLayout') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'MATERIAL') +
    grp(2, 'AcDbMaterial') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 1153) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'MLINESTYLE') +
    grp(2, 'AcDbMlineStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'MLEADERSTYLE') +
    grp(2, 'AcDbMLeaderStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'VISUALSTYLE') +
    grp(2, 'AcDbVisualStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 4095) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'SCALE') +
    grp(2, 'AcDbScale') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 1153) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'TABLESTYLE') +
    grp(2, 'AcDbTableStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 4095) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'DICTIONARYVAR') +
    grp(2, 'AcDbDictionaryVar') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'CELLSTYLEMAP') +
    grp(2, 'AcDbCellStyleMap') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'MENTALRAYRENDERSETTINGS') +
    grp(2, 'AcDbMentalRayRenderSettings') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'DETAILVIEWSTYLE') +
    grp(2, 'AcDbDetailViewStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'SECTIONVIEWSTYLE') +
    grp(2, 'AcDbSectionViewStyle') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'CLASS') +
    grp(1, 'RASTERVARIABLES') +
    grp(2, 'AcDbRasterVariables') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    // AcDbPlaceHolder must be declared — we use ACDBPLACEHOLDER objects in OBJECTS
    grp(0, 'CLASS') +
    grp(1, 'ACDBPLACEHOLDER') +
    grp(2, 'AcDbPlaceHolder') +
    grp(3, 'ObjectDBX Classes') +
    grp(90, 0) + grp(280, 0) + grp(281, 0) +
    grp(0, 'ENDSEC')

  // ── HEADER ────────────────────────────────────────────────────────────────
  // $PSTYLEMODE 1 = color-dependent plot styles.
  //   Without this AutoCAD defaults to named plot styles (mode 0) and requires
  //   a 390 PlotStyleName handle on every LAYER entry that points to a named
  //   plot style object. With mode 1 those handles still need to exist but can
  //   point to the generic ACDBPLACEHOLDER "Normal" object.
  // $MEASUREMENT 1 = metric (consistent with $INSUNITS 4 = mm).
  // $HANDSEED = value larger than any handle we emit, so AutoCAD's "next
  //   handle" counter starts above our range and never collides.
  const h3 = (v: string) => grp(10, v) + grp(20, v) + grp(30, v)  // 3D zero/val helper
  const header =
    grp(0, 'SECTION') + grp(2, 'HEADER') +
    grp(9, '$ACADVER')      + grp(1,   'AC1015') +
    grp(9, '$ACADMAINTVER') + grp(70,  6) +
    grp(9, '$DWGCODEPAGE')  + grp(3,   'ANSI_1252') +
    grp(9, '$INSBASE')      + h3('0.0') +
    grp(9, '$EXTMIN')       + grp(10, eMinX) + grp(20, eMinY) + grp(30, '0.0') +
    grp(9, '$EXTMAX')       + grp(10, eMaxX) + grp(20, eMaxY) + grp(30, '0.0') +
    grp(9, '$LIMMIN')       + grp(10, '0.0') + grp(20, '0.0') +
    grp(9, '$LIMMAX')       + grp(10, '420.0') + grp(20, '297.0') +
    grp(9, '$LTSCALE')      + grp(40,  '1.0') +
    grp(9, '$TEXTSTYLE')    + grp(7,   'Standard') +
    grp(9, '$CLAYER')       + grp(8,   '0') +
    grp(9, '$CELTYPE')      + grp(6,   'ByLayer') +
    grp(9, '$CECOLOR')      + grp(62,  256) +
    grp(9, '$CELTSCALE')    + grp(40,  '1.0') +
    grp(9, '$DIMSTYLE')     + grp(2,   'Standard') +
    grp(9, '$LUNITS')       + grp(70,  2) +
    grp(9, '$LUPREC')       + grp(70,  4) +
    grp(9, '$AUNITS')       + grp(70,  0) +
    grp(9, '$AUPREC')       + grp(70,  2) +
    grp(9, '$ANGBASE')      + grp(50,  '0.0') +
    grp(9, '$ANGDIR')       + grp(70,  0) +
    grp(9, '$PDMODE')       + grp(70,  0) +
    grp(9, '$PDSIZE')       + grp(40,  '0.0') +
    grp(9, '$UCSNAME')      + grp(2,   '') +
    grp(9, '$UCSORG')       + h3('0.0') +
    grp(9, '$UCSXDIR')      + grp(10, '1.0') + grp(20, '0.0') + grp(30, '0.0') +
    grp(9, '$UCSYDIR')      + grp(10, '0.0') + grp(20, '1.0') + grp(30, '0.0') +
    grp(9, '$PUCSNAME')     + grp(2,   '') +
    grp(9, '$PUCSORG')      + h3('0.0') +
    grp(9, '$PUCSXDIR')     + grp(10, '1.0') + grp(20, '0.0') + grp(30, '0.0') +
    grp(9, '$PUCSYDIR')     + grp(10, '0.0') + grp(20, '1.0') + grp(30, '0.0') +
    grp(9, '$WORLDVIEW')    + grp(70,  1) +
    grp(9, '$TILEMODE')     + grp(70,  1) +
    grp(9, '$MAXACTVP')     + grp(70,  64) +
    grp(9, '$PINSBASE')     + h3('0.0') +
    grp(9, '$PLIMCHECK')    + grp(70,  0) +
    grp(9, '$PEXTMIN')      + grp(10, '1e+20') + grp(20, '1e+20') + grp(30, '1e+20') +
    grp(9, '$PEXTMAX')      + grp(10, '-1e+20') + grp(20, '-1e+20') + grp(30, '-1e+20') +
    grp(9, '$PLIMMIN')      + grp(10, '0.0') + grp(20, '0.0') +
    grp(9, '$PLIMMAX')      + grp(10, '420.0') + grp(20, '297.0') +
    grp(9, '$VISRETAIN')    + grp(70,  1) +
    grp(9, '$PSLTSCALE')    + grp(70,  1) +
    grp(9, '$MEASUREMENT')  + grp(70,  1) +
    grp(9, '$CELWEIGHT')    + grp(370, -1) +
    grp(9, '$ENDCAPS')      + grp(280, 0) +
    grp(9, '$JOINSTYLE')    + grp(280, 0) +
    grp(9, '$LWDISPLAY')    + grp(290, 0) +
    grp(9, '$INSUNITS')     + grp(70,  4) +
    grp(9, '$HYPERLINKBASE')+ grp(1,   '') +
    grp(9, '$STYLESHEET')   + grp(1,   '') +
    grp(9, '$XEDIT')        + grp(290, 1) +
    grp(9, '$CEPSNTYPE')    + grp(380, 0) +
    grp(9, '$PSTYLEMODE')   + grp(290, 1) +
    grp(9, '$EXTNAMES')     + grp(290, 1) +
    grp(9, '$PSVPSCALE')    + grp(40,  '0.0') +
    grp(9, '$OLESTARTUP')      + grp(290, 0) +
    grp(9, '$FINGERPRINTGUID') + grp(2, '{00000000-0000-0000-0000-000000000000}') +
    grp(9, '$VERSIONGUID')     + grp(2, '{00000000-0000-0000-0000-000000000000}') +
    grp(9, '$HANDSEED')        + grp(5, 'FFFF') +
    grp(0, 'ENDSEC')

  // ── TABLES ────────────────────────────────────────────────────────────────
  // Spec requirements (verified against ezdxf R2000 reference output):
  //   • Every TABLE:  5(handle) + 330(owner=0) + 100 AcDbSymbolTable + 70(count)
  //   • DIMSTYLE only: extra 100 AcDbDimStyleTable AFTER 70 — no 71 needed
  //   • DIMSTYLE records use handle code 105 instead of 5
  //   • LAYER entries: 70(flags) + 62(color) + 6(linetype) + 370(lineweight) + 390(plotstyle)
  //   • BLOCK_RECORD table required in R2000; entries pointed to by BLOCK/ENDBLK owners

  // VPORT — *Active viewport entry required
  const vportTH = nextH()
  const vportTables = (
    grp(0, 'TABLE') + grp(2, 'VPORT') + hdl(vportTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 1) +
    grp(0, 'VPORT') + hdl(nextH(), vportTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbViewportTableRecord') +
    grp(2, '*Active') + grp(70, 0) +
    grp(10, '0.0') + grp(20, '0.0') +
    grp(11, '1.0') + grp(21, '1.0') +
    grp(12, '0.0') + grp(22, '0.0') +
    grp(13, '0.0') + grp(23, '0.0') +
    grp(14, '1.0') + grp(24, '1.0') +
    grp(15, '1.0') + grp(25, '1.0') +
    grp(16, '0.0') + grp(26, '0.0') + grp(36, '1.0') +
    grp(17, '0.0') + grp(27, '0.0') + grp(37, '0.0') +
    grp(40, '1000.0') + grp(41, '1.34') +
    grp(42, '50.0') + grp(43, '0.0') + grp(44, '0.0') +
    grp(50, '0.0') + grp(51, '0.0') +
    grp(71, 0) + grp(72, 1000) + grp(73, 1) + grp(74, 3) +
    grp(75, 0) + grp(76, 0) + grp(77, 0) + grp(78, 0) +
    grp(281, 0) + grp(65, 0) +
    grp(0, 'ENDTAB')
  )

  // LTYPE — ByBlock, ByLayer, and Continuous are all required by AutoCAD/ZWCAD.
  // ByLayer and ByBlock must be present or the CAD tool reports "missing default ByLayer".
  // All three use an empty description (group 3) per ezdxf R2000 reference output.
  const ltypeTH = nextH()
  const ltypeRecord = (name: string) =>
    grp(0, 'LTYPE') + hdl(nextH(), ltypeTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbLinetypeTableRecord') +
    grp(2, name) + grp(70, 0) +
    grp(3, '') + grp(72, 65) + grp(73, 0) + grp(40, '0.0')
  const ltypeTables = (
    grp(0, 'TABLE') + grp(2, 'LTYPE') + hdl(ltypeTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 3) +
    ltypeRecord('ByBlock') +
    ltypeRecord('ByLayer') +
    ltypeRecord('Continuous') +
    grp(0, 'ENDTAB')
  )

  // LAYER — every layer referenced by entities must be declared here.
  // Strict CAD tools (ZWCAD etc.) reject DXF files that use undefined layers.
  const layerTH = nextH()
  // plot=true → normal layer; plot=false → group 290 0 (Defpoints must not plot)
  const layerRecord = (name: string, color: number, plot = true) =>
    grp(0, 'LAYER') + hdl(nextH(), layerTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbLayerTableRecord') +
    grp(2, name) + grp(70, 0) + grp(62, color) + grp(6, 'Continuous') +
    (plot ? '' : grp(290, 0)) +
    grp(370, -3) + grp(390, plotStyleH)
  // 12 layers total: 0, Defpoints, + all PASCAL_* layers used by entities
  const layerTables = (
    grp(0, 'TABLE') + grp(2, 'LAYER') + hdl(layerTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 12) +
    layerRecord('0',                       7) +
    layerRecord('Defpoints',               7, false) +
    layerRecord('PASCAL_WALL_EXT_FACE',    7) +
    layerRecord('PASCAL_WALL_EXT_CL',      8) +
    layerRecord('PASCAL_WALL_INT_FACE',  252) +
    layerRecord('PASCAL_WALL_INT_CL',      9) +
    layerRecord('PASCAL_DOOR',             3) +
    layerRecord('PASCAL_WINDOW',           5) +
    layerRecord('PASCAL_ZONE',             1) +
    layerRecord('PASCAL_ZONE_LABEL',       2) +
    layerRecord('PASCAL_FURNITURE',        6) +
    layerRecord('PASCAL_STAIR',           30) +
    grp(0, 'ENDTAB')
  )

  // STYLE — Standard text style required
  const styleTH = nextH()
  const styleTables = (
    grp(0, 'TABLE') + grp(2, 'STYLE') + hdl(styleTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 1) +
    grp(0, 'STYLE') + hdl(nextH(), styleTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbTextStyleTableRecord') +
    grp(2, 'Standard') + grp(70, 0) + grp(40, '0.0') + grp(41, '1.0') +
    grp(50, '0.0') + grp(71, 0) + grp(42, '2.5') +
    grp(3, '') + grp(4, '') +
    grp(0, 'ENDTAB')
  )

  // VIEW — empty table required
  const viewTH = nextH()
  const viewTables = (
    grp(0, 'TABLE') + grp(2, 'VIEW') + hdl(viewTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 0) +
    grp(0, 'ENDTAB')
  )

  // UCS — empty table required
  const ucsTH = nextH()
  const ucsTables = (
    grp(0, 'TABLE') + grp(2, 'UCS') + hdl(ucsTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 0) +
    grp(0, 'ENDTAB')
  )

  // APPID — ACAD application ID required
  const appidTH = nextH()
  const appidTables = (
    grp(0, 'TABLE') + grp(2, 'APPID') + hdl(appidTH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 2) +
    grp(0, 'APPID') + hdl(nextH(), appidTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbRegAppTableRecord') +
    grp(2, 'ACAD') + grp(70, 0) +
    grp(0, 'APPID') + hdl(nextH(), appidTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbRegAppTableRecord') +
    grp(2, 'HATCHBACKGROUNDCOLOR') + grp(70, 0) +
    grp(0, 'ENDTAB')
  )

  // DIMSTYLE — requires 100 AcDbDimStyleTable after 70; records use 105 not 5.
  // No group code 71 after AcDbDimStyleTable (ezdxf R2000 reference does not emit one).
  const dimTH = nextH()
  const dimEntryH = nextH()
  const dimTables = (
    grp(0, 'TABLE') + grp(2, 'DIMSTYLE') + hdl(dimTH) +
    grp(100, 'AcDbSymbolTable') +
    grp(70, 1) +
    grp(100, 'AcDbDimStyleTable') +
    grp(0, 'DIMSTYLE') +
    grp(105, dimEntryH) + grp(330, dimTH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbDimStyleTableRecord') +
    grp(2, 'Standard') + grp(70, 0) +
    grp(3, '') + grp(4, '') +
    grp(40, '1.0') + grp(41, '2.5') + grp(42, '0.625') +
    grp(43, '3.75') + grp(44, '1.25') + grp(45, '0.0') +
    grp(46, '0.0') + grp(47, '0.0') + grp(48, '0.0') +
    grp(140, '2.5') + grp(141, '2.5') + grp(142, '0.0') +
    grp(143, '0.03937007874') + grp(144, '1.0') +
    grp(145, '0.0') + grp(146, '1.0') + grp(147, '0.625') + grp(148, '0.0') +
    grp(71, 0) + grp(72, 0) + grp(73, 0) + grp(74, 0) +
    grp(75, 0) + grp(76, 0) + grp(77, 1) + grp(78, 8) + grp(79, 3) +
    grp(170, 0) + grp(171, 3) + grp(172, 1) + grp(173, 0) +
    grp(174, 0) + grp(175, 0) + grp(176, 0) + grp(177, 0) + grp(178, 0) + grp(179, 2) +
    grp(271, 2) + grp(272, 2) + grp(273, 2) + grp(274, 3) +
    grp(275, 0) + grp(276, 0) + grp(277, 2) + grp(278, 44) + grp(279, 0) +
    grp(280, 0) + grp(281, 0) + grp(282, 0) + grp(283, 0) +
    grp(284, 8) + grp(285, 0) + grp(286, 0) + grp(288, 0) + grp(289, 3) +
    grp(371, -2) + grp(372, -2) +
    grp(0, 'ENDTAB')
  )

  // BLOCK_RECORD — required in R2000; each block in BLOCKS must have a record here.
  // The BLOCK/ENDBLK 330 owner fields point to these record handles.
  const blockRecTables = (
    grp(0, 'TABLE') + grp(2, 'BLOCK_RECORD') + hdl(blockRecTableH) +
    grp(100, 'AcDbSymbolTable') + grp(70, 2) +
    grp(0, 'BLOCK_RECORD') + hdl(modelSpaceRecH, blockRecTableH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbBlockTableRecord') +
    grp(2, '*Model_Space') + grp(340, modelLayoutH) +
    grp(0, 'BLOCK_RECORD') + hdl(paperSpaceRecH, blockRecTableH) +
    grp(100, 'AcDbSymbolTableRecord') +
    grp(100, 'AcDbBlockTableRecord') +
    grp(2, '*Paper_Space') + grp(340, paperLayoutH) +
    grp(0, 'ENDTAB')
  )

  const tables =
    grp(0, 'SECTION') + grp(2, 'TABLES') +
    vportTables +
    ltypeTables +
    layerTables +
    styleTables +
    viewTables +
    ucsTables +
    appidTables +
    dimTables +
    blockRecTables +
    grp(0, 'ENDSEC')

  // ── BLOCKS ────────────────────────────────────────────────────────────────
  // BLOCK/ENDBLK owner (330) must point to the corresponding BLOCK_RECORD handle.
  const blk = (name: string, recH: string) => {
    const hBlock = nextH()
    const hEnd   = nextH()
    return (
      grp(0, 'BLOCK') + grp(5, hBlock) + grp(330, recH) +
      grp(100, 'AcDbEntity') + grp(8, '0') +
      grp(100, 'AcDbBlockBegin') +
      grp(2, name) + grp(70, 0) +
      grp(10, '0.0') + grp(20, '0.0') + grp(30, '0.0') +
      grp(3, name) + grp(1, '') +
      grp(0, 'ENDBLK') + grp(5, hEnd) + grp(330, recH) +
      grp(100, 'AcDbEntity') + grp(8, '0') +
      grp(100, 'AcDbBlockEnd')
    )
  }

  const blocks =
    grp(0, 'SECTION') + grp(2, 'BLOCKS') +
    blk('*Model_Space', modelSpaceRecH) +
    blk('*Paper_Space', paperSpaceRecH) +
    grp(0, 'ENDSEC')

  const entitiesSection =
    grp(0, 'SECTION') + grp(2, 'ENTITIES') +
    entities +
    grp(0, 'ENDSEC')

  // ── OBJECTS ───────────────────────────────────────────────────────────────
  // Autodesk viewer and AutoCAD require:
  //   • Root DICTIONARY with ACAD_LAYOUT and ACAD_PLOTSTYLENAME entries
  //   • ACAD_LAYOUT dictionary → LAYOUT objects for Model + Paper space
  //   • LAYOUT objects linked back to their BLOCK_RECORD via second 330
  //   • BLOCK_RECORD entries carry 340 pointing to their LAYOUT
  //   • ACAD_PLOTSTYLENAME + ACDBPLACEHOLDER for plot style handles

  // Minimal AcDbPlotSettings block shared by both LAYOUT objects
  const plotSettings = (modelLayout: boolean) =>
    grp(100, 'AcDbPlotSettings') +
    grp(1, '') + grp(4, 'A3') + grp(6, '') +
    grp(40, '7.5') + grp(41, '20.0') + grp(42, '7.5') + grp(43, '20.0') +
    grp(44, '420.0') + grp(45, '297.0') +
    grp(46, '0.0') + grp(47, '0.0') + grp(48, '0.0') + grp(49, '0.0') +
    grp(140, '0.0') + grp(141, '0.0') + grp(142, '1.0') + grp(143, '1.0') +
    grp(70, modelLayout ? 1024 : 0) +
    grp(72, 1) + grp(73, 0) + grp(74, 5) + grp(7, '') +
    grp(75, 16) + grp(76, 0) + grp(77, 2) + grp(78, 300) +
    grp(147, '1.0') + grp(148, '0.0') + grp(149, '0.0')

  // AcDbLayout body; second 330 = back-reference to BLOCK_RECORD (required)
  const layoutBody = (name: string, tabOrder: number, blockRecH: string) =>
    grp(100, 'AcDbLayout') +
    grp(1, name) + grp(70, 1) + grp(71, tabOrder) +
    grp(10, '0.0') + grp(20, '0.0') +
    grp(11, '420.0') + grp(21, '297.0') +
    grp(12, '0.0') + grp(22, '0.0') + grp(32, '0.0') +
    grp(14, '1e+20') + grp(24, '1e+20') + grp(34, '1e+20') +
    grp(15, '-1e+20') + grp(25, '-1e+20') + grp(35, '-1e+20') +
    grp(146, '0.0') +
    grp(13, '0.0') + grp(23, '0.0') + grp(33, '0.0') +
    grp(16, '1.0') + grp(26, '0.0') + grp(36, '0.0') +
    grp(17, '0.0') + grp(27, '1.0') + grp(37, '0.0') +
    grp(76, 1) +
    grp(330, blockRecH)

  // MATERIAL object body — identical structure for ByBlock, ByLayer, Global
  const materialBody = (name: string) =>
    grp(100, 'AcDbMaterial') +
    grp(1, name) + grp(2, '') +
    grp(70, 0) + grp(40, '1.0') + grp(71, 1) + grp(41, '1.0') +
    grp(91, -1023410177) + grp(42, '1.0') + grp(72, 1) + grp(3, '') +
    grp(73, 1) + grp(74, 1) + grp(75, 1) + grp(44, '0.5') +
    grp(73, 0) + grp(45, '1.0') + grp(46, '1.0') + grp(77, 1) +
    grp(4, '') + grp(78, 1) + grp(79, 1) + grp(170, 1) +
    grp(48, '1.0') + grp(171, 1) + grp(6, '') + grp(172, 1) +
    grp(173, 1) + grp(174, 1) + grp(140, '1.0') + grp(141, '1.0') +
    grp(175, 1) + grp(7, '') + grp(176, 1) + grp(177, 1) +
    grp(178, 1) + grp(143, '1.0') + grp(179, 1) + grp(8, '') +
    grp(270, 1) + grp(271, 1) + grp(272, 1) + grp(145, '1.0') +
    grp(146, '1.0') + grp(273, 1) + grp(9, '') + grp(274, 1) +
    grp(275, 1) + grp(276, 1) + grp(42, '1.0') + grp(72, 1) +
    grp(3, '') + grp(73, 1) + grp(74, 1) + grp(75, 1) + grp(94, 63)

  const emptyDict = (h: string) =>
    grp(0, 'DICTIONARY') + hdl(h, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1)

  const objects =
    grp(0, 'SECTION') + grp(2, 'OBJECTS') +
    // Root dictionary — all standard ACAD_* entries required by Autodesk viewer
    grp(0, 'DICTIONARY') + hdl(rootDictH, '0') +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'ACAD_LAYOUT')        + grp(350, layoutDictH) +
    grp(3, 'ACAD_PLOTSTYLENAME') + grp(350, plotStyleNameDictH) +
    grp(3, 'ACAD_COLOR')         + grp(350, colorDictH) +
    grp(3, 'ACAD_GROUP')         + grp(350, groupDictH) +
    grp(3, 'ACAD_MATERIAL')      + grp(350, materialDictH) +
    grp(3, 'ACAD_MLEADERSTYLE')  + grp(350, mleaderDictH) +
    grp(3, 'ACAD_MLINESTYLE')    + grp(350, mlineDictH) +
    grp(3, 'ACAD_PLOTSETTINGS')  + grp(350, plotSettingsDictH) +
    grp(3, 'ACAD_SCALELIST')     + grp(350, scaleDictH) +
    grp(3, 'ACAD_TABLESTYLE')    + grp(350, tableDictH) +
    grp(3, 'ACAD_VISUALSTYLE')   + grp(350, visualDictH) +
    // ACAD_LAYOUT dictionary
    grp(0, 'DICTIONARY') + hdl(layoutDictH, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'Model')   + grp(350, modelLayoutH) +
    grp(3, 'Layout1') + grp(350, paperLayoutH) +
    // LAYOUT: Model Space (tabOrder=0)
    grp(0, 'LAYOUT') + hdl(modelLayoutH, layoutDictH) +
    plotSettings(true) +
    layoutBody('Model', 0, modelSpaceRecH) +
    // LAYOUT: Paper Space (tabOrder=1)
    grp(0, 'LAYOUT') + hdl(paperLayoutH, layoutDictH) +
    plotSettings(false) +
    layoutBody('Layout1', 1, paperSpaceRecH) +
    // ACAD_PLOTSTYLENAME dictionary — plain AcDbDictionary only (no AcDbDictionaryWithDefault)
    grp(0, 'DICTIONARY') + hdl(plotStyleNameDictH, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'Normal') + grp(350, plotStyleH) +
    // ACDBPLACEHOLDER — the "Normal" plot style object
    grp(0, 'ACDBPLACEHOLDER') + hdl(plotStyleH, plotStyleNameDictH) +
    // Empty sub-dictionaries for standard ACAD_* entries
    emptyDict(colorDictH) +
    emptyDict(groupDictH) +
    // ACAD_MATERIAL dict with three standard materials
    grp(0, 'DICTIONARY') + hdl(materialDictH, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'ByBlock') + grp(350, matByBlockH) +
    grp(3, 'ByLayer') + grp(350, matByLayerH) +
    grp(3, 'Global')  + grp(350, matGlobalH) +
    // ACAD_MLEADERSTYLE dict
    grp(0, 'DICTIONARY') + hdl(mleaderDictH, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'Standard') + grp(350, mleaderStyleH) +
    // ACAD_MLINESTYLE dict
    grp(0, 'DICTIONARY') + hdl(mlineDictH, rootDictH) +
    grp(100, 'AcDbDictionary') + grp(281, 1) +
    grp(3, 'Standard') + grp(350, mlineStyleH) +
    emptyDict(plotSettingsDictH) +
    emptyDict(scaleDictH) +
    emptyDict(tableDictH) +
    emptyDict(visualDictH) +
    // Three standard MATERIAL objects
    grp(0, 'MATERIAL') +
    grp(102, '{ACAD_REACTORS') + grp(330, materialDictH) + grp(102, '}') +
    hdl(matByBlockH, materialDictH) + materialBody('ByBlock') +
    grp(0, 'MATERIAL') +
    grp(102, '{ACAD_REACTORS') + grp(330, materialDictH) + grp(102, '}') +
    hdl(matByLayerH, materialDictH) + materialBody('ByLayer') +
    grp(0, 'MATERIAL') +
    grp(102, '{ACAD_REACTORS') + grp(330, materialDictH) + grp(102, '}') +
    hdl(matGlobalH, materialDictH) + materialBody('Global') +
    // MLINESTYLE Standard
    grp(0, 'MLINESTYLE') +
    grp(102, '{ACAD_REACTORS') + grp(330, mlineDictH) + grp(102, '}') +
    hdl(mlineStyleH, mlineDictH) +
    grp(100, 'AcDbMlineStyle') +
    grp(2, 'Standard') + grp(70, 0) + grp(3, '') +
    grp(62, 256) + grp(51, '90.0') + grp(52, '90.0') + grp(71, 2) +
    grp(49, '0.5') + grp(62, 256) + grp(6, 'BYLAYER') +
    grp(49, '-0.5') + grp(62, 256) + grp(6, 'BYLAYER') +
    // MLEADERSTYLE Standard
    grp(0, 'MLEADERSTYLE') +
    grp(102, '{ACAD_REACTORS') + grp(330, mleaderDictH) + grp(102, '}') +
    hdl(mleaderStyleH, mleaderDictH) +
    grp(100, 'AcDbMLeaderStyle') +
    grp(179, 2) + grp(170, 2) + grp(171, 1) + grp(172, 0) +
    grp(90, 2) + grp(40, '0.0') + grp(41, '0.0') +
    grp(173, 1) + grp(91, -1056964608) + grp(92, -2) +
    grp(290, 1) + grp(42, '2.0') + grp(291, 1) + grp(43, '8.0') +
    grp(3, 'Standard') + grp(44, '4.0') + grp(300, '') +
    grp(174, 1) + grp(175, 1) + grp(176, 0) + grp(178, 1) +
    grp(93, -1056964608) + grp(45, '4.0') + grp(292, 0) + grp(297, 0) +
    grp(46, '4.0') + grp(94, -1056964608) + grp(47, '1.0') +
    grp(49, '1.0') + grp(140, '1.0') + grp(294, 1) + grp(141, '0.0') +
    grp(177, 0) + grp(142, '1.0') + grp(295, 0) + grp(296, 0) +
    grp(143, '3.75') + grp(271, 0) + grp(272, 9) + grp(273, 9) +
    grp(0, 'ENDSEC')

  // DXF R2000 mandatory section order: HEADER → CLASSES → TABLES → BLOCKS → ENTITIES → OBJECTS
  return header + classes + tables + blocks + entitiesSection + objects + grp(0, 'EOF')
}
