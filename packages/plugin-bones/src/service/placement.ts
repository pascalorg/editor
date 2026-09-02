import { inches } from '../core/units'
import { effectiveViewMode, type ViewMode } from '../framing/schema'
import type { ServiceNode, ServiceType } from './schema'

/**
 * Pure placement resolution for `bones:service` nodes — shared by the 3D
 * renderer and the engine override extraction, and testable headlessly
 * (no React, no three.js).
 */

export type BodySpec = {
  /** Box dims [w, h, d] — d is the off-wall axis. */
  dims: readonly [number, number, number]
  color: string
  /** Default mount height (device CENTER, m AFF) when `heightAff` is unset. */
  defaultAff: number
  /** Sign text (the panel also gets a drawn bolt glyph). */
  sign: string
}

/** Equipment look per type — panel grey enclosure, WH per the engine's tank,
 * water entry valve box, sewer 4" stub at the floor, power cable head,
 * thermostat puck, heat-pump outdoor cabinet on its pad, meter socket. */
export const SERVICE_BODY: Record<ServiceType, BodySpec> = {
  panel: { dims: [0.4, 0.6, 0.1], color: '#8f8f8f', defaultAff: inches(60), sign: 'PANEL' },
  'water-heater': { dims: [0.6, 1.5, 0.6], color: '#c7c9cc', defaultAff: 1.2, sign: 'WH' },
  'water-entry': { dims: [0.2, 0.2, 0.14], color: '#3f6fae', defaultAff: 0.3, sign: 'WATER' },
  'sewer-exit': { dims: [inches(4), 0.3, inches(4)], color: '#5b6670', defaultAff: 0.15, sign: 'SEWER' },
  'power-entry': { dims: [0.12, 0.28, 0.12], color: '#3a3a3e', defaultAff: 2.2, sign: 'POWER' },
  thermostat: { dims: [0.09, 0.12, 0.03], color: '#e9e9e6', defaultAff: inches(52), sign: 'TSTAT' },
  // Heat-pump placeholder mirrors the ENGINE's cabinet truth (hvac
  // CONDENSER_UNIT_DIMS 0.95×0.85×0.95 — true top-discharge proportions,
  // unwarp round 2026-08-23) so basement/toggle-off placeholders and the
  // move-tool ghost read the same footprint the X-ray unit occupies;
  // defaultAff = pad top (0.1016) + half the cabinet height.
  'heat-pump': { dims: [0.95, 0.85, 0.95], color: '#b9bec4', defaultAff: 0.5266, sign: 'HP' },
  'electric-meter': { dims: [0.2, 0.3, 0.15], color: '#9aa1a9', defaultAff: inches(55), sign: 'METER' },
}

/** Types that live on a wall face — a gizmo-moved `position` snaps back to
 * the nearest wall (mirroring the engines' nearestWallPoint override rule);
 * floor types (sewer exit, heat-pump pad) stand free wherever they're dropped. */
export const WALL_MOUNTED_TYPES: ReadonlySet<ServiceType> = new Set<ServiceType>([
  'panel',
  'water-heater',
  'water-entry',
  'power-entry',
  'thermostat',
  'electric-meter',
])

