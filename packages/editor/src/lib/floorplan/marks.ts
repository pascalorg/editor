import type { AnyNode, AnyNodeId, DoorNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core'

/**
 * Deterministic door / window marks per level — WS3.
 *
 * `packages/core/src/schema/nodes/door.ts:75-79` promises "the deterministic
 * level fallback (101, 102, ...)"; this is the implementation.
 *
 * Numbering
 * ---------
 *   base   = (level.level + 1) * 100          — level 0 → 100, level 1 → 200
 *   doors  = `D${base + n}`   → D101, D102 …
 *   windows= `W${base + n}`   → W101, W102 …
 *
 * Order
 * -----
 * Openings are visited **clockwise** around the level, starting from the
 * north-west-most exterior wall, exterior walls first and interior walls
 * after. Clockwise is the ascending-angle sweep of the wall midpoint about
 * the level centroid, anchored on the north-west diagonal (plan axes are
 * x east, z south — z grows down the screen — so a screen-clockwise sweep
 * is increasing atan2(z, x)). Openings on the same wall are ordered along
 * the wall direction.
 *
 * Stability
 * ---------
 * An explicit `mark` on the node always wins and is never reassigned.
 * `resolveMarks` also reports, in `assignments`, the marks it invented for
 * nodes that had none — the caller is expected to PERSIST those back onto
 * `node.mark` the first time they are resolved in an edit session
 * (`persistResolvedMarks`). That is what makes numbering stable under
 * insertion: once written, an existing opening keeps its number forever and
 * a newly inserted opening only ever takes the next free number. Without
 * the write-back, inserting a door in the middle of a wall would silently
 * renumber every door after it.
 */

export type OpeningMarkKind = 'door' | 'window'

export type MarkResolution = {
  /** Every door and window on the level → its mark. */
  marks: ReadonlyMap<string, string>
  /** Only the marks that were invented (node.mark was empty). */
  assignments: ReadonlyMap<string, string>
  /** Duplicate explicit marks and other reportable defects. */
  issues: readonly string[]
}

export type MarkSceneInput = {
  nodes: Readonly<Record<string, AnyNode>>
}

/**
 * Resolve marks for every door and window under `levelId`.
 *
 * `scene` may be a `{ nodes }` snapshot or the raw node map.
 */
export function resolveMarks(
  scene: MarkSceneInput | Readonly<Record<string, AnyNode>>,
  levelId: AnyNodeId,
): Map<string, string> {
  return new Map(resolveMarkDetail(scene, levelId).marks)
}

export function resolveMarkDetail(
  scene: MarkSceneInput | Readonly<Record<string, AnyNode>>,
  levelId: AnyNodeId,
): MarkResolution {
  const nodes = normalizeNodes(scene)
  const level = nodes[levelId]
  const ordinal = level && level.type === 'level' ? ((level as LevelNode).level ?? 0) : 0
  const base = (Math.max(0, ordinal) + 1) * 100

  const openings = orderedOpenings(nodes, levelId)
  const marks = new Map<string, string>()
  const assignments = new Map<string, string>()
  const issues: string[] = []

  for (const kind of ['door', 'window'] as const) {
    const prefix = kind === 'door' ? 'D' : 'W'
    const list = openings.filter((opening) => opening.type === kind)
    const used = new Set<string>()
    const explicitOwners = new Map<string, string[]>()

    for (const opening of list) {
      const explicit = opening.mark?.trim()
      if (!explicit) continue
      marks.set(opening.id, explicit)
      const normalized = explicit.toLocaleUpperCase()
      used.add(normalized)
      const owners = explicitOwners.get(normalized)
      if (owners) owners.push(opening.id)
      else explicitOwners.set(normalized, [opening.id])
    }

    let sequence = 1
    for (const opening of list) {
      if (marks.has(opening.id)) continue
      let candidate = `${prefix}${base + sequence}`
      while (used.has(candidate.toLocaleUpperCase())) {
        sequence++
        candidate = `${prefix}${base + sequence}`
      }
      marks.set(opening.id, candidate)
      assignments.set(opening.id, candidate)
      used.add(candidate.toLocaleUpperCase())
      sequence++
    }

    for (const [mark, owners] of explicitOwners) {
      if (owners.length > 1) {
        issues.push(`Duplicate ${kind} mark ${mark} (${owners.length} instances)`)
      }
    }
  }

  return { marks, assignments, issues }
}

/**
 * Write invented marks back onto the nodes so numbering never drifts.
 *
 * Call once per level per edit session (the caller decides when — this
 * module stays pure). `update` is typically `sceneApi.update`.
 */
export function persistResolvedMarks(
  resolution: MarkResolution,
  update: (id: AnyNodeId, data: Record<string, unknown>) => void,
): number {
  let written = 0
  for (const [id, mark] of resolution.assignments) {
    update(id as AnyNodeId, { mark })
    written++
  }
  return written
}

// ── Ordering ─────────────────────────────────────────────────────────

type Opening = (DoorNode | WindowNode) & { type: 'door' | 'window' }

/**
 * Every door and window under the level, clockwise from the NW-most
 * exterior wall, exterior walls first.
 */
export function orderedOpenings(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: AnyNodeId,
): Opening[] {
  const walls: WallNode[] = []
  const orphanOpenings: Opening[] = []

  const visit = (id: string) => {
    const node = nodes[id]
    if (!node) return
    if (node.visible === false) return
    if (node.type === 'wall') walls.push(node as WallNode)
    else if (node.type === 'door' || node.type === 'window') {
      const opening = node as Opening
      if (!opening.wallId || !nodes[opening.wallId]) orphanOpenings.push(opening)
    }
    for (const childId of (node as { children?: string[] }).children ?? []) visit(childId)
  }
  visit(levelId)

  const centroid = wallCentroid(walls)
  const ordered = [...walls].sort((left, right) => {
    const leftExterior = isExteriorWall(left) ? 0 : 1
    const rightExterior = isExteriorWall(right) ? 0 : 1
    if (leftExterior !== rightExterior) return leftExterior - rightExterior
    return clockwiseKey(left, centroid) - clockwiseKey(right, centroid)
  })

  const result: Opening[] = []
  for (const wall of ordered) {
    const wallOpenings: Opening[] = []
    for (const childId of wall.children ?? []) {
      const child = nodes[childId]
      if (child && child.visible !== false && (child.type === 'door' || child.type === 'window')) {
        wallOpenings.push(child as Opening)
      }
    }
    wallOpenings.sort((left, right) => left.position[0] - right.position[0])
    result.push(...wallOpenings)
  }
  result.push(...orphanOpenings)
  return result
}

function wallCentroid(walls: readonly WallNode[]): [number, number] {
  if (walls.length === 0) return [0, 0]
  let x = 0
  let z = 0
  for (const wall of walls) {
    x += (wall.start[0] + wall.end[0]) / 2
    z += (wall.start[1] + wall.end[1]) / 2
  }
  return [x / walls.length, z / walls.length]
}

/**
 * Sweep key: 0 at the north-west direction, increasing clockwise on screen.
 *
 * Plan axes are x east, z south — z grows DOWN the screen — so a clockwise
 * screen sweep (up → right → down → left) is the INCREASING atan2(z, x)
 * direction. The north-west diagonal sits at atan2(-1, -1) = -3π/4, so
 * anchoring there and wrapping into [0, 2π) yields north, east, south, west.
 */
const NORTH_WEST_ANGLE = (-3 * Math.PI) / 4

function clockwiseKey(wall: WallNode, centroid: readonly [number, number]): number {
  const midX = (wall.start[0] + wall.end[0]) / 2 - centroid[0]
  const midZ = (wall.start[1] + wall.end[1]) / 2 - centroid[1]
  let sweep = Math.atan2(midZ, midX) - NORTH_WEST_ANGLE
  while (sweep < 0) sweep += Math.PI * 2
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2
  return sweep
}

function isExteriorWall(wall: WallNode): boolean {
  return wall.frontSide === 'exterior' || wall.backSide === 'exterior'
}

function normalizeNodes(
  scene: MarkSceneInput | Readonly<Record<string, AnyNode>>,
): Readonly<Record<string, AnyNode>> {
  const candidate = scene as MarkSceneInput
  return candidate && typeof candidate === 'object' && 'nodes' in candidate
    ? candidate.nodes
    : (scene as Readonly<Record<string, AnyNode>>)
}
