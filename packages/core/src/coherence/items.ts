import type { AnyNode } from '../schema'
import { disputeStates, withDispute } from './disputes'
import { enclosureItems } from './enclosure-items'
import { hostingItems } from './hosting-items'
import { supportItems } from './support-items'
import type {
  CoherenceIssue,
  CoherenceItem,
  EnclosureIssue,
  HostingIssue,
  SupportIssue,
} from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * The checklist an agent reads: each family turns its issues into items (a group of one kind, with
 * the moves that settle it and a view that shows it), in the order the issues came. What the maker
 * said about an item is added here, once, whatever family it belongs to.
 */
export function coherenceItems(
  issues: readonly CoherenceIssue[],
  nodes: SceneNodes,
): CoherenceItem[] {
  if (!issues.length) return []
  const built = new Map<string, CoherenceItem>()
  const enclosure = issues.filter((issue): issue is EnclosureIssue => issue.family === 'enclosure')
  for (const item of enclosureItems(enclosure, nodes)) built.set(item.id, item)
  const support = issues.filter((issue): issue is SupportIssue => issue.family === 'support')
  for (const item of supportItems(support, nodes)) built.set(item.id, item)
  const hosting = issues.filter((issue): issue is HostingIssue => issue.family === 'hosting')
  for (const item of hostingItems(hosting, nodes)) built.set(item.id, item)

  const spoken = disputeStates(issues, nodes)
  const items: CoherenceItem[] = []
  for (const issue of issues) {
    const item = built.get(issue.group)
    if (!item) continue
    built.delete(issue.group)
    items.push(withDispute(item, spoken.get(issue.group)))
  }
  return items
}
