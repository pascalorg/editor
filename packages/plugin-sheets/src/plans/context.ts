/**
 * What every plan-set module is handed when "Generate default set" plans the
 * sheets. The modules under `plans/` (structural, MEP, notes, energy) each
 * return the sheets they own as `Plan[]`; `generate.ts` merges them by sheet
 * NUMBER — a module's plan wins over the generic fallback with the same number.
 */
import type { AnyNodeLike, NodeMap } from '../model'
import type { ScalePreset } from '../scale'
import type { ViewportNode } from '../schema'

export type Plan = {
  number: string
  title: string
  viewports: (Omit<Partial<ViewportNode>, 'sheetId'> & { kind: ViewportNode['kind'] })[]
  /**
   * Merge these viewports INTO the plan with the same number instead of
   * replacing it — e.g. an attic-ventilation table added beside the roof plan
   * on A3.0. Ignored when no plan with that number exists (then it is simply
   * a new sheet).
   */
  extend?: boolean
}

export type PlanSetContext = {
  nodes: NodeMap
  /** The drawable field inside the border and clear of the title block, sheet inches. */
  frame: { x: number; y: number; w: number; h: number }
  /** Gutter between viewports, inches. */
  gap: number
  /** Scale chosen for the floor plans (world:paper, 48 = 1/4" = 1'-0"). */
  planScale: number
  /** Scale chosen for elevations and sections. */
  elevationScale: number
  /** Level nodes, lowest first. */
  levels: AnyNodeLike[]
  /** Whether any Bones kind is in the scene (X-ray node, devices, service). */
  hasBones: boolean
  archScales: readonly ScalePreset[]
  civilScales: readonly ScalePreset[]
}
