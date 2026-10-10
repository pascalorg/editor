import type { AnyNode, DormerNode } from '../schema'
import { measureHosting, type OpeningReading } from './hosting'
import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceItem, CoherenceResolution, HostingIssue } from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

const fmt = (value: number) => value.toFixed(2)
const round3 = (value: number) => Math.round(value * 1000) / 1000
const names = (ids: readonly string[]) =>
  ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more` : ids.join(', ')

/** The moves that put one opening back inside its face, with what each costs. */
function openingResolutions(nodes: SceneNodes, reading: OpeningReading): CoherenceResolution[] {
  const { opening } = reading
  const deficit = COHERENCE_TOLERANCES.lintel - reading.margin
  const resolutions: CoherenceResolution[] = []
  const [x, y, z] = opening.position

  const lowered = reading.sill - deficit
  if (lowered >= -COHERENCE_TOLERANCES.contact || reading.hostKind === 'dormer') {
    resolutions.push({
      label: `Lower ${opening.id} by ${fmt(deficit)} m`,
      edits: [{ id: opening.id, set: { position: [x, round3(y - deficit), z] } }],
      note:
        reading.hostKind === 'wall'
          ? `Its head then stands ${fmt(COHERENCE_TOLERANCES.lintel)} m under the roof; its sill goes to ${fmt(lowered)} m.`
          : undefined,
    })
  }
  if (opening.height - deficit >= 0.3) {
    resolutions.push({
      label: `Shorten ${opening.id} by ${fmt(deficit)} m, keeping its sill`,
      edits: [
        {
          id: opening.id,
          set: {
            height: round3(opening.height - deficit),
            position: [x, round3(y - deficit / 2), z],
          },
        },
      ],
    })
  }
  const dormer = reading.hostKind === 'dormer' ? (nodes[reading.hostId] as DormerNode) : undefined
  if (dormer)
    resolutions.push({
      label: `Raise the dormer wall by ${fmt(deficit)} m`,
      edits: [{ id: dormer.id, set: { height: round3(dormer.height + deficit) } }],
    })
  if (reading.hostKind === 'wall' && reading.wallOver > COHERENCE_TOLERANCES.contact) {
    resolutions.push({
      label: `Settle ${reading.hostId} against ${reading.clippedBy} first`,
      note: `${reading.hostId} stands ${fmt(reading.wallOver)} m past where the roof's own wall ends under ${reading.clippedBy} here, which the roof–wall item reports: seating the roof on the wall, or lowering the wall to the roof, moves the face this window is cut in.`,
    })
  }
  return resolutions
}

/** The Hosting items of a checklist; what the maker said about an item is added by the caller. */
export function hostingItems(issues: readonly HostingIssue[], nodes: SceneNodes): CoherenceItem[] {
  if (!issues.length) return []
  const readings = new Map<string, OpeningReading>(
    measureHosting(nodes).map((reading) => [reading.opening.id, reading]),
  )
  const groups = new Map<string, HostingIssue[]>()
  for (const issue of issues) groups.set(issue.group, [...(groups.get(issue.group) ?? []), issue])

  return [...groups].map(([id, members]) => {
    const [first] = members as [HostingIssue]
    const openings = members
      .map((issue) => readings.get(issue.nodeIds[0]!))
      .filter((reading): reading is OpeningReading => !!reading)
    const worst = openings.reduce((a, b) => (b.margin < a.margin ? b : a))
    const worstIssue = members.find((issue) => issue.nodeIds[0] === worst.opening.id) ?? first
    const ids = members.map((issue) => issue.nodeIds[0]!).sort()
    const resolutions = openings.flatMap((reading) => openingResolutions(nodes, reading))
    return {
      id,
      status: 'open',
      family: first.family,
      code: first.code,
      severity: first.severity,
      principle: first.principle,
      count: members.length,
      nodeIds: [...ids, first.nodeIds[1]!],
      issueIds: members.map((issue) => issue.id).sort(),
      measured: worstIssue.measured,
      resolutions,
      check: {
        // view_scene frames a wall, not a window in it: from the wall's outside, the opening is in
        // the picture. A dormer's face is not a target; the roof level frames the roof it stands on.
        view: {
          target: worst.hostKind === 'wall' ? worst.hostId : worst.levelId,
          from: worst.view.from,
          elevation: 35,
        },
        measure: `${names(ids)}: head at ${fmt(worst.head)} m from the base, the face ends at ${fmt(worst.top)} m (${worst.hostKind === 'dormer' ? `the wall of ${worst.hostId}` : worst.clippedBy})`,
      },
    } satisfies CoherenceItem
  })
}
