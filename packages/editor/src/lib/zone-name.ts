import type { AnyNode } from '@pascal-app/core'

const ZONE_NAME = /^Zone (\d+)$/

/**
 * Next free "Zone N" name. Rooms own zones too ("Room", "Kitchen", …), so
 * counting every zone would skip numbers; only existing "Zone N" names count.
 */
export function nextZoneName(nodes: Record<string, AnyNode>): string {
  let highest = 0
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone') continue
    const match = ZONE_NAME.exec(node.name ?? '')
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `Zone ${highest + 1}`
}
