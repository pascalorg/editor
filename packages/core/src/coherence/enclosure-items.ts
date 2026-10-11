import type { AnyNode } from '../schema'
import { sideOf } from './compass'
import { measureEnclosure, midpoint, type WallRoofContact } from './enclosure'
import { COHERENCE_TOLERANCES } from './tolerances'
import type {
  CoherenceCheck,
  CoherenceItem,
  CoherenceResolution,
  EnclosureCode,
  EnclosureIssue,
} from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

const eps = COHERENCE_TOLERANCES.contact
const fmt = (value: number) => value.toFixed(2)
const round3 = (value: number) => Math.round(value * 1000) / 1000
/** A height rounded down to the centimetre, so the move never overshoots its target. */
const floor2 = (value: number) => Math.floor(value * 100 + 1e-6) / 100
const ceil2 = (value: number) => Math.ceil(value * 100 - 1e-6) / 100

/** How far a contact is from what its kind asks: the number the worst of a group is picked by. */
const sizeOf = (code: EnclosureCode) => (contact: WallRoofContact) => {
  switch (code) {
    case 'roof_wall_gap':
      return contact.figures.shortOfUnderside
    case 'roof_wall_pierce':
      return contact.figures.overUnderside
    case 'roof_wall_parapet_short':
      return COHERENCE_TOLERANCES.upstand - contact.figures.aboveCovering
    default:
      return 0
  }
}

const worstOf = (
  contacts: readonly WallRoofContact[],
  size: (contact: WallRoofContact) => number,
) => contacts.reduce((worst, contact) => (size(contact) > size(worst) ? contact : worst))

/** Openings a lowered wall would leave standing above its top, named so the cost shows. */
function openingsAbove(nodes: SceneNodes, contact: WallRoofContact, height: number): string[] {
  const above: string[] = []
  for (const id of contact.wall.children) {
    const opening = nodes[id]
    if (opening?.type !== 'door' && opening?.type !== 'window') continue
    const head = opening.position[1] + opening.height / 2
    if (head > height + eps) above.push(`${id} (head ${fmt(head)} m)`)
  }
  return above
}

/** What raising the roof to `level` would open: exterior walls that stop short of it. */
function fallShort(contacts: readonly WallRoofContact[], level: number): string {
  const short = contacts.filter((contact) => contact.exterior && contact.top < level - eps)
  if (!short.length) return ''
  const most = Math.max(...short.map((contact) => level - contact.top))
  const names = short.map((contact) => contact.wall.id)
  return `${names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')} would then fall up to ${fmt(most)} m short`
}

function pierceResolutions(
  nodes: SceneNodes,
  group: readonly WallRoofContact[],
  roofContacts: readonly WallRoofContact[],
): CoherenceResolution[] {
  const body = group[0]!.body
  const roof = body.roof
  if (group.every((contact) => contact.declaredParapet)) return declaredResolutions(group)
  const resolutions: CoherenceResolution[] = []

  const targets = group.map((contact) => contact.figures.undersideLow)
  const lowest = Math.min(...targets)
  const highest = Math.max(...targets)
  const same = highest - lowest < 0.005
  const lowered = group.map((contact, index) => ({
    contact,
    height: floor2(targets[index]! - contact.base),
  }))
  const costs = lowered.flatMap(({ contact, height }) => openingsAbove(nodes, contact, height))
  resolutions.push({
    label: `${
      group.length === 1 ? `Lower ${group[0]!.wall.id}` : `Lower the ${group.length} walls`
    } to ${same ? `${fmt(lowest)} m` : `the roof underside (${fmt(lowest)}–${fmt(highest)} m)`}`,
    edits: lowered.map(({ contact, height }) => ({
      id: contact.wall.id,
      set: { height },
    })),
    ...(costs.length
      ? { note: `${costs.slice(0, 3).join(', ')} then stand above the wall and are reported next.` }
      : {}),
  })

  if (roof.support?.kind === 'level' || roof.support === undefined) {
    const top = Math.max(...group.map((contact) => contact.top))
    const consequence = fallShort(roofContacts, top)
    resolutions.push({
      label: `Raise the roof to ${fmt(top)} m`,
      edits: [
        {
          id: roof.id,
          set: {
            position: [
              roof.position[0],
              round3(roof.position[1] + top - body.seat),
              roof.position[2],
            ],
          },
        },
      ],
      ...(consequence ? { note: consequence } : {}),
    })
    resolutions.push({
      label: `Seat the roof on its walls (support.kind = 'walls'): its base follows the highest wall top, ${fmt(top)} m now`,
      edits: [{ id: roof.id, set: { support: { kind: 'walls' } } }],
      ...(consequence ? { note: consequence } : {}),
    })
  }

  const climbing = group.filter((contact) => contact.figures.coveringRange > eps)
  if (climbing.length) {
    const steep = climbing.reduce((a, b) =>
      b.figures.coveringRange > a.figures.coveringRange ? b : a,
    )
    resolutions.push({
      label:
        group.length === 1
          ? `Raise ${group[0]!.wall.id} as a parapet`
          : 'Raise the walls as parapets',
      note: `Not reachable: the roof rises ${fmt(steep.figures.coveringRange)} m along ${steep.wall.id}, so a wall standing above it would have to climb with it.`,
    })
  } else {
    const top = parapetTop(group)
    resolutions.push({
      label: `Raise ${group.length === 1 ? group[0]!.wall.id : `the ${group.length} walls`} as ${group.length === 1 ? 'a parapet' : 'parapets'} to ${fmt(top)} m (${COHERENCE_TOLERANCES.upstand} m above the roof covering)`,
      edits: group.map((contact) => ({
        id: contact.wall.id,
        set: { height: ceil2(top - contact.base), roofJunction: 'parapet' },
      })),
      note: 'Declared parapets are tested as parapets: they must clear the roof covering along their whole length and say they are capped (cap: true), which is the next item.',
    })
  }
  return resolutions
}

