import type { AnyNode } from '@pascal-app/core'

/** A titled group of the room-name combobox. */
export type RoomNameSection = { id: string; title: string; names: readonly string[] }

/** What the room reads as, which decides the section shown first. */
export type RoomNameContext = 'room' | 'outdoor' | 'mezzanine'

/** Names for any room, in the order the dropdown lists their sections. */
export const ROOM_NAME_SECTIONS: readonly RoomNameSection[] = [
  {
    id: 'living',
    title: 'Living',
    names: [
      'Living room',
      'Family room',
      'Dining room',
      'Kitchen',
      'Kitchenette',
      'Pantry',
      'Lounge',
      'Den',
      'Library',
      'Playroom',
      'Home cinema',
      'Games room',
      'Sunroom',
    ],
  },
  {
    id: 'sleeping',
    title: 'Sleeping',
    names: [
      'Bedroom',
      'Primary bedroom',
      'Guest room',
      "Kids' room",
      'Nursery',
      'Dressing room',
      'Walk-in closet',
    ],
  },
  {
    id: 'bathrooms',
    title: 'Bathrooms',
    names: ['Bathroom', 'En-suite', 'Shower room', 'Toilet', 'Powder room'],
  },
  {
    id: 'work',
    title: 'Work & hobbies',
    names: ['Office', 'Study', 'Studio', 'Workshop', 'Gym'],
  },
  {
    id: 'circulation',
    title: 'Circulation',
    names: ['Entrance', 'Hallway', 'Corridor', 'Landing', 'Stairwell', 'Mudroom'],
  },
  {
    id: 'utility',
    title: 'Utility & storage',
    names: [
      'Laundry',
      'Utility room',
      'Storage',
      'Closet',
      'Boiler room',
      'Cellar',
      'Basement',
      'Attic',
      'Garage',
    ],
  },
  {
    id: 'outdoor',
    title: 'Outdoor',
    names: [
      'Garden',
      'Patio',
      'Terrace',
      'Balcony',
      'Porch',
      'Veranda',
      'Deck',
      'Courtyard',
      'Pool area',
      'Carport',
      'Garden shed',
    ],
  },
]

/** Only offered, and first, when the selection is a mezzanine. */
export const MEZZANINE_NAME_SECTION: RoomNameSection = {
  id: 'mezzanine',
  title: 'Mezzanine',
  names: ['Mezzanine', 'Loft', 'Reading nook', 'Gallery'],
}

/**
 * A mezzanine is one; a room reads as outdoor with no ceiling, without a wall
 * of its own (a terrace closed by separators) or when it is not a room inside
 * walls at all. Everything else is an indoor room.
 */
export function roomNameContext(nodes: Record<string, AnyNode>, zoneId: string): RoomNameContext {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') return 'room'
  if (zone.floor?.support === 'open') return 'mezzanine'
  if (zone.spaceRole !== 'room' || zone.hasCeiling === false || !zone.boundaryWallIds.length)
    return 'outdoor'
  return 'room'
}

/** A name without the number the picker adds to a repeat: "Bedroom 2" → "Bedroom". */
export function baseRoomName(name: string) {
  return name.trim().replace(/\s+\d+$/, '')
}

/** The names the level's other rooms go by (a mezzanine's level is its host's). */
function otherRoomNames(nodes: Record<string, AnyNode>, zoneId: string) {
  const levelId = nodes[zoneId]?.parentId
  const names: string[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.id === zoneId || node.parentId !== levelId) continue
    const name = node.name?.trim()
    if (name) names.push(name)
  }
  return names
}

/** How many of the level's other rooms already go by `name` (numbered or not). */
export function roomNameUseCount(nodes: Record<string, AnyNode>, zoneId: string, name: string) {
  const wanted = name.trim().toLowerCase()
  return otherRoomNames(nodes, zoneId).filter(
    (other) => baseRoomName(other).toLowerCase() === wanted,
  ).length
}

/**
 * The name a picked suggestion becomes: itself while no other room on the
 * level has it, otherwise the first free "Name 2", "Name 3"…
 */
export function numberedRoomName(nodes: Record<string, AnyNode>, zoneId: string, name: string) {
  const taken = new Set(otherRoomNames(nodes, zoneId).map((other) => other.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let index = 2
  while (taken.has(`${name} ${index}`.toLowerCase())) index++
  return `${name} ${index}`
}

/**
 * The combobox's sections for one room: the catalog, with the section its
 * context calls for first (Mezzanine, only for a mezzanine; Outdoor for an
 * outdoor room), then the rest in their usual order. Other rooms' names are
 * not offered — a name already used on the level is numbered when picked.
 */
export function roomNameSections(
  nodes: Record<string, AnyNode>,
  zoneId: string,
): RoomNameSection[] {
  const context = roomNameContext(nodes, zoneId)
  const first =
    context === 'mezzanine'
      ? [MEZZANINE_NAME_SECTION]
      : context === 'outdoor'
        ? ROOM_NAME_SECTIONS.filter((section) => section.id === 'outdoor')
        : []
  return [...first, ...ROOM_NAME_SECTIONS.filter((section) => !first.includes(section))]
}
