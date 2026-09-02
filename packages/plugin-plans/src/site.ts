/**
 * Site-plan editing — the scene-side half.
 *
 * The house moves by moving the BUILDING node (`position` metres in site
 * coordinates, `rotation[1]` radians about Y) — the same fields the editor's
 * own "move building" affordance writes, so the two never disagree. Yards are
 * typed onto the SITE node's metadata in metres (`setbacks`, `setbacksSource`,
 * `zone`) and the Plans API carries them to the sheet; it decides whether
 * they are ESTABLISHED (numbers without a source are drawing state).
 *
 * The yard readout here is an ESTIMATE from the level-0 wall bounding box —
 * enough to steer by. A1.0 is authoritative.
 */
import { useScene } from '@pascal-app/core'

export const FT = 0.3048

type AnyNode = Record<string, unknown> & { id: string; type: string; children?: string[] }

export interface Setbacks {
  front?: number
  side?: number
  rear?: number
}

export interface SiteRead {
  siteId?: string
  buildingId?: string
  /** metres, site frame */
  position: [number, number, number]
  /** radians about Y */
  rotationY: number
  lot: [number, number][]
  isParcel: boolean
  apn?: string
  /** metres */
  setbacks: Setbacks
  setbacksSource: string
  zone: string
  /** metres, site frame, from the level-0 wall bbox; null when no walls */
  yards: { north: number | null; south: number | null; east: number | null; west: number | null } | null
  footprintOutsideLot: boolean
}

function nodes(): Record<string, AnyNode> {
  return (useScene.getState() as { nodes: Record<string, AnyNode> }).nodes
}

function num(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : d
}

/** local (building) → site, three.js Y-rotation sign: world = (c·lx + s·lz, −s·lx + c·lz) + P */
function toSite(lx: number, lz: number, pos: [number, number, number], ry: number): [number, number] {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  return [c * lx + s * lz + pos[0], -s * lx + c * lz + pos[2]]
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance along direction d from p to the first lot edge hit, or null. */
function castRay(p: [number, number], d: [number, number], poly: [number, number][]): number | null {
  let best: number | null = null
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!
    const b = poly[i]!
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-12) continue
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den
    const u = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den
    if (t > 1e-9 && u >= 0 && u <= 1 && (best === null || t < best)) best = t
  }
  return best
}

export function readSite(): SiteRead {
  const all = nodes()
  const out: SiteRead = {
    position: [0, 0, 0],
    rotationY: 0,
    lot: [],
    isParcel: false,
    setbacks: {},
    setbacksSource: '',
    zone: '',
    yards: null,
    footprintOutsideLot: false,
  }
  let site: AnyNode | undefined
  let building: AnyNode | undefined
  for (const n of Object.values(all)) {
    if (!site && n.type === 'site') site = n
    if (!building && n.type === 'building') building = n
  }
  if (site) {
    out.siteId = site.id
    const poly = site.polygon as { points?: unknown } | undefined
    const pts = Array.isArray(poly?.points) ? (poly!.points as unknown[]) : []
    out.lot = pts
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .map((p) => [num(p[0]), num(p[1])])
    const m = (site.metadata ?? {}) as Record<string, unknown>
    out.isParcel = m.source === 'gis-parcel'
    if (typeof m.apn === 'string') out.apn = m.apn
    const sb = (m.setbacks ?? {}) as Record<string, unknown>
    for (const k of ['front', 'side', 'rear'] as const) {
      if (Number.isFinite(Number(sb[k])) && sb[k] !== undefined && sb[k] !== null) out.setbacks[k] = Number(sb[k])
    }
    out.setbacksSource = typeof m.setbacksSource === 'string' ? m.setbacksSource : ''
    out.zone = typeof m.zone === 'string' ? m.zone : ''
  }
  if (building) {
    out.buildingId = building.id
    const p = Array.isArray(building.position) ? (building.position as unknown[]) : []
    out.position = [num(p[0]), num(p[1]), num(p[2])]
    const r = Array.isArray(building.rotation) ? (building.rotation as unknown[]) : []
    out.rotationY = num(r[1])
    out.yards = estimateYards(all, building, out)
  }
  return out
}

function estimateYards(all: Record<string, AnyNode>, building: AnyNode, s: SiteRead): SiteRead['yards'] {
  if (s.lot.length < 3) return null
  // lowest level's walls, endpoints → site frame
  const levels = (building.children ?? []).map((id) => all[id]).filter((n): n is AnyNode => !!n && n.type === 'level')
  levels.sort((a, b) => num(a.level) - num(b.level))
  const lvl = levels[0]!
  if (!lvl) return null
  const pts: [number, number][] = []
  for (const id of lvl.children ?? []) {
    const w = all[id]
    if (!w || w.type !== 'wall') continue
    for (const k of ['start', 'end']) {
      const e = w[k] as unknown
      if (Array.isArray(e) && e.length >= 2) pts.push(toSite(num(e[0]), num(e[1]), s.position, s.rotationY))
    }
  }
  if (pts.length < 2) return null
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity
  for (const [x, z] of pts) {
    if (x < minx) minx = x
    if (x > maxx) maxx = x
    if (z < minz) minz = z
    if (z > maxz) maxz = z
  }
  s.footprintOutsideLot = !pts.every(([x, z]) => pointInPoly(x, z, s.lot))
  const along = (a: number, b: number, k: number) => a + ((b - a) * (k + 0.5)) / 5
  const cast = (edge: (k: number) => [number, number], d: [number, number]) => {
    let best: number | null = null
    for (let k = 0; k < 5; k++) {
      const t = castRay(edge(k), d, s.lot)
      if (t !== null && (best === null || t < best)) best = t
    }
    return best
  }
  return {
    north: cast((k) => [along(minx, maxx, k), minz], [0, -1]),
    south: cast((k) => [along(minx, maxx, k), maxz], [0, 1]),
    east: cast((k) => [maxx, along(minz, maxz, k)], [1, 0]),
    west: cast((k) => [minx, along(minz, maxz, k)], [-1, 0]),
  }
}

