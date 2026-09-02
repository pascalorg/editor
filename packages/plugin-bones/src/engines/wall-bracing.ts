/**
 * Wall bracing engine (IRC R602.10) — LOD-400 B9, v1.
 *
 * What v1 DOES: identifies braced-wall LINES from the exterior wall graph,
 * declares the bracing METHOD (CS-WSP — continuous sheathing, the method the
 * walls already build: the layer engine sheathes every exterior face), and
 * says honestly what is NOT verified — the R602.10.3 required panel length
 * and the Table R602.10.5 per-panel minimums are panel-schedule math (v2).
 * Every braced wall line therefore carries an assumption flag; nothing about
 * bracing is silently assumed compliant.
 *
 * What v1 does NOT do (stated, per the assumption-label contract): required
 * bracing amount by SDC/wind/storey (R602.10.3), the CS-WSP
 * adjacent-opening-height panel-length reduction (Table R602.10.5), interior
 * braced wall lines, angled-wall corner assignment (R602.10.1.1 45° rule —
 * v1 assigns an oblique wall to its DOMINANT plan axis), masonry bracing
 * (CMU walls brace as reinforced masonry — cmu.ts's story, not CS-WSP).
 *
 * The garage narrow-return PORTAL FRAME set (R602.10.6.4) lives in
 * wall-framing.ts — the opening frame owns that geometry; this module owns
 * the thresholds so table numbers live in one place.
 */

