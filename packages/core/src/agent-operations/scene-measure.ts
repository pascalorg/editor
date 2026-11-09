import type { AnyNode } from '../schema'
import type { SceneNodes } from './types'

type Spot = { x: number; z: number }
/** Where one of a family stands: rooms by their centre and name. */
export type MeasurePlace = Spot & { name?: string }

/**
 * A family the measure counts on each floor, by place: windows, lit rooms, decks with a door.
 * The module that knows a family registers it (the facade checks register theirs), so the measure
 * imports none of them.
 */
export type MeasureFamily = {
  family: string
  /** One of them, in a message: "window", "room". */
  noun: string
  /** What losing one means: "gone from their places", "no longer lit". */
  lost: string
  /** Two places this close are the same. */
  tolerance: number
  /** Where the family runs before or after others, in the result. */
  order: number
  places: (nodes: Readonly<Record<string, AnyNode>>) => { levelId: string; place: MeasurePlace }[]
}

const families: MeasureFamily[] = []

/** Counts a family in every measure from now on; registering a family again replaces it. */
export function registerMeasureFamily(family: MeasureFamily) {
  const at = families.findIndex((known) => known.family === family.family)
  if (at >= 0) families[at] = family
  else families.push(family)
  families.sort((a, b) => a.order - b.order)
}

/** What a scene holds of the registered families, by floor and place; small, and plain JSON. */
export type SceneMeasure = {
  levels: Record<string, { name: string; families: Record<string, MeasurePlace[]> }>
}

/** A measure kept under a name, before an edit, to compare the scene with after it. */
export type SceneCheckpoint = { name: string; measure: SceneMeasure }

export type MeasureChange = {
  levelId: string
  level: string
  family: string
  before: number
  after: number
  /** What the checkpoint had that is not there now, by place (rooms by name). */
  gone: string[]
  /** How many stand where the checkpoint had none. */
  added: number
}

export type LostSinceCheckpointIssue = { type: 'lost_since_checkpoint'; message: string }

const round = (value: number) => Math.round(value * 100) / 100

export function measureScene(nodes: SceneNodes): SceneMeasure {
  const all = nodes as Readonly<Record<string, AnyNode>>
  const levels: SceneMeasure['levels'] = {}
  for (const node of Object.values(all))
    if (node.type === 'level')
      levels[node.id] = { name: node.name ?? `level ${node.level}`, families: {} }
  for (const { family, places } of families)
    for (const { levelId, place } of places(all)) {
      const level = levels[levelId]
      if (!level) continue
      level.families[family] ??= []
      level.families[family].push({ ...place, x: round(place.x), z: round(place.z) })
    }
  return { levels }
}

/** The places of `from` with none of `to` within `tolerance`. */
const missing = <T extends Spot>(from: readonly T[], to: readonly Spot[], tolerance: number) =>
  from.filter((a) => !to.some((b) => Math.hypot(a.x - b.x, a.z - b.z) < tolerance))

/**
 * The scene now against a checkpoint: per floor and family, the count then and now, what is gone
 * from its place and what is new. A family that lost more than it gained is an issue naming what is
 * gone. On the Victor grid v1 cost 8 windows a floor and room mode 10–12, seen only by the MCP
 * agent counting before and after (2026-10-03); a weaker model's edits lowered its own score 29.6%
 * of the time (LEGO-Anything, 2026-09).
 */
export function changesSince(
  checkpoint: SceneCheckpoint,
  nodes: SceneNodes,
): { changes: MeasureChange[]; issues: LostSinceCheckpointIssue[] } {
  const now = measureScene(nodes).levels
  const then = checkpoint.measure.levels
  const changes: MeasureChange[] = []
  const issues: LostSinceCheckpointIssue[] = []
  for (const levelId of new Set([...Object.keys(then), ...Object.keys(now)])) {
    const before = then[levelId]
    const after = now[levelId]
    const level = after?.name ?? before?.name ?? levelId
    for (const { family, tolerance, noun, lost } of families) {
      const was = before?.families[family] ?? []
      const is = after?.families[family] ?? []
      const gone = missing(was, is, tolerance)
      const added = missing(is, was, tolerance).length
      if (!gone.length && !added) continue
      const named = gone.map((s) =>
        typeof s.name === 'string' ? s.name : `${noun} at (${s.x}, ${s.z})`,
      )
      changes.push({
        levelId,
        level,
        family,
        before: was.length,
        after: is.length,
        gone: named,
        added,
      })
      if (is.length >= was.length) continue
      const list =
        named.slice(0, 8).join('; ') + (named.length > 8 ? `; and ${named.length - 8} more` : '')
      issues.push({
        type: 'lost_since_checkpoint',
        message: `${level} has ${is.length} ${family}, ${was.length} at checkpoint "${checkpoint.name}": ${lost}, ${list}${added ? `; ${added} stand in new places` : ''}. If the edit was not meant to lose them, restore the checkpoint or put them back.`,
      })
    }
  }
  return { changes, issues }
}
