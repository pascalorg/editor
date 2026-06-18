import type { AnyNode, AnyNodeId } from '../schema'
import { buildPortComponents } from './system-graph'

/**
 * IPC validators for the DWV (drain-waste-vent) system — the "CodeRule"
 * primitive from the domain brief. The slope, minimum-size, and
 * trap-arm rules are all geometric and read straight off the node
 * fields, so they live here in core (pure logic) where the editor can
 * surface them and analyses can reuse them.
 *
 * Scope is residential IPC, simplified:
 *   - 704.1 drainage slope by pipe size.
 *   - 909 trap-arm maximum developed length by trap size.
 *
 * These are intentionally conservative approximations, not a certified
 * plan-check — enough to flag the mistakes a drawing tool invites.
 */

/** Drainage findings, worst-first per consumer's sort. */
export type DwvSeverity = 'error' | 'warning'

export type DwvFinding = {
  severity: DwvSeverity
  /** Stable rule id, e.g. 'slope-too-flat'. */
  code: string
  /** Human-readable, already-formatted message. */
  message: string
  /** Nodes the finding implicates (usually one). */
  nodeIds: AnyNodeId[]
}

/** IPC 704.1 minimum drainage slope (rise/run, dimensionless) by
 *  nominal pipe size: ¼"/ft (1:48) under 3", ⅛"/ft (1:96) for 3–6",
 *  1/16"/ft (1:192) at 8"+. */
function minSlopeFor(diameterIn: number): number {
  if (diameterIn < 3) return 1 / 48
  if (diameterIn < 8) return 1 / 96
  return 1 / 192
}

/** IPC Table 909.1 maximum trap-arm developed length (meters) by trap
 *  size: 30" @ 1¼", 42" @ 1½", 60" @ 2", 72" @ 3", 120" @ 4". */
const TRAP_ARM_MAX_M: ReadonlyArray<readonly [number, number]> = [
  [1.25, 30 * 0.0254],
  [1.5, 42 * 0.0254],
  [2, 60 * 0.0254],
  [3, 72 * 0.0254],
  [4, 120 * 0.0254],
]

function trapArmMaxFor(diameterIn: number): number {
  let max = Infinity
  for (const [size, lengthM] of TRAP_ARM_MAX_M) {
    if (diameterIn <= size) return lengthM
    max = lengthM
  }
  return max
}

/** Slopes shallower than this fraction of the minimum are flagged
 *  "too flat" — a small tolerance keeps round-off off the list. */
const SLOPE_TOLERANCE = 0.9
/** Horizontal legs shorter than this (meters) are treated as vertical
 *  stacks and skipped from the slope check. */
const VERTICAL_LEG_EPS_M = 0.02

type Vec3 = readonly [number, number, number]

function legSlope(a: Vec3, b: Vec3): { horizontalM: number; slope: number } {
  const horizontalM = Math.hypot(b[0] - a[0], b[2] - a[2])
  if (horizontalM < VERTICAL_LEG_EPS_M) return { horizontalM, slope: Infinity }
  return { horizontalM, slope: Math.abs(a[1] - b[1]) / horizontalM }
}

function inchLabel(value: number): string {
  return `${value}"`
}

/** Per-foot slope as a readable fraction, e.g. 0.0208 → '¼"/ft'. */
function slopePerFootLabel(slope: number): string {
  const inchesPerFoot = slope * 12
  return `${inchesPerFoot.toFixed(2)}"/ft`
}

/**
 * Run every DWV rule over the scene and return the findings. Empty
 * array = nothing to flag. Pure: no scene/store access, no rendering.
 */
export function validateDwv(nodes: Readonly<Record<AnyNodeId, AnyNode>>): DwvFinding[] {
  const findings: DwvFinding[] = []

  // ── Per-segment slope (waste only) ──────────────────────────────
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'pipe-segment' || node.system !== 'waste') continue
    const path = node.path as Vec3[]
    const minSlope = minSlopeFor(node.diameter)
    const maxSlope = node.diameter / 12 // 1 pipe-diameter per foot → siphoning
    let flaggedFlat = false
    let flaggedSteep = false
    for (let i = 0; i < path.length - 1; i++) {
      const { slope } = legSlope(path[i]!, path[i + 1]!)
      if (slope === Infinity) continue // vertical stack leg
      if (!flaggedFlat && slope < minSlope * SLOPE_TOLERANCE) {
        findings.push({
          severity: 'error',
          code: 'slope-too-flat',
          message: `${inchLabel(node.diameter)} drain slopes ${slopePerFootLabel(
            slope,
          )} — IPC 704.1 requires at least ${slopePerFootLabel(minSlope)}.`,
          nodeIds: [node.id],
        })
        flaggedFlat = true
      }
      if (!flaggedSteep && slope > maxSlope) {
        findings.push({
          severity: 'warning',
          code: 'slope-too-steep',
          message: `${inchLabel(node.diameter)} drain slopes ${slopePerFootLabel(
            slope,
          )} — over one pipe-diameter per foot risks siphoning the traps.`,
          nodeIds: [node.id],
        })
        flaggedSteep = true
      }
    }
  }

  // ── Component-scoped trap rules ──────────────────────────────────
  for (const component of buildPortComponents(nodes)) {
    const traps: AnyNode[] = []

    for (const id of component) {
      const node = nodes[id]
      if (!node) continue
      if (node.type === 'pipe-trap') {
        traps.push(node)
      }
    }

    // Trap-arm developed length: trap outlet → its vent, capped by size.
    // Independent of waste segments — a trap on its own can already be
    // over-armed.
    for (const trap of traps) {
      const t = trap as { id: AnyNodeId; diameter: number; armLengthM?: number }
      const armLengthM = t.armLengthM ?? 0
      const maxArm = trapArmMaxFor(t.diameter)
      if (armLengthM > maxArm + 1e-6) {
        findings.push({
          severity: 'error',
          code: 'trap-arm-too-long',
          message: `${inchLabel(t.diameter)} trap arm runs ${(armLengthM / 0.0254).toFixed(
            0,
          )}" to its vent — IPC 909.1 caps it at ${(maxArm / 0.0254).toFixed(0)}".`,
          nodeIds: [t.id],
        })
      }
    }
  }

  return findings
}
