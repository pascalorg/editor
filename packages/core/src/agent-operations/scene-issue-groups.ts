import { DOOR_STOPPED_BLOCKING_DEG } from '../spatial/usage-field/swings'
import type { SceneNodes } from './types'
import type { SceneIssue } from './verify-scene'

export type SceneIssueGroup = {
  type: string
  message: string
  severity?: 'info' | 'warning'
  count: number
  nodeIds: string[]
  nodes: { id: string; name: string; count: number }[]
  issueIndexes: number[]
}

const BLOCKERS = new Set(['room_unreachable', 'door_blocked'])
const REPEATS = new Set(['item_overlap', 'item_too_close'])

/** A door whose leaf stops short of `DOOR_STOPPED_BLOCKING_DEG` is no way through, whatever it meets. */
const isStoppedDoor = (issue: SceneIssue) =>
  issue.type === 'usage_door_swing' &&
  'valueDeg' in issue &&
  typeof issue.valueDeg === 'number' &&
  issue.valueDeg < DOOR_STOPPED_BLOCKING_DEG

const severityOf = (issue: SceneIssue | undefined) =>
  issue && 'severity' in issue ? issue.severity : undefined

function priority(issue: SceneIssue): number {
  if (BLOCKERS.has(issue.type) || isStoppedDoor(issue)) return 0
  if (severityOf(issue) === 'info') return 3
  return REPEATS.has(issue.type) ? 2 : 1
}

function namedIds(issue: SceneIssue, nodes: SceneNodes): string[] {
  return [
    ...new Set(
      Object.entries(issue).flatMap(([key, value]) => {
        if (key.endsWith('Ids') && Array.isArray(value))
          return value.filter((id): id is string => typeof id === 'string' && !!nodes[id])
        if (key.endsWith('Id') && typeof value === 'string' && nodes[value]) return [value]
        return []
      }),
    ),
  ]
}

function groupMessage(type: string, count: number, nodeCount: number): string {
  const kind = type.replaceAll('_', ' ')
  return `${count} ${kind} findings${nodeCount ? ` involving ${nodeCount} elements` : ''}.`
}

export function sceneIssueGroups(issues: SceneIssue[], nodes: SceneNodes): SceneIssueGroup[] {
  issues.sort((first, second) => priority(first) - priority(second))
  const groups = new Map<string, SceneIssueGroup>()
  for (const [index, issue] of issues.entries()) {
    let group = groups.get(issue.type)
    if (!group) {
      group = {
        type: issue.type,
        message: issue.message,
        count: 0,
        nodeIds: [],
        nodes: [],
        issueIndexes: [],
      }
      groups.set(issue.type, group)
    }
    group.count++
    group.issueIndexes.push(index)
    for (const id of namedIds(issue, nodes)) {
      const involved = group.nodes.find((node) => node.id === id)
      if (involved) involved.count++
      else group.nodes.push({ id, name: nodes[id]?.name ?? id, count: 1 })
    }
  }
  for (const group of groups.values()) {
    group.nodes.sort((first, second) => first.id.localeCompare(second.id))
    group.nodeIds = group.nodes.map(({ id }) => id)
    if (group.count > 1) {
      const summary = groupMessage(group.type, group.count, group.nodeIds.length)
      group.message = group.nodeIds.length ? summary : `${summary} First: ${group.message}`
    }
    if (group.issueIndexes.every((index) => severityOf(issues[index]) === 'info'))
      group.severity = 'info'
    else if (group.issueIndexes.some((index) => severityOf(issues[index]) === 'warning'))
      group.severity = 'warning'
  }
  return [...groups.values()]
}
