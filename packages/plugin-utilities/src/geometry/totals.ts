import type { UtilityLineNode, UtilityRouting, UtilitySystem } from '../schema'
import type { LooseNodes } from '../site-frame'
import { resolvedLinePath } from '../utility-line/endpoints'
import { runLength, type Vec3 } from './catenary'

/**
 * The run to measure.
 *
 * Pass the scene's nodes and the ends linked through `fromRef` / `toRef` are
 * DERIVED from the pole and the meter, so a take-off follows them when they
 * move (`utility-line/endpoints.ts`). Omit them and the stored `path` is
 * measured as-is — correct for an unlinked run, and a stale-copy risk for a
 * linked one, which is why every caller inside this package passes the nodes.
 */
export function measuredPath(line: UtilityLineNode, nodes?: LooseNodes | null): readonly Vec3[] {
  return nodes ? resolvedLinePath(nodes, line) : line.path
}

/** Exact conversion: 1 international foot = 0.3048 m (NIST SP 811). */
export const METRES_PER_FOOT = 0.3048

export const metresToFeet = (metres: number): number => metres / METRES_PER_FOOT

export type SystemTotal = {
  system: UtilitySystem
  /** Sagged length for overhead runs, straight polyline length for buried. */
  metres: number
  feet: number
  overheadMetres: number
  undergroundMetres: number
  count: number
}

/**
 * Linear feet per system across a set of utility lines.
 *
 * Overhead runs are measured along the SAGGED cable, not the chord — a
 * take-off that measures the chord under-buys wire. Buried runs are
 * measured along the 3D polyline, so a vertical drop from grade to burial
 * depth is counted as pipe, which is what it is.
 *
 * Systems with no runs are omitted; the result is ordered by descending
 * length so the panel reads worst-first.
 */
export function totalsBySystem(
  lines: readonly UtilityLineNode[],
  nodes?: LooseNodes | null,
): SystemTotal[] {
  const bySystem = new Map<UtilitySystem, SystemTotal>()
  for (const line of lines) {
    const length = runLength(measuredPath(line, nodes), line.routing, line.sagRatio)
    if (!(length > 0)) continue
    const entry = bySystem.get(line.system) ?? {
      system: line.system,
      metres: 0,
      feet: 0,
      overheadMetres: 0,
      undergroundMetres: 0,
      count: 0,
    }
    entry.metres += length
    entry.count += 1
    if (line.routing === 'overhead') entry.overheadMetres += length
    else entry.undergroundMetres += length
    bySystem.set(line.system, entry)
  }
  const out = [...bySystem.values()]
  for (const entry of out) entry.feet = metresToFeet(entry.metres)
  out.sort((a, b) => b.metres - a.metres)
  return out
}

/** Length of a single run in the routing-appropriate measure, metres. */
export function lineLength(line: UtilityLineNode, nodes?: LooseNodes | null): number {
  return runLength(measuredPath(line, nodes), line.routing, line.sagRatio)
}

/** Grand total across every system, metres. */
export function totalMetres(lines: readonly UtilityLineNode[], nodes?: LooseNodes | null): number {
  return totalsBySystem(lines, nodes).reduce((sum, entry) => sum + entry.metres, 0)
}

/** Linear feet, rounded to the nearest foot — the take-off number. */
export function linearFeet(
  lines: readonly UtilityLineNode[],
  routing?: UtilityRouting,
  nodes?: LooseNodes | null,
): number {
  let metres = 0
  for (const line of lines) {
    if (routing && line.routing !== routing) continue
    metres += lineLength(line, nodes)
  }
  return Math.round(metresToFeet(metres))
}
