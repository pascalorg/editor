import type { AnyNode } from '../schema/types'

type OpeningNode = Extract<AnyNode, { type: 'door' | 'window' }>
type WallNode = Extract<AnyNode, { type: 'wall' }>

/** Slack in meters before an opening counts as leaving its host wall. */
export const OPENING_BOUNDS_TOLERANCE = 0.01

export type OpeningBoundsIssue = {
  openingId: string
  openingType: OpeningNode['type']
  wallId: string
} & (
  | { kind: 'along_wall'; from: number; to: number; wallLength: number }
  | { kind: 'vertical'; bottom: number; top: number; wallHeight: number }
)

/**
 * Geometric containment of a wall-hosted opening. `position` is wall-local:
 * x runs along the wall from `start`, y is the opening's center height from
 * the wall base. Callers resolve `wallHeight` (plane-bound walls take it
 * from the storey, explicit walls from `height`) so this stays pure over
 * the node data and both the build-JSON validator and the MCP verify tool
 * report the same thing.
 */
export function checkOpeningWithinWall(
  opening: Pick<OpeningNode, 'id' | 'type' | 'position' | 'width' | 'height'>,
  wall: Pick<WallNode, 'id' | 'start' | 'end'>,
  wallHeight: number,
): OpeningBoundsIssue[] {
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const from = opening.position[0] - opening.width / 2
  const to = opening.position[0] + opening.width / 2
  const bottom = opening.position[1] - opening.height / 2
  const top = opening.position[1] + opening.height / 2
  const base = { openingId: opening.id, openingType: opening.type, wallId: wall.id }

  const issues: OpeningBoundsIssue[] = []
  if (from < -OPENING_BOUNDS_TOLERANCE || to > wallLength + OPENING_BOUNDS_TOLERANCE) {
    issues.push({ ...base, kind: 'along_wall', from, to, wallLength })
  }
  if (bottom < -OPENING_BOUNDS_TOLERANCE || top > wallHeight + OPENING_BOUNDS_TOLERANCE) {
    issues.push({ ...base, kind: 'vertical', bottom, top, wallHeight })
  }
  return issues
}

const m = (value: number) => value.toFixed(2)

export function formatOpeningBoundsIssue(issue: OpeningBoundsIssue): string {
  const subject = `${issue.openingType} ${issue.openingId}`
  if (issue.kind === 'along_wall') {
    return `${subject} extends outside wall ${issue.wallId}: spans ${m(issue.from)}–${m(issue.to)} m along a ${m(issue.wallLength)} m wall`
  }
  return `${subject} vertical bounds [${m(issue.bottom)}, ${m(issue.top)}] exceed wall ${issue.wallId} height ${m(issue.wallHeight)}m`
}