/* ---------------------------------------------------------------- writes */

function update(id: string, data: Record<string, unknown>) {
  ;(useScene.getState() as { updateNode: (id: string, data: Record<string, unknown>) => void }).updateNode(id, data)
}

/** Move the building by (dx, dz) metres in the SITE frame. */
export function nudgeBuilding(dxM: number, dzM: number): void {
  const s = readSite()
  if (!s.buildingId) return
  update(s.buildingId, { position: [s.position[0] + dxM, s.position[1], s.position[2] + dzM] })
}

export function setBuildingPosition(xM: number, zM: number): void {
  const s = readSite()
  if (!s.buildingId) return
  update(s.buildingId, { position: [xM, s.position[1], zM] })
}

export function setBuildingRotationDeg(deg: number): void {
  const s = readSite()
  if (!s.buildingId) return
  update(s.buildingId, { rotation: [0, (deg * Math.PI) / 180, 0] })
}

export function rotateBuildingDeg(deltaDeg: number): void {
  const s = readSite()
  setBuildingRotationDeg(((s.rotationY * 180) / Math.PI + deltaDeg + 540) % 360 - 180)
}

/** Yards in metres (undefined clears), plus provenance. Written to the site node's metadata. */
export function setSetbacks(sb: Setbacks, source: string, zone: string): void {
  const s = readSite()
  if (!s.siteId) return
  const site = nodes()[s.siteId]
  const prior = (site?.metadata ?? {}) as Record<string, unknown>
  const clean: Record<string, number> = {}
  for (const k of ['front', 'side', 'rear'] as const) {
    const v = sb[k]
    if (v !== undefined && Number.isFinite(v) && v >= 0) clean[k] = v
  }
  const metadata: Record<string, unknown> = { ...prior }
  if (Object.keys(clean).length) metadata.setbacks = clean
  else delete metadata.setbacks
  if (source.trim()) metadata.setbacksSource = source.trim()
  else delete metadata.setbacksSource
  if (zone.trim()) metadata.zone = zone.trim()
  else delete metadata.zone
  update(s.siteId, { metadata })
}

/**
 * Move the house by a delta expressed on the SHEET's site plan, i.e. in the
 * HA (building-frame) plan: inches, x east, y south. The building node lives
 * in the site frame, so the delta turns by the building's Y rotation first
 * (three.js: world = (c·lx + s·lz, −s·lx + c·lz)).
 */
export function moveHouseBySheetInches(dxIn: number, dyIn: number): void {
  const s = readSite()
  const c = Math.cos(s.rotationY)
  const sn = Math.sin(s.rotationY)
  const dx = dxIn * 0.0254
  const dz = dyIn * 0.0254
  nudgeBuilding(c * dx + sn * dz, -sn * dx + c * dz)
}

/** Set one required yard (metres). `left`/`right` write the shared `side` yard. */
export function setRequiredYard(kind: string, metres: number | undefined): void {
  const s = readSite()
  const sb = { ...s.setbacks }
  const k = kind === 'left' || kind === 'right' ? 'side' : kind
  if (k !== 'front' && k !== 'side' && k !== 'rear') return
  if (metres === undefined) delete sb[k]
  else sb[k] = metres
  setSetbacks(sb, s.setbacksSource, s.zone)
}

/** "20", "20.5", "20'-6\"", "20' 6", "20ft 6in" → inches; null when unreadable. */
export function parseFtIn(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/ft/g, "'").replace(/in\b/g, '"')
  if (!t) return null
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*'?\s*(?:-|\s)?\s*(\d+(?:\.\d+)?)?\s*"?$/)
  if (!m) return null
  const ft = Number(m[1])
  const inches = m[2] !== undefined ? Number(m[2]) : 0
  if (!Number.isFinite(ft) || !Number.isFinite(inches)) return null
  return m[2] === undefined ? ft * 12 : Math.sign(ft || 1) * (Math.abs(ft) * 12 + inches)
}

export function fmtFt(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  const ft = m / FT
  const whole = Math.floor(Math.abs(ft))
  const inches = Math.round((Math.abs(ft) - whole) * 12)
  const sign = ft < 0 ? '-' : ''
  return inches === 12 ? `${sign}${whole + 1}'-0"` : `${sign}${whole}'-${inches}"`
}
