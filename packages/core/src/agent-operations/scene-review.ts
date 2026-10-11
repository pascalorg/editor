import { refuse } from '../agent-tools/refusal'
import { checkCoherence, coherenceItems } from '../coherence'
import { activeIssues } from '../coherence/disputes'
import type { CoherenceItem } from '../coherence/types'
import { getLevelDisplayName } from '../lib/level-name'
import type { AnyNode } from '../schema'
import { hashNode as hashOf, type SessionRecord } from './scene-checkpoint'
import { changesSince, type LostSinceCheckpointIssue, type MeasureChange } from './scene-measure'
import { levelIdOf, levelsOf } from './scene-queries'
import type { SceneNodes } from './types'

/** A node of these kinds can be the target of a view_scene; the others are seen through their level. */
const VIEWABLE = new Set(['wall', 'zone', 'door', 'window', 'item'])
/** A group lists this many ids of each kind; the counts are exact. */
const IDS_PER_KIND = 12

export type ReviewGroup = {
  levelId: string | null
  level: string
  kind: string
  created: number
  changed: number
  deleted: number
  ids: { created: string[]; changed: string[]; deleted: string[] }
  /** A ready view_scene call that shows the group. */
  view?: { target: string; from: 'south-west'; elevation: 35 }
}

export type LostElement = {
  id: string
  kind: string
  level: string
  name?: string
  when: 'there at the checkpoint' | 'made since the checkpoint'
}

export type SinceReview = {
  checkpoint: string
  totals: { created: number; changed: number; deleted: number }
  groups: ReviewGroup[]
  /** What the agent made and is gone now, since the checkpoint. */
  lost: LostElement[]
  coherence: { introduced: CoherenceItem[]; resolved: { id: string }[] }
  /** The registered families, by place: windows, lit rooms… that are gone or new. */
  places?: { changes: MeasureChange[]; issues: LostSinceCheckpointIssue[] }
}

type Bucket = {
  levelId: string | null
  kind: string
  created: string[]
  changed: string[]
  deleted: string[]
}

/**
 * The scene now against a checkpoint the session named: what was created, changed and deleted,
 * grouped by level and kind with a view each, the coherence items introduced and resolved since, and
 * what the agent made that is gone. Pure: the session record comes from the host.
 */
export function reviewSince(session: SessionRecord, name: string, nodes: SceneNodes): SinceReview {
  const checkpoint = session.checkpoints[name]
  if (!checkpoint) {
    const names = Object.keys(session.checkpoints)
    refuse(
      'checkpoint_not_found',
      names.length
        ? `There is no checkpoint "${name}". The session has: ${names.join(', ')}.`
        : `There is no checkpoint "${name}", and the session has none: name this moment with set_checkpoint.`,
      { checkpoints: names },
    )
  }

  const buckets = new Map<string, Bucket>()
  const bucket = (levelId: string | null, kind: string) => {
    const key = `${levelId ?? ''}|${kind}`
    let found = buckets.get(key)
    if (!found) {
      found = { levelId, kind, created: [], changed: [], deleted: [] }
      buckets.set(key, found)
    }
    return found
  }
  const levelName = (levelId: string | null) => {
    if (!levelId) return 'The building'
    const level = nodes[levelId]
    if (level?.type === 'level') return getLevelDisplayName(level)
    return checkpoint.nodes[levelId]?.name ?? levelId
  }

  for (const node of Object.values(nodes)) {
    const was = checkpoint.nodes[node.id]
    const levelId = levelIdOf(nodes, node.id)
    if (!was) bucket(levelId, node.type).created.push(node.id)
    else if (was.hash !== hashOf(node)) bucket(levelId, node.type).changed.push(node.id)
  }
  for (const [id, was] of Object.entries(checkpoint.nodes))
    if (!nodes[id]) bucket(was.levelId, was.type).deleted.push(id)

  const order = new Map<string, number>(levelsOf(nodes).map((level, index) => [level.id, index]))
  const groups: ReviewGroup[] = [...buckets.values()]
    .sort(
      (a, b) =>
        (order.get(a.levelId ?? '') ?? 1e6) - (order.get(b.levelId ?? '') ?? 1e6) ||
        a.kind.localeCompare(b.kind),
    )
    .map((entry) => {
      const touched = [...entry.created, ...entry.changed]
      const only = touched.length === 1 && entry.deleted.length === 0 ? touched[0] : undefined
      const target =
        only && VIEWABLE.has(entry.kind) ? only : (entry.levelId ?? firstBuilding(nodes))
      const cap = (ids: string[]) => ids.slice().sort().slice(0, IDS_PER_KIND)
      return {
        levelId: entry.levelId,
        level: levelName(entry.levelId),
        kind: entry.kind,
        created: entry.created.length,
        changed: entry.changed.length,
        deleted: entry.deleted.length,
        ids: {
          created: cap(entry.created),
          changed: cap(entry.changed),
          deleted: cap(entry.deleted),
        },
        ...(target
          ? { view: { target, from: 'south-west' as const, elevation: 35 as const } }
          : {}),
      }
    })

  const lost: LostElement[] = []
  session.made.forEach((entry, index) => {
    if (nodes[entry.id]) return
    const there = entry.id in checkpoint.nodes
    if (!there && index < checkpoint.madeAt) return
    lost.push({
      id: entry.id,
      kind: entry.type,
      level: levelName(entry.levelId),
      ...(entry.name ? { name: entry.name } : {}),
      when: there ? 'there at the checkpoint' : 'made since the checkpoint',
    })
  })

  const open = activeIssues(checkCoherence(nodes), nodes)
  const stillOpen = new Set(open.map((issue) => issue.id))
  const before = new Set(checkpoint.issues)
  const places = changesSince({ name: checkpoint.name, measure: checkpoint.measure }, nodes)

  return {
    checkpoint: name,
    totals: {
      created: groups.reduce((sum, group) => sum + group.created, 0),
      changed: groups.reduce((sum, group) => sum + group.changed, 0),
      deleted: groups.reduce((sum, group) => sum + group.deleted, 0),
    },
    groups,
    lost,
    coherence: {
      introduced: coherenceItems(
        open.filter((issue) => !before.has(issue.id)),
        nodes,
      ),
      resolved: checkpoint.issues.filter((id) => !stillOpen.has(id)).map((id) => ({ id })),
    },
    ...(places.changes.length ? { places } : {}),
  }
}

const firstBuilding = (nodes: SceneNodes): string | undefined =>
  Object.values(nodes).find((node: AnyNode) => node.type === 'building')?.id