import type { FramingSpec } from '../core/spec'
import type { Member, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'

const EPS = 1e-6

/**
 * Walls whose perpendicular offset is within this of each other brace ONE
 * line — IRC R602.10.1.1: braced wall panels may be offset up to 4 ft from
 * the braced wall line.
 */
export const BRACED_LINE_OFFSET_TOL = feet(4)

/**
 * The v1 "narrow return" threshold: a wall segment beside a wide opening
 * shorter than 48" — the Table R602.10.5 minimum braced-wall-panel length
 * for Method WSP (the baseline column). CS-WSP allows shorter panels as a
 * function of the ADJACENT CLEAR OPENING HEIGHT — that reduction is
 * panel-schedule math (v2), so v1 uses the conservative 48" baseline and
 * says so.
 */
export const BRACED_PANEL_MIN_LENGTH = feet(4)

/**
 * Openings at/above this clear span put their returns in portal-frame
 * territory: R602.10.6.4 (Method CS-PF) covers header spans from 6 ft to
 * 18 ft — under 6 ft a normal braced panel beside the opening is the
 * prescriptive answer, not a portal. 6 ft is also the engine's existing
 * doubled-trimmer threshold (DOUBLE_TRIMMER_SPAN), so "wide opening" means
 * the same thing across the wall engine.
 */
export const PORTAL_OPENING_MIN_SPAN = feet(6)

/**
 * CS-PF is a TABULATED method with a DOMAIN: Table R602.10.5's portal
 * column ends at 10-ft wall height (16"/18"/20" at 8/9/10 ft) and Figure
 * R602.10.6.4 caps the portal frame at 10 ft MAX HEIGHT. Past that there
 * is no prescriptive portal to extrapolate — a formula inventing 22"/24"
 * minimums beyond the table is an implicit compliance claim outside the
 * method (skeptic round 1), so callers route taller walls to the
 * engineered-shear-wall flag path instead of hardware.
 */
export const PORTAL_MAX_WALL_HEIGHT = feet(10)

/**
 * Minimum CS-PF portal panel width — Table R602.10.5: 16" for 8-ft walls,
 * 18" at 9 ft, 20" at 10 ft. Between tabulated heights the requirement
 * snaps UP (conservative — the tableSpanFor convention): a 2.5 m (8.2 ft)
 * wall needs the 9-ft value, 18". Returns null past the 10-ft domain —
 * there is no CS-PF minimum to quote for a wall the method doesn't cover.
 */
export function portalMinPanelWidth(wallHeight: number): number | null {
  if (wallHeight > PORTAL_MAX_WALL_HEIGHT + 1e-9) return null
  const extraFt = Math.max(0, Math.ceil(wallHeight / feet(1) - 8 - 1e-9))
  return inches(16 + 2 * extraFt)
}

/** One braced wall line — a colinear-ish run of exterior walls. */
export type BracedWallLine = {
  /** Plan axis the line RUNS along ('x' = east-west walls). */
  axis: 'x' | 'z'
  /** Perpendicular offset of the line (m): mean z for x-lines, mean x for z-lines. */
  offset: number
  /** Deterministic label: X1, X2… / Z1, Z2… ordered by ascending offset. */
  label: string
  wallIds: string[]
  /** Sum of member wall lengths on the line (m). */
  totalLength: number
}

/**
 * Identify braced wall lines from the wall graph (v1): EXTERIOR straight
 * walls, bucketed by dominant plan axis, clustered by perpendicular offset
 * within the R602.10.1.1 4-ft tolerance. Deterministic: clusters greedily
 * in ascending-offset order, ties by wall id.
 */
export function identifyBracedWallLines(walls: WallSlice[]): BracedWallLine[] {
  type Entry = { wall: WallSlice; offset: number }
  const byAxis: Record<'x' | 'z', Entry[]> = { x: [], z: [] }
  for (const wall of walls) {
    if (!wall.exterior || wall.curved || wall.length <= EPS) continue
    const axis: 'x' | 'z' = Math.abs(wall.dir[0]) >= Math.abs(wall.dir[1]) ? 'x' : 'z'
    const mid: [number, number] = [
      (wall.start[0] + wall.end[0]) / 2,
      (wall.start[1] + wall.end[1]) / 2,
    ]
    byAxis[axis].push({ wall, offset: axis === 'x' ? mid[1] : mid[0] })
  }
  const lines: BracedWallLine[] = []
  for (const axis of ['x', 'z'] as const) {
    const entries = byAxis[axis].sort(
      (a, b) => a.offset - b.offset || (a.wall.id < b.wall.id ? -1 : 1),
    )
    let cluster: Entry[] = []
    const flush = () => {
      if (cluster.length === 0) return
      const line: BracedWallLine = {
        axis,
        offset: cluster.reduce((s, e) => s + e.offset, 0) / cluster.length,
        label: '', // assigned after sorting below
        wallIds: cluster.map((e) => e.wall.id),
        totalLength: cluster.reduce((s, e) => s + e.wall.length, 0),
      }
      lines.push(line)
      cluster = []
    }
    for (const entry of entries) {
      const first = cluster[0]
      if (first && entry.offset - first.offset > BRACED_LINE_OFFSET_TOL) flush()
      cluster.push(entry)
    }
    flush()
  }
  // Label per axis by ascending offset: X1, X2… / Z1, Z2…
  const counters: Record<'x' | 'z', number> = { x: 0, z: 0 }
  for (const line of lines) {
    counters[line.axis] += 1
    line.label = `${line.axis.toUpperCase()}${counters[line.axis]}`
  }
  return lines
}

/**
 * Per-braced-wall-line assumption warnings (v1): declare CS-WSP as the
 * method (the walls already sheath continuously — wall-layers), state that
 * the R602.10 panel length/spacing is NOT verified from geometry. LOD 200
 * frames generically — no code claims, no bracing flags.
 */
export function bracingWarnings(walls: WallSlice[], spec: FramingSpec): string[] {
  if (spec.detail === '200') return []
  return identifyBracedWallLines(walls).map(
    (line) =>
      `braced wall line ${line.label} (${line.wallIds.length} wall${
        line.wallIds.length > 1 ? 's' : ''
      }, ${line.totalLength.toFixed(1)}m): ${spec.wallBracingMethod} continuous sheathing assumed — R602.10 panel length/spacing not verified`,
  )
}

// ---------------------------------------------------------------------------
// Foundation hold-down ↔ wall-end post cross-reference (B9c)
// ---------------------------------------------------------------------------

/** Plan-distance tolerance tying a hold-down to the post it clamps: the HDU
 * body is 3" square and sits against the end stud — anything within ~6" in
 * plan is the same assembly; past that the tie is fiction. */
export const HOLD_DOWN_POST_TOL = 0.15

/** Wall verticals a hold-down can honestly claim to clamp. */
const POST_ROLES = new Set<Member['role']>(['stud', 'king-stud', 'trimmer', 'post'])

const composeFlag = (member: Member, flag: string): void => {
  member.flag = member.flag !== undefined ? `${flag} | ${member.flag}` : flag
}

/**
 * Tie the foundation's SDC-D hold-downs to the wall framing above them —
 * BOTH directions, flags on the offending members (they surface on the
 * takeoff's Flags rows and on paper via P4):
 *  - a hold-down with NO framed vertical within tolerance is anchoring
 *    nothing ('hold-down has no framed post above');
 *  - a CS-PF portal hold-down post with NO foundation hold-down below has
 *    unbuilt anchorage (R602.10.6.4 requires it) — the foundation only
 *    places HDUs at wall ENDS today, so the portal's opening-side post
 *    flags by design until the foundation models per-panel hold-downs.
 * Runs only when BOTH systems were computed on a ground level (compute.ts
 * call site) — a missing system is a toggle, not missing hardware.
 * Mutates the freshly-built members in place; returns the flagged count.
 */
export function crossReferenceHoldDowns(members: Member[]): number {
  const holdDowns = members.filter((m) => m.system === 'foundation' && m.role === 'hold-down')
  const verticals = members.filter(
    (m) => m.system === 'wall-framing' && POST_ROLES.has(m.role) && m.dims[1] > 1,
  )
  const near = (a: Member, b: Member): boolean =>
    Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) <=
    HOLD_DOWN_POST_TOL
  let flagged = 0
  for (const hd of holdDowns) {
    if (verticals.some((v) => near(hd, v))) continue
    composeFlag(
      hd,
      `wall ${hd.sourceId}: hold-down has no framed post above — verify braced-wall end post (R602.10)`,
    )
    flagged += 1
  }
  for (const post of members) {
    if (post.system !== 'wall-framing' || post.role !== 'post') continue
    if (!(post.label ?? '').includes('R602.10.6.4')) continue
    if (holdDowns.some((hd) => near(post, hd))) continue
    composeFlag(
      post,
      `wall ${post.sourceId}: portal post has no foundation hold-down below — CS-PF anchorage required (R602.10.6.4), verify`,
    )
    flagged += 1
  }
  return flagged
}
