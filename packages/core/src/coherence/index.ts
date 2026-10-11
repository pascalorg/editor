import { levelIdOf } from '../agent-operations/scene-queries'
import type { SceneChanges } from '../agent-operations/types'
import type { AnyNode, AnyNodeId } from '../schema'
import { getLevelElevations } from '../services/storey'
import { activeIssues } from './disputes'
import { enclosureIssues, measureEnclosure } from './enclosure'
import { hostingIssues, measureHosting } from './hosting'
import { coherenceItems } from './items'
import { measureSupport, supportIssues } from './support'
import { COHERENCE_LEVEL_NEIGHBOURS } from './tolerances'
import type { CoherenceDelta, CoherenceIssue, CoherenceItem } from './types'

export { ENCLOSURE_KINDS } from './enclosure'
export { HOSTING_KINDS } from './hosting'
export { coherenceItems } from './items'
export { SUPPORT_KINDS } from './support'
export { COHERENCE_TOLERANCES } from './tolerances'
export type * from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * Every place two parts of the building meet badly, measured: the issues, sorted by id. With
 * `levelIds`, only the contacts on or over those levels. A pure function of the nodes: the same
 * answer from the MCP, the chat and the editor.
 */
export function checkCoherence(
  nodes: SceneNodes,
  options: { levelIds?: readonly string[] } = {},
): CoherenceIssue[] {
  const levelIds = options.levelIds ? new Set(options.levelIds) : undefined
  const contacts = measureEnclosure(nodes, { levelIds })
  return [
    ...enclosureIssues(contacts),
    ...supportIssues(measureSupport(nodes, { levelIds, contacts })),
    ...hostingIssues(measureHosting(nodes, { levelIds })),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** What a change introduced and resolved, by issue id; `open` is what remains after it. */
export function diffCoherence(before: readonly CoherenceIssue[], after: readonly CoherenceIssue[]) {
  const was = new Set(before.map((issue) => issue.id))
  const is = new Set(after.map((issue) => issue.id))
  return {
    introduced: after.filter((issue) => !was.has(issue.id)),
    resolved: before.filter((issue) => !is.has(issue.id)),
    open: [...after],
  }
}

/**
 * The checklist of a whole scene, as verify_scene returns it: every item, with how many issues
 * are open and how many are under a dispute that still holds.
 */
export function coherenceChecklist(nodes: SceneNodes): {
  open: number
  disputed: number
  checklist: CoherenceItem[]
} {
  const checklist = coherenceItems(checkCoherence(nodes), nodes)
  const count = (status: CoherenceItem['status']) =>
    checklist.reduce((sum, item) => sum + (item.status === status ? item.count : 0), 0)
  return { open: count('open'), disputed: count('disputed'), checklist }
}

/**
 * The levels a change reaches: those it touched and the ones directly above and below, since a
 * roof lives on the level over the walls it meets. A change to a level or a building can move every
 * level above it, so it reaches them all. Null when the change is on no level.
 */
export function affectedLevelIds(
  before: SceneNodes,
  after: SceneNodes,
  changes: readonly SceneChanges[],
): string[] | null {
  const touched = new Set<string>()
  let everything = false
  const note = (nodes: SceneNodes, id: string | undefined, parentId?: string) => {
    const known = id ? nodes[id] : undefined
    if (known?.type === 'level' || known?.type === 'building') everything = true
    const levelId = levelIdOf(nodes, id ?? '') ?? (parentId ? levelIdOf(nodes, parentId) : null)
    if (levelId) touched.add(levelId)
  }
  for (const set of changes) {
    for (const { node, parentId } of set.create ?? []) note(after, node.id, parentId)
    for (const { id } of set.update ?? []) {
      note(after, id)
      note(before, id)
    }
    for (const id of set.delete ?? []) note(before, id)
  }
  if (everything)
    return Object.values(after)
      .filter((node) => node.type === 'level')
      .map((node) => node.id)
  if (!touched.size) return null

  const elevations = getLevelElevations(after as Record<AnyNodeId, AnyNode>)
  const ordered = [...elevations].sort((a, b) => a[1].ordinal - b[1].ordinal).map(([id]) => id)
  const reached = new Set<string>()
  for (const id of touched) {
    const at = ordered.indexOf(id)
    if (at < 0) {
      reached.add(id)
      continue
    }
    for (
      let index = Math.max(0, at - COHERENCE_LEVEL_NEIGHBOURS);
      index <= Math.min(ordered.length - 1, at + COHERENCE_LEVEL_NEIGHBOURS);
      index++
    )
      reached.add(ordered[index]!)
  }
  return [...reached]
}

/**
 * What a write did to the checklist: the contacts it introduced, with the moves that settle them,
 * and the ones it resolved. Only the levels the write reached are measured again; what was open
 * before and still is stays out of the answer and counts in `open`. Null when the write is on no
 * level.
 */
export function coherenceOfChange(
  before: SceneNodes,
  after: SceneNodes,
  changes: readonly SceneChanges[],
): CoherenceDelta | null {
  const levelIds = affectedLevelIds(before, after, changes)
  if (!levelIds) return null
  const was = checkCoherence(before, { levelIds })
  const is = checkCoherence(after, { levelIds })
  const openWas = activeIssues(was, before)
  const openIs = activeIssues(is, after)
  // Introduced is what became open, a dispute that stopped holding included; resolved is what
  // the measurement no longer finds, disputed or not. A dispute alone moves neither.
  const introduced = diffCoherence(openWas, openIs).introduced
  const disputed = is.length - openIs.length
  return {
    introduced: coherenceItems(introduced, after),
    resolved: diffCoherence(was, is).resolved.map(({ id, family, code, nodeIds }) => ({
      id,
      family,
      code,
      nodeIds,
    })),
    open: openIs.length,
    ...(disputed ? { disputed } : {}),
  }
}

/**
 * What a write did, for a writer that applies its changes itself and holds only the scene before
 * and after: the nodes that appeared, changed or went are read off the two.
 */
export function coherenceBetween(before: SceneNodes, after: SceneNodes): CoherenceDelta | null {
  const changes: SceneChanges = { create: [], update: [], delete: [] }
  for (const [id, node] of Object.entries(after)) {
    if (!(id in before)) changes.create!.push({ node, parentId: node.parentId ?? undefined })
    else if (before[id] !== node) changes.update!.push({ id, data: {} })
  }
  for (const id of Object.keys(before)) if (!(id in after)) changes.delete!.push(id)
  return coherenceOfChange(before, after, [changes])
}