export type ServicePlacement = {
  /** Level-local position of the equipment center. */
  position: readonly [number, number, number]
  rotationY: number
  /** Wall thickness at the anchor (sign offset) — 0 when floor-placed. */
  wallThickness: number
  wallMounted: boolean
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const num = (v: unknown, fallback: number): number => (finite(v) ? v : fallback)

const pair = (v: unknown): readonly [number, number] | null =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
    ? [v[0], v[1]]
    : null

const POS_EPS = 1e-6

/**
 * True when `position` carries a real gizmo write: every component finite AND
 * off the schema default [0,0,0] (within 1e-6). The default means "never
 * moved"; NaN/Infinity components make the position unusable (never trust it).
 */
export function isMovedPosition(
  position: readonly unknown[] | undefined,
): position is readonly [number, number, number] {
  if (!Array.isArray(position) || position.length < 3) return false
  const [x, y, z] = position as unknown[]
  if (!finite(x) || !finite(y) || !finite(z)) return false
  return Math.abs(x) > POS_EPS || Math.abs(y) > POS_EPS || Math.abs(z) > POS_EPS
}

/** The node fields placement resolution reads (parentId scopes wall lookups). */
export type ServicePlacementNode = Pick<
  ServiceNode,
  'serviceType' | 'wallId' | 'wallT' | 'heightAff' | 'position' | 'rotation' | 'yawOverride'
> & { parentId?: string | null }

export type WallGeom = {
  start: readonly [number, number]
  end: readonly [number, number]
  thickness: number
}

/**
 * Pure geometric usability of a wall node: a straight (the lerp on a curved
 * wall is a chord — wrong), non-degenerate wall with plan endpoints. Level
 * scoping is the caller's job — see {@link usableWall}.
 */
export function wallGeom(wall: Record<string, unknown> | undefined): WallGeom | null {
  if (!wall || wall.type !== 'wall') return null
  if (Math.abs(num(wall.curveOffset, 0)) > 1e-6) return null
  const start = pair(wall.start)
  const end = pair(wall.end)
  if (!start || !end) return null
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.1) return null
  return { start, end, thickness: num(wall.thickness, 0.1) }
}

/**
 * A usable straight wall for anchoring on the node's own level. Missing,
 * non-wall, CURVED, FOREIGN-level (positions are level-local) or degenerate
 * walls are NOT anchors → null.
 */
export function usableWall(
  wall: Record<string, unknown> | undefined,
  node: Pick<ServicePlacementNode, 'parentId'>,
): WallGeom | null {
  if (!wall) return null
  if (
    typeof node.parentId === 'string' &&
    typeof wall.parentId === 'string' &&
    wall.parentId !== node.parentId
  ) {
    return null
  }
  return wallGeom(wall)
}

/** Clamped normalized coordinate of plan point `p` projected onto the wall axis. */
export function projectWallT(geom: WallGeom, p: readonly [number, number]): number {
  const dx = geom.end[0] - geom.start[0]
  const dz = geom.end[1] - geom.start[1]
  const len2 = dx * dx + dz * dz || 1
  return Math.max(0, Math.min(1, ((p[0] - geom.start[0]) * dx + (p[1] - geom.start[1]) * dz) / len2))
}

/** Plan point on the wall axis at normalized coordinate `t`. */
export function wallPointAt(geom: WallGeom, t: number): [number, number] {
  return [
    geom.start[0] + (geom.end[0] - geom.start[0]) * t,
    geom.start[1] + (geom.end[1] - geom.start[1]) * t,
  ]
}

/** Plan Y-rotation of the wall axis (matches {@link wallLerp}'s rotationY). */
export function wallAngle(geom: WallGeom): number {
  const dx = geom.end[0] - geom.start[0]
  const dz = geom.end[1] - geom.start[1]
  const len = Math.hypot(dx, dz) || 1
  return Math.atan2(-dz / len, dx / len)
}

function wallLerp(geom: WallGeom, t: number, y: number): ServicePlacement {
  const [x, z] = wallPointAt(geom, t)
  // Local +Z points along the wall's +normal [-dz, dx] (engine convention).
  return {
    position: [x, y, z],
    rotationY: wallAngle(geom),
    wallThickness: geom.thickness,
    wallMounted: true,
  }
}

/** The usable wall whose axis passes closest to plan point `p` — shared by
 * the nearest-wall visual snap and the drag frame's parent resolution
 * (both must agree on which wall a moved node belongs to). */
export function nearestUsableWall(
  nodes: Record<string, Record<string, unknown>>,
  node: Pick<ServicePlacementNode, 'parentId'>,
  p: readonly [number, number],
): { wallId: string; geom: WallGeom; t: number } | null {
  let best: { wallId: string; geom: WallGeom; t: number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const [id, cand] of Object.entries(nodes)) {
    const geom = usableWall(cand, node)
    if (!geom) continue
    const t = projectWallT(geom, p)
    const [x, z] = wallPointAt(geom, t)
    const d = Math.hypot(x - p[0], z - p[1])
    if (d < bestDist) {
      bestDist = d
      best = { wallId: id, geom, t }
    }
  }
  return best
}

/** Nearest point on any usable wall to plan point `p` — the renderer's analog
 * of the engines' nearestWallPoint (no opening avoidance: this is a visual
 * snap, the engines re-derive their own routed spot from the same node). */
