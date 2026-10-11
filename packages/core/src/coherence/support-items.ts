import type { AnyNode } from '../schema'
import { measureSupport, type PostReading, type RoofReading } from './support'
import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceItem, CoherenceResolution, SupportIssue } from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

const fmt = (value: number) => value.toFixed(2)
const round3 = (value: number) => Math.round(value * 1000) / 1000
const names = (ids: readonly string[]) =>
  ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more` : ids.join(', ')

function orphanResolutions(
  nodes: SceneNodes,
  posts: readonly PostReading[],
): CoherenceResolution[] {
  const resolutions: CoherenceResolution[] = []
  const label = posts.length === 1 ? posts[0]!.column.id : `the ${posts.length} posts`

  // Something stands above them, clear of their tops: close the gap from either side.
  const reached = posts.filter((post) => post.above)
  if (reached.length === posts.length) {
    const gaps = posts.map((post) => post.above!.gap)
    resolutions.push({
      label: `Raise ${label} to meet what is above ${posts.length === 1 ? 'it' : 'them'}`,
      edits: posts.map((post) => ({
        id: post.column.id,
        set: { height: round3(post.column.height + post.above!.gap) },
      })),
      note: `${names([...new Set(posts.map((post) => post.above!.id))])} stand${posts.every((post) => post.above!.id === posts[0]!.above!.id) ? 's' : ''} ${fmt(Math.min(...gaps))}${Math.max(...gaps) - Math.min(...gaps) > 0.005 ? `–${fmt(Math.max(...gaps))}` : ''} m above ${posts.length === 1 ? 'its' : 'their'} top${posts.length === 1 ? '' : 's'}.`,
    })
    const roofId = posts[0]!.above!.id
    const roof = nodes[roofId]
    const same = posts.every((post) => post.above!.id === roofId)
    if (
      same &&
      roof?.type === 'roof' &&
      Math.max(...gaps) - Math.min(...gaps) < 0.005 &&
      (roof.support === undefined || roof.support.kind === 'level')
    ) {
      resolutions.push({
        label: `Lower ${roofId} by ${fmt(gaps[0]!)} m, onto ${label}`,
        edits: [
          {
            id: roofId,
            set: {
              position: [roof.position[0], round3(roof.position[1] - gaps[0]!), roof.position[2]],
            },
          },
        ],
      })
    }
  } else {
    resolutions.push({
      label: `Put something on ${label}`,
      note: 'A roof, a beam or a floor resting on the top of the post (within 2 cm) is what a post is for.',
    })
  }

  resolutions.push({
    label: `Declare ${label} ornament (role: 'ornament')`,
    edits: posts.map((post) => ({ id: post.column.id, set: { role: 'ornament' } })),
    note: 'An ornamental post is not asked to carry anything.',
  })
  resolutions.push({
    label: `Delete ${label} if ${posts.length === 1 ? 'it' : 'they'} should not be there`,
    note: 'delete_node, one post at a time.',
  })
  return resolutions
}

function floatingPostResolutions(posts: readonly PostReading[]): CoherenceResolution[] {
  const label = posts.length === 1 ? posts[0]!.column.id : `the ${posts.length} posts`
  const resolutions: CoherenceResolution[] = []
  const resting = posts.filter((post) => post.below)
  if (resting.length === posts.length) {
    const drops = posts.map((post) => post.base - post.below!.top)
    resolutions.push({
      label: `Lower ${label} onto ${names([...new Set(posts.map((post) => (post.below!.id === 'ground' ? 'the ground' : post.below!.id)))])} (${
        Math.max(...drops) - Math.min(...drops) > 0.005
          ? `${fmt(Math.min(...drops))}–${fmt(Math.max(...drops))}`
          : fmt(drops[0]!)
      } m)`,
      edits: posts.map((post, index) => ({
        id: post.column.id,
        set: {
          position: [
            post.column.position[0],
            round3(post.column.position[1] - drops[index]!),
            post.column.position[2],
          ],
        },
      })),
    })
  }
  resolutions.push({
    label: `Put a floor, a wall or a post under ${label}`,
    note: 'A post stands on something: a slab, the ground, a wall top or another post.',
  })
  resolutions.push({
    label: `Delete ${label} if ${posts.length === 1 ? 'it' : 'they'} should not be there`,
    note: 'delete_node, one post at a time.',
  })
  return resolutions
}

function floatingRoofResolutions(
  roof: RoofReading,
  posts: readonly PostReading[],
): CoherenceResolution[] {
  const resolutions: CoherenceResolution[] = []
  const under = posts.filter((post) => post.above?.id === roof.roof.id)
  const gap = roof.nearest?.gap
  if (gap !== undefined) {
    if (roof.lift - gap >= -COHERENCE_TOLERANCES.contact) {
      resolutions.push({
        label: `Lower ${roof.roof.id} by ${fmt(gap)} m, onto ${roof.nearest!.id}`,
        edits: [
          {
            id: roof.roof.id,
            set: {
              position: [
                roof.roof.position[0],
                round3(roof.roof.position[1] - gap),
                roof.roof.position[2],
              ],
            },
          },
        ],
        note: 'The posts and walls under it then meet its underside; the others are reported by what they meet.',
      })
    }
    if (under.length) {
      resolutions.push({
        label: `Raise ${under.length === 1 ? under[0]!.column.id : `the ${under.length} posts`} to meet ${roof.roof.id}`,
        edits: under.map((post) => ({
          id: post.column.id,
          set: { height: round3(post.column.height + post.above!.gap) },
        })),
      })
    }
  } else {
    resolutions.push({
      label: `Build walls or posts under ${roof.roof.id}`,
      note: 'Something must reach its underside: a wall or a post whose top is within 2 cm of it.',
    })
  }
  resolutions.push({
    label: `Seat ${roof.roof.id} on its level plane (position y 0)`,
    edits: [
      {
        id: roof.roof.id,
        set: { position: [roof.roof.position[0], 0, roof.roof.position[2]] },
      },
    ],
    note: 'On its level plane the roof is carried by the level; the walls and posts under it are then judged against it.',
  })
  return resolutions
}

function cantileverResolutions(roof: RoofReading): CoherenceResolution[] {
  const resolutions: CoherenceResolution[] = []
  for (const reach of roof.reaches) {
    const allowed = COHERENCE_TOLERANCES.cantileverRatio * reach.backspan
    resolutions.push({
      label: `Carry the ${reach.side} edge of ${roof.roof.id}: a post or a wall under it`,
      note: `It reaches ${fmt(reach.overhang)} m past its supports there; a support under the overhang makes it a span.`,
    })
    resolutions.push({
      label: `Trim ${roof.roof.id} back ${fmt(reach.overhang - Math.max(allowed, COHERENCE_TOLERANCES.eaveAllowance))} m on the ${reach.side}`,
      note: "Narrow or shorten the roof's segments on that side until it reaches no more than a quarter of the span.",
    })
  }
  resolutions.push({
    label: 'Dispute it, if it is an engineered cantilever',
    note: 'A steel, concrete or truss structure carries more than a quarter of its span: say what it is and show the span (dispute_coherence_item). The rule here is provisional.',
  })
  return resolutions
}

/** The Support items of a checklist; what the maker said about an item is added by the caller. */
export function supportItems(issues: readonly SupportIssue[], nodes: SceneNodes): CoherenceItem[] {
  if (!issues.length) return []
  const reading = measureSupport(nodes)
  const posts = new Map<string, PostReading>(reading.posts.map((post) => [post.column.id, post]))
  const roofs = new Map<string, RoofReading>(reading.roofs.map((roof) => [roof.roof.id, roof]))
  const groups = new Map<string, SupportIssue[]>()
  for (const issue of issues) groups.set(issue.group, [...(groups.get(issue.group) ?? []), issue])

  return [...groups].map(([id, members]) => {
    const [first] = members as [SupportIssue]
    const ids = [...new Set(members.map((issue) => issue.nodeIds[0]!))].sort()
    const subjects = ids
      .map((nodeId) => posts.get(nodeId))
      .filter((post): post is PostReading => !!post)
    const roof = roofs.get(first.carrierId)
    const resolutions =
      first.code === 'support_orphan'
        ? orphanResolutions(nodes, subjects)
        : first.code === 'support_cantilever' && roof
          ? cantileverResolutions(roof)
          : roof
            ? floatingRoofResolutions(roof, reading.posts)
            : floatingPostResolutions(subjects)
    const worst = members.reduce((a, b) =>
      b.figures.overhang / (b.figures.backspan || 1) >
      a.figures.overhang / (a.figures.backspan || 1)
        ? b
        : a,
    )
    return {
      id,
      status: 'open',
      family: first.family,
      code: first.code,
      severity: first.severity,
      principle: first.principle,
      count: members.length,
      nodeIds: ids,
      issueIds: members.map((issue) => issue.id).sort(),
      measured: first.code === 'support_cantilever' ? worst.measured : first.measured,
      resolutions,
      check: {
        // A post is looked at itself, or the level it stands on would frame only its walls; a roof
        // is looked at on its level, which frames the roof.
        view: {
          target: nodes[first.carrierId]?.type === 'column' ? first.carrierId : first.levelIds[0]!,
          from: 'south-west',
          elevation: 35,
        },
        measure: `${names(ids)}: ${roof ? `seat at ${fmt(first.figures.at)} m` : `${first.code === 'support_orphan' ? 'top' : 'base'} at ${fmt(first.figures.at)} m`}, ${COHERENCE_TOLERANCES.contact} m is the contact`,
      },
    } satisfies CoherenceItem
  })
}