/** A parapet's top, rounded up: the upstand above the highest the roof covering gets. */
const parapetTop = (group: readonly WallRoofContact[]) =>
  ceil2(
    Math.max(...group.map((contact) => contact.figures.coveringHigh)) +
      COHERENCE_TOLERANCES.upstand,
  )

/** The ways out for walls declared parapets that do not rise past the roof as they say. */
function declaredResolutions(group: readonly WallRoofContact[]): CoherenceResolution[] {
  const names = group.length === 1 ? group[0]!.wall.id : `the ${group.length} walls`
  const climbing = group.filter((contact) => contact.figures.coveringRange > eps)
  const resolutions: CoherenceResolution[] = []
  if (climbing.length) {
    const steep = climbing.reduce((a, b) =>
      b.figures.coveringRange > a.figures.coveringRange ? b : a,
    )
    resolutions.push({
      label: `Raise ${names} to clear the roof`,
      note: `Not reachable: the roof rises ${fmt(steep.figures.coveringRange)} m along ${steep.wall.id}, so a parapet standing above it would have to climb with it.`,
    })
  } else {
    const top = parapetTop(group)
    resolutions.push({
      label: `Raise ${names} to ${fmt(top)} m, ${COHERENCE_TOLERANCES.upstand} m above the roof covering (declared parapets)`,
      edits: group.map((contact) => ({
        id: contact.wall.id,
        set: { height: ceil2(top - contact.base) },
      })),
    })
  }
  const targets = group.map((contact) => contact.figures.undersideLow)
  resolutions.push({
    label: `Take the declaration off ${names}, and let ${group.length === 1 ? 'it' : 'them'} carry the roof at ${fmt(Math.min(...targets))} m`,
    edits: group.map((contact, index) => ({
      id: contact.wall.id,
      set: { height: floor2(targets[index]! - contact.base), roofJunction: null, cap: null },
    })),
    note: 'null clears a field: send these edits with update_node or apply_patch.',
  })
  return resolutions
}

function uncappedResolutions(group: readonly WallRoofContact[]): CoherenceResolution[] {
  return [
    {
      label: `Declare ${group.length === 1 ? group[0]!.wall.id : `the ${group.length} walls`} capped (cap: true)`,
      edits: group.map((contact) => ({ id: contact.wall.id, set: { cap: true } })),
      note: 'No coping is drawn yet: this records that the parapet is capped.',
    },
  ]
}