function nearestWallSnap(
  nodes: Record<string, Record<string, unknown>>,
  node: ServicePlacementNode,
  p: readonly [number, number],
  y: number,
): ServicePlacement | null {
  const hit = nearestUsableWall(nodes, node, p)
  return hit ? wallLerp(hit.geom, hit.t, y) : null
}

/**
 * Resolve where a service node stands. Precedence (matches the engines'
 * `overrideWallPoint`):
 *  1. a gizmo-written `position` (non-default — see `isMovedPosition`) WINS
 *     over the wall anchor: wall types snap to the nearest wall, floor types
 *     stand free (otherwise host gizmo drags would silently no-op);
 *  2. default position → the `wallId`+`wallT` lerp (height `heightAff`);
 *  3. no usable anchor at all (missing/curved/foreign wall + never-moved
 *     position) → null: the engines auto-place and the renderer shows only
 *     a selectable stub.
 */
export function resolveServicePlacement(
  nodes: Record<string, Record<string, unknown>>,
  node: ServicePlacementNode,
): ServicePlacement | null {
  const body = SERVICE_BODY[node.serviceType]
  const y = num(node.heightAff, body.defaultAff)

  if (isMovedPosition(node.position)) {
    const [px, , pz] = node.position
    if (WALL_MOUNTED_TYPES.has(node.serviceType)) {
      const snap = nearestWallSnap(nodes, node, [px, pz], y)
      if (snap) return snap
    }
    return {
      position: [px, y, pz],
      // Floor types: a finite `yawOverride` (the heat-pump rotate gestures,
      // HP polish item 4) wins so the basement/toggle-off placeholder body
      // shows the SAME orientation the engine composes in X-ray; else the
      // legacy rotation[1] (inspector writes), else 0. (The X-ray pick
      // proxy stays consistent by construction: the renderer applies
      // `proxy.rotationY − placement.rotationY` on top of the group.)
      rotationY: num(node.yawOverride, num(node.rotation?.[1], 0)),
      wallThickness: 0,
      wallMounted: false,
    }
  }

  const wall = node.wallId ? usableWall(nodes[node.wallId], node) : null
  if (wall) {
    const t = Math.max(0, Math.min(1, num(node.wallT, 0.5)))
    return wallLerp(wall, t, y)
  }

  return null
}

/**
 * View-mode presentation of a `bones:service` node (skeptic advisory,
 * 2026-08-21: hazard-yellow sign plates were mode-blind — eight signs on a
 * "finished" house, auto-seeded with no click on legacy scenes).
 *
 * The call, aligned with the framing renderer's SURFACE_FIXTURE philosophy:
 *  - 'xray' / 'basement': equipment box + sign plate (the engineering read).
 *  - 'off' (finished house): sign plates ALWAYS hide; only the PHYSICAL
 *    equipment a real home shows keeps its body — panel enclosure, water
 *    heater tank, thermostat, heat-pump cabinet, meter socket, water entry
 *    (the shut-off/meter box). Conceptual markers hide entirely: the sewer
 *    exit (underground stub) and the power entry (the drop itself isn't
 *    modeled — a floating box mid-wall reads as debris).
 *  - No framing node on the level → 'xray' presentation: the point was
 *    placed deliberately and there is no view mode to respect
 *    (pre-automation behavior, unchanged).
 */
export type ServicePresentation = {
  body: boolean
  sign: boolean
  /** X-ray heat-pump only (Julien 2026-08-23, overruling the day-10
   * sign-as-only-handle trade): when the ENGINE renders the physical unit
   * at this node's anchor and the placeholder body yields, an INVISIBLE
   * pick proxy takes the unit's own footprint so hovering/clicking the
   * equipment selects the service node — the kitchen-island gesture. The
   * proxy geometry resolves in proxy.ts; false for the other suppressed
   * kinds (water-heater / electric-meter: wall-mounted, their sign plates
   * hug the equipment — follow-up candidates, stated). */
  pickProxy: boolean
}

export const PHYSICAL_SERVICE_TYPES: ReadonlySet<ServiceType> = new Set<ServiceType>([
  'panel',
  'water-heater',
  'water-entry',
  'thermostat',
  'heat-pump',
  'electric-meter',
])

