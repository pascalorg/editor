import type { Polygon, Ring } from '../../lib/polygon-boolean'

export type { Polygon, Ring }

/**
 * What an obstacle is, for naming it in a finding and for the checks that look at one kind (a wall
 * object's depth from its wall, a stair rail closing an arrival).
 */
export type PrismKind =
  | 'wall'
  | 'wall-trim'
  | 'jamb'
  | 'door-head'
  | 'threshold'
  | 'window-frame'
  | 'sill'
  | 'treatment'
  | 'stair'
  | 'stair-rail'
  | 'guard'
  | 'cabinet'
  | 'item'
  | 'column'
  | 'shelf'
  | 'void'
  | 'other'

/**
 * A plan polygon between two heights, in the building's plan frame (x, z) and absolute building
 * metres (y), so a stair that crosses a storey and the wall beside it are in one frame. Every
 * obstacle the usage checks see is a union of these. `exact` means the
 * outline and heights come from the node's own fields and the pure helper its renderer calls, pinned
 * to the built mesh by a parity test; `approx` is a fallback (a bounds box, a head left out) and a
 * finding that rests on it is informational.
 */
export type Prism = {
  /** Stable within one scene: `<nodeId>#<part>`. */
  id: string
  nodeId: string
  kind: PrismKind
  z0: number
  z1: number
  outer: Ring
  holes: Ring[]
  shape: 'exact' | 'approx'
  /** What made it approximate, for the finding's wording. */
  why?: string
  /** Set for what is mounted on a wall: the clash and opening-blocked checks leave it out against its own host. */
  host?: { wallId: string; face: 'a' | 'b' }
}

/** A stretch of floor a person stands on, with its finished height in absolute building metres. */
export type FloorRegion = {
  id: string
  nodeId: string
  outer: Ring
  holes: Ring[]
  y: number
  /** Outside the enclosed footprint: a terrace, a porch deck. */
  outdoor: boolean
  shape: 'exact' | 'approx'
  why?: string
}

export type LevelShapes = {
  levelId: string
  prisms: Prism[]
  floors: FloorRegion[]
}

/** A node whose shape could not be read, with why; one such node never stops the others. */
export type Skipped = { nodeId: string; why: string }

export type UsageShapes = {
  /** Prisms are filed under the level that owns the node: a stair under the level it starts from. */
  levels: LevelShapes[]
  /** Node ids whose shape is approximate. */
  approximate: string[]
  /** Kinds met on the way that contribute no shape, with how many nodes of each. */
  unshaped: Record<string, number>
  skipped: Skipped[]
}
