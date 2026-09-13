/**
 * Attic runs stay UNDER the roof. The MEP engines lay their attic planes
 * over the tallest plate (ducts at plate + 0.3, pipes + 0.15, wires + 0.05)
 * and run them level; a low-pitch hip or gable has no such height near
 * the eaves — a 4:12 roof is only 0.13 m above the plate at the wall line
 * — so the trunks, the PEX home runs and the NM cable stood in the open
 * air over the eaves (Steve, 2026-09-08: "why does the MEP pop through the
 * roof, all the cold and hot water lines and stuff"). This pass lowers
 * each level attic run to the rafters' underside where the roof dips
 * beneath it — the run slopes down toward the eave the way a real flex
 * duct or home run lies on the ceiling joists — and shortens a riser that
 * would poke through. It never lifts anything, never touches a member
 * that legitimately passes the roof (the DWV stack, a flue, the service
 * mast and drop, a wall/roof termination), and floors every run above the
 * plates: a run that cannot fit even there (a 14×8 trunk at the eave)
 * keeps its height and carries a flag.
 */
import type { Member } from '../core/types'
import { roofUndersideAt } from './attic-walls'
import { memberAxis, type RoofSegmentSlice } from './roof-framing'

/** Sample spacing along a run. */
const STEP = 0.2
/** Clear gap kept under the rafters' underside. */
const GAP = 0.02
/** A run within this of its limit is left alone (the plane's own tolerance at the plate line). */
const SLACK = 0.03
/** Below this excess above the floor, a floored run is silent (the wall-line plane rounding). */
const FLAG_EXCESS = 0.05
/** Members that pass THROUGH the roof or stand outside it by design. */
const PASSES_ROOF =
  /through roof|through the roof|above the roof|flue|B-vent|weatherhead|service drop|service mast|triplex|pole|transformer|lateral|termination|condenser|meter|well head|septic|drainfield|line set/i

export const UNDER_ROOF_FLAG =
  'ROOF: no attic height here — the run stands into the rafters at the eave; re-route inboard or drop into a soffit — verify'

export interface UnderRoofResult {
  members: Member[]
  /** Runs (or pieces of runs) lowered under the rafters. */
  lowered: number
  /** Runs that could not fit above the plates — flagged. */
  clashing: number
  warnings: string[]
}

/**
 * Lower the attic MEP runs in `members` under `roofs`. `plateTopY` is the
 * highest wall top on the level (the runs never go below it).
 */
export function clampUnderRoof(
  members: readonly Member[],
  roofs: readonly RoofSegmentSlice[],
  plateTopY: number,
): UnderRoofResult {
  const out: Member[] = []
  let lowered = 0
  let clashing = 0
  if (roofs.length === 0) return { members: [...members], lowered, clashing, warnings: [] }
  const limitAt = (x: number, z: number): number | null => {
    const y = roofUndersideAt(roofs, x, z)
    return y === null ? null : y - GAP
  }

  for (const m of members) {
    if (m.system !== 'plumbing' && m.system !== 'hvac' && m.system !== 'electrical') {
      out.push(m)
      continue
    }
    if (m.levelId !== undefined || PASSES_ROOF.test(m.label ?? '')) {
      out.push(m)
      continue
    }
    // ---- vertical: a riser (rotation zero, its length in dims[1]) that would stand out of the roof is cut at the underside
    const unrotated = m.rotation[0] === 0 && m.rotation[1] === 0 && m.rotation[2] === 0
    if (unrotated && Math.abs(m.dims[1] - m.length) < 1e-6 && m.dims[1] > m.dims[0]) {
      const limit = limitAt(m.position[0], m.position[2])
      const bottom = m.position[1] - m.length / 2
      const top = m.position[1] + m.length / 2
      if (limit === null || top <= limit + SLACK) {
        out.push(m)
        continue
      }
      if (limit - bottom < 0.05) {
        // the whole riser is over the roof — nothing sane to cut to
        out.push({ ...m, flag: m.flag ?? UNDER_ROOF_FLAG })
        clashing++
        continue
      }
      const length = limit - bottom
      out.push({
        ...m,
        dims: [m.dims[0], length, m.dims[2]],
        length,
        position: [m.position[0], (bottom + limit) / 2, m.position[2]],
      })
      lowered++
      continue
    }

    // ---- level runs only (sloped pieces are our own output; leave odd boxes alone)
    const axis = memberAxis(m)
    if (Math.abs(axis[1]) > 0.01 || m.rotation[0] !== 0 || m.rotation[2] !== 0) {
      out.push(m)
      continue
    }
    const halfH = m.dims[1] / 2
    const half = m.length / 2
    const floor = plateTopY + halfH + 0.005
    const n = Math.max(1, Math.ceil(m.length / STEP))
    const ts: number[] = []
    for (let i = 0; i <= n; i++) ts.push(-half + (m.length * i) / n)
    const ys: number[] = []
    let changed = false
    let floored = false
    for (const t of ts) {
      const x = m.position[0] + axis[0] * t
      const z = m.position[2] + axis[2] * t
      const limit = limitAt(x, z)
      let y = m.position[1]
      if (limit !== null && y + halfH > limit + SLACK) {
        y = limit - halfH
        if (y < floor) {
          if (floor - y > FLAG_EXCESS) floored = true
          y = Math.min(m.position[1], floor)
        }
        if (y < m.position[1] - 1e-6) changed = true
      }
      ys.push(y)
    }
    if (floored) {
      out.push({ ...m, flag: m.flag ?? UNDER_ROOF_FLAG })
      clashing++
      continue
    }
    if (!changed) {
      out.push(m)
      continue
    }

    // ---- re-emit as a polyline of sloped pieces: break where the slope changes
    const breaks = [0]
    for (let i = 1; i < ts.length - 1; i++) {
      const s0 =
        ((ys[i] as number) - (ys[i - 1] as number)) / ((ts[i] as number) - (ts[i - 1] as number))
      const s1 =
        ((ys[i + 1] as number) - (ys[i] as number)) / ((ts[i + 1] as number) - (ts[i] as number))
      if (Math.abs(s1 - s0) > 1e-3) breaks.push(i)
    }
    breaks.push(ts.length - 1)
    const yaw = Math.atan2(-axis[2], axis[0])
    for (let b = 0; b < breaks.length - 1; b++) {
      const i0 = breaks[b] as number
      const i1 = breaks[b + 1] as number
      const t0 = ts[i0] as number
      const t1 = ts[i1] as number
      const y0 = ys[i0] as number
      const y1 = ys[i1] as number
      const plan = t1 - t0
      const dy = y1 - y0
      const length = Math.hypot(plan, dy)
      if (length < 0.01) continue
      const tm = (t0 + t1) / 2
      out.push({
        ...m,
        dims: [length, m.dims[1], m.dims[2]],
        length,
        position: [m.position[0] + axis[0] * tm, (y0 + y1) / 2, m.position[2] + axis[2] * tm],
        rotation: [0, yaw, Math.atan2(dy, plan)],
      })
    }
    lowered++
  }

  const warnings: string[] = []
  if (lowered > 0)
    warnings.push(
      `${lowered} attic MEP runs lowered under the rafters toward the eaves (no attic height there)`,
    )
  if (clashing > 0)
    warnings.push(
      `${clashing} attic MEP runs cannot fit under the rafters at the eave — flagged; re-route inboard or drop into a soffit — verify`,
    )
  return { members: out, lowered, clashing, warnings }
}