/**
 * Kinds whose PHYSICAL counterpart the engines render AT THE SAME ANCHOR
 * (the service node is the engines' authoritative override, so the volumes
 * land coincident — heat-pump A/B evidence 2026-08-22: the grey placeholder
 * body swallowed the hvac condenser's AC-block asset with z-fight slivers,
 * W×H identical → coplanar faces), mapped to the framing-node toggle that
 * gates that engine's render:
 *  - heat-pump      → hvac condenser cabinet member (unit #1 sits AT the
 *                     anchor; renders as the AC-block asset in X-ray);
 *  - water-heater   → plumbing tank/tankless member, verbatim at the node's
 *                     wall point (the tankless box is FULLY inside the body);
 *  - electric-meter → electrical meter-socket fixture on the exterior face
 *                     (~90% embedded in the body).
 * In 'xray' with the engine toggle ON the body yields to the engine's
 * render and the sign plate stays (Julien 2026-08-22: keep the label);
 * the heat pump additionally mounts an invisible PICK PROXY at the unit
 * footprint (Julien 2026-08-23 — see ServicePresentation.pickProxy and
 * proxy.ts), so the equipment itself hovers/selects like a kitchen island.
 * Toggle OFF → the body RETURNS as the visual anchor (the toggle lives on
 * the same framing node the view mode does — reachable here). When the
 * toggle is ON but the engine emits nothing (the no-zones honesty case:
 * no served rooms ⇒ no condenser), the engine's silence is NOT readable
 * from scene nodes, so the sign stands alone — an accepted, stated trade.
 * Same-class but NOT suppressed (small/benign today, follow-up candidates):
 * panel (grey-in-grey fixture interpenetration), thermostat + water-entry
 * (small engine fixtures embedded at the same centerline point).
 */
export const ENGINE_RENDERED_SERVICE_TYPES: Partial<
  Record<ServiceType, 'showHvac' | 'showPlumbing' | 'showElectrical'>
> = {
  'heat-pump': 'showHvac',
  'water-heater': 'showPlumbing',
  'electric-meter': 'showElectrical',
}

/** The level's bones:framing node (lowest id wins on duplicates —
 * extraction parity); null = no X-ray on this level. */
export function levelFramingNode(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string | null | undefined,
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:framing' || node.parentId !== levelId) continue
    if (!best || String(node.id ?? '') < String(best.id ?? '')) best = node
  }
  return best
}

/** The level's view mode, resolved from its bones:framing node (lowest id
 * wins on duplicates — extraction parity); null = no X-ray on this level. */
export function levelViewMode(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string | null | undefined,
): ViewMode | null {
  const best = levelFramingNode(nodes, levelId)
  return best ? effectiveViewMode(best as { viewMode?: unknown; seeThrough?: unknown }) : null
}

export function servicePresentation(
  nodes: Record<string, Record<string, unknown>>,
  node: Pick<ServicePlacementNode, 'serviceType' | 'parentId'>,
): ServicePresentation {
  const framing = levelFramingNode(nodes, node.parentId)
  // No framing node → no engines render on this level → pre-automation
  // presentation (box + sign), unchanged.
  const mode = framing
    ? effectiveViewMode(framing as { viewMode?: unknown; seeThrough?: unknown })
    : null
  if (mode === 'off') {
    return { body: PHYSICAL_SERVICE_TYPES.has(node.serviceType), sign: false, pickProxy: false }
  }
  if (mode === 'xray' && framing) {
    const toggle = ENGINE_RENDERED_SERVICE_TYPES[node.serviceType]
    // Absent toggle field = schema default true (legacy nodes never re-parse).
    if (toggle && framing[toggle] !== false) {
      // Body yields to the engine's render; the heat pump ADDITIONALLY gets
      // the invisible pick proxy at the unit footprint (see the type doc).
      return { body: false, sign: true, pickProxy: node.serviceType === 'heat-pump' }
    }
  }
  // 'basement', 'xray' non-engine kinds, and no-framing levels: box + sign —
  // the visible body is the pick handle, no proxy needed.
  return { body: true, sign: true, pickProxy: false }
}