function gapResolutions(group: readonly WallRoofContact[]): CoherenceResolution[] {
  const resolutions: CoherenceResolution[] = []
  const slopes = group.map((contact) => {
    const unders = contact.samples.map((sample) => sample.underside)
    return { contact, range: Math.max(...unders) - Math.min(...unders), high: Math.max(...unders) }
  })
  const bent = slopes.filter(({ range }) => range > eps)
  const label =
    group.length === 1 ? `Raise ${group[0]!.wall.id}` : `Raise the ${group.length} walls`
  if (bent.length) {
    const steep = bent.reduce((a, b) => (b.range > a.range ? b : a))
    resolutions.push({
      label: `${label} to the roof underside`,
      note: `Not reachable with a flat top: the roof underside climbs ${fmt(steep.range)} m along ${steep.contact.wall.id}.`,
    })
  } else {
    resolutions.push({
      label: `${label} to the roof underside`,
      edits: slopes.map(({ contact, high }) => ({
        id: contact.wall.id,
        set: { height: ceil2(high - contact.base) },
      })),
    })
  }
  const inset = Math.min(...group.map((contact) => contact.figures.insetFromEdge))
  resolutions.push({
    label: 'Move the wall out to the roof edge',
    note: `The nearest stands ${fmt(inset)} m inside the roof edge; a wall on the edge meets the roof at its seat.`,
  })
  resolutions.push({
    label: 'Trim the roof back to the wall line',
    note: "Narrow or shorten the roof's segments until their edge falls on the wall.",
  })
  return resolutions
}

function checkFor(contact: WallRoofContact, against: 'underside' | 'covering'): CoherenceCheck {
  const gap = against === 'underside'
  const first = contact.samples[0]!
  const last = contact.samples[contact.samples.length - 1]!
  return {
    view: {
      target: contact.wall.id,
      from: sideOf(contact.body.center, midpoint(contact.wall)),
      elevation: 35,
    },
    measure: `${contact.wall.id}: top ${fmt(contact.top)} m against the roof ${gap ? 'underside' : 'covering'} at s = ${fmt(first.at)} m (${fmt(gap ? first.underside : first.covering)} m) and s = ${fmt(last.at)} m (${fmt(gap ? last.underside : last.covering)} m)`,
  }
}

function resolutionsFor(
  code: EnclosureCode,
  nodes: SceneNodes,
  group: readonly WallRoofContact[],
  roofContacts: readonly WallRoofContact[],
): CoherenceResolution[] {
  switch (code) {
    case 'roof_wall_gap':
      return gapResolutions(group)
    case 'roof_wall_parapet_short':
      return declaredResolutions(group)
    case 'roof_wall_parapet_uncapped':
      return uncappedResolutions(group)
    default:
      return pierceResolutions(nodes, group, roofContacts)
  }
}

/**
 * The Enclosure items of a checklist: issues of one kind under one roof become one item, with the
 * moves that settle it computed from the measurements and the view that shows it. An item lists only
 * what is open; a repeat of a repair is the same item and the same ids. What the maker said about
 * an item is added by the caller.
 */
export function enclosureItems(
  issues: readonly EnclosureIssue[],
  nodes: SceneNodes,
): CoherenceItem[] {
  if (!issues.length) return []
  const contacts = new Map<string, WallRoofContact>()
  const byRoof = new Map<string, WallRoofContact[]>()
  for (const contact of measureEnclosure(nodes)) {
    contacts.set(`${contact.body.roof.id}|${contact.wall.id}`, contact)
    byRoof.set(contact.body.roof.id, [...(byRoof.get(contact.body.roof.id) ?? []), contact])
  }

  const groups = new Map<string, EnclosureIssue[]>()
  for (const issue of issues) groups.set(issue.group, [...(groups.get(issue.group) ?? []), issue])

  return [...groups].map(([id, members]) => {
    const [first] = members as [EnclosureIssue]
    const size = sizeOf(first.code)
    const roofId = first.nodeIds[1]!
    const group = members
      .map((issue) => contacts.get(`${roofId}|${issue.nodeIds[0]}`))
      .filter((contact): contact is WallRoofContact => !!contact)
    const worst = worstOf(group, size)
    const sizes = group.map(size)
    const worstIssue = members.find((issue) => issue.nodeIds[0] === worst.wall.id) ?? first
    return {
      id,
      status: 'open',
      family: first.family,
      code: first.code,
      severity: first.severity,
      principle: first.principle,
      count: members.length,
      nodeIds: [roofId, ...members.map((issue) => issue.nodeIds[0]!).sort()],
      issueIds: members.map((issue) => issue.id).sort(),
      measured: {
        ...worstIssue.measured,
        ...(members.length > 1 && Math.max(...sizes) - Math.min(...sizes) > 0.005
          ? {
              spread: `${fmt(Math.min(...sizes))}–${fmt(Math.max(...sizes))} m across ${members.length} walls`,
            }
          : {}),
      },
      resolutions: resolutionsFor(first.code, nodes, group, byRoof.get(roofId) ?? []),
      check: checkFor(worst, first.code === 'roof_wall_gap' ? 'underside' : 'covering'),
    } satisfies CoherenceItem
  })
}
