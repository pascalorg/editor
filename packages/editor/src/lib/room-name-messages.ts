import type { MessageDescriptor } from '@pascal-app/core'
import type { RoomNameSection } from './room-name-catalog'

/**
 * The room-name catalog in the UI language. The catalog stays English (it is
 * matched, numbered and stored as data); the combobox and room labels show these.
 * `room-name-catalog.test.ts` fails when a catalog name has no entry here.
 */
/** Anything that translates a descriptor: a `PascalI18n`, or a stand-in in tests. */
export type DescriptorTranslator = { _(descriptor: MessageDescriptor): string }

export const ROOM_NAME_SECTION_TITLES: Record<string, MessageDescriptor> = {
  living: /* i18n */ { id: 'editor.roomName.section.living', message: 'Living' },
  sleeping: /* i18n */ { id: 'editor.roomName.section.sleeping', message: 'Sleeping' },
  bathrooms: /* i18n */ { id: 'editor.roomName.section.bathrooms', message: 'Bathrooms' },
  work: /* i18n */ { id: 'editor.roomName.section.work', message: 'Work & hobbies' },
  circulation: /* i18n */ { id: 'editor.roomName.section.circulation', message: 'Circulation' },
  utility: /* i18n */ { id: 'editor.roomName.section.utility', message: 'Utility & storage' },
  outdoor: /* i18n */ { id: 'editor.roomName.section.outdoor', message: 'Outdoor' },
  mezzanine: /* i18n */ { id: 'editor.roomName.section.mezzanine', message: 'Mezzanine' },
}

export const ROOM_NAME_MESSAGES: Record<string, MessageDescriptor> = {
  'Living room': /* i18n */ { id: 'editor.roomName.livingRoom', message: 'Living room' },
  'Family room': /* i18n */ { id: 'editor.roomName.familyRoom', message: 'Family room' },
  'Dining room': /* i18n */ { id: 'editor.roomName.diningRoom', message: 'Dining room' },
  Kitchen: /* i18n */ { id: 'editor.roomName.kitchen', message: 'Kitchen' },
  Kitchenette: /* i18n */ { id: 'editor.roomName.kitchenette', message: 'Kitchenette' },
  Pantry: /* i18n */ { id: 'editor.roomName.pantry', message: 'Pantry' },
  Lounge: /* i18n */ { id: 'editor.roomName.lounge', message: 'Lounge' },
  Den: /* i18n */ { id: 'editor.roomName.den', message: 'Den' },
  Library: /* i18n */ { id: 'editor.roomName.library', message: 'Library' },
  Playroom: /* i18n */ { id: 'editor.roomName.playroom', message: 'Playroom' },
  'Home cinema': /* i18n */ { id: 'editor.roomName.homeCinema', message: 'Home cinema' },
  'Games room': /* i18n */ { id: 'editor.roomName.gamesRoom', message: 'Games room' },
  Sunroom: /* i18n */ { id: 'editor.roomName.sunroom', message: 'Sunroom' },
  Bedroom: /* i18n */ { id: 'editor.roomName.bedroom', message: 'Bedroom' },
  'Primary bedroom': /* i18n */ {
    id: 'editor.roomName.primaryBedroom',
    message: 'Primary bedroom',
  },
  'Guest room': /* i18n */ { id: 'editor.roomName.guestRoom', message: 'Guest room' },
  "Kids' room": /* i18n */ { id: 'editor.roomName.kidsRoom', message: "Kids' room" },
  Nursery: /* i18n */ { id: 'editor.roomName.nursery', message: 'Nursery' },
  'Dressing room': /* i18n */ { id: 'editor.roomName.dressingRoom', message: 'Dressing room' },
  'Walk-in closet': /* i18n */ { id: 'editor.roomName.walkInCloset', message: 'Walk-in closet' },
  Bathroom: /* i18n */ { id: 'editor.roomName.bathroom', message: 'Bathroom' },
  'En-suite': /* i18n */ { id: 'editor.roomName.enSuite', message: 'En-suite' },
  'Shower room': /* i18n */ { id: 'editor.roomName.showerRoom', message: 'Shower room' },
  Toilet: /* i18n */ { id: 'editor.roomName.toilet', message: 'Toilet' },
  'Powder room': /* i18n */ { id: 'editor.roomName.powderRoom', message: 'Powder room' },
  Office: /* i18n */ { id: 'editor.roomName.office', message: 'Office' },
  Study: /* i18n */ { id: 'editor.roomName.study', message: 'Study' },
  Studio: /* i18n */ { id: 'editor.roomName.studio', message: 'Studio' },
  Workshop: /* i18n */ { id: 'editor.roomName.workshop', message: 'Workshop' },
  Gym: /* i18n */ { id: 'editor.roomName.gym', message: 'Gym' },
  Entrance: /* i18n */ { id: 'editor.roomName.entrance', message: 'Entrance' },
  Hallway: /* i18n */ { id: 'editor.roomName.hallway', message: 'Hallway' },
  Corridor: /* i18n */ { id: 'editor.roomName.corridor', message: 'Corridor' },
  Landing: /* i18n */ { id: 'editor.roomName.landing', message: 'Landing' },
  Stairwell: /* i18n */ { id: 'editor.roomName.stairwell', message: 'Stairwell' },
  Mudroom: /* i18n */ { id: 'editor.roomName.mudroom', message: 'Mudroom' },
  Laundry: /* i18n */ { id: 'editor.roomName.laundry', message: 'Laundry' },
  'Utility room': /* i18n */ { id: 'editor.roomName.utilityRoom', message: 'Utility room' },
  Storage: /* i18n */ { id: 'editor.roomName.storage', message: 'Storage' },
  Closet: /* i18n */ { id: 'editor.roomName.closet', message: 'Closet' },
  'Boiler room': /* i18n */ { id: 'editor.roomName.boilerRoom', message: 'Boiler room' },
  Cellar: /* i18n */ { id: 'editor.roomName.cellar', message: 'Cellar' },
  Basement: /* i18n */ { id: 'editor.roomName.basement', message: 'Basement' },
  Attic: /* i18n */ { id: 'editor.roomName.attic', message: 'Attic' },
  Garage: /* i18n */ { id: 'editor.roomName.garage', message: 'Garage' },
  Garden: /* i18n */ { id: 'editor.roomName.garden', message: 'Garden' },
  Patio: /* i18n */ { id: 'editor.roomName.patio', message: 'Patio' },
  Terrace: /* i18n */ { id: 'editor.roomName.terrace', message: 'Terrace' },
  Balcony: /* i18n */ { id: 'editor.roomName.balcony', message: 'Balcony' },
  Porch: /* i18n */ { id: 'editor.roomName.porch', message: 'Porch' },
  Veranda: /* i18n */ { id: 'editor.roomName.veranda', message: 'Veranda' },
  Deck: /* i18n */ { id: 'editor.roomName.deck', message: 'Deck' },
  Courtyard: /* i18n */ { id: 'editor.roomName.courtyard', message: 'Courtyard' },
  'Pool area': /* i18n */ { id: 'editor.roomName.poolArea', message: 'Pool area' },
  Carport: /* i18n */ { id: 'editor.roomName.carport', message: 'Carport' },
  'Garden shed': /* i18n */ { id: 'editor.roomName.gardenShed', message: 'Garden shed' },
  Mezzanine: /* i18n */ { id: 'editor.roomName.mezzanine', message: 'Mezzanine' },
  Loft: /* i18n */ { id: 'editor.roomName.loft', message: 'Loft' },
  'Reading nook': /* i18n */ { id: 'editor.roomName.readingNook', message: 'Reading nook' },
  Gallery: /* i18n */ { id: 'editor.roomName.gallery', message: 'Gallery' },
}

export function localizedRoomNameSections(
  sections: readonly RoomNameSection[],
  i18n: DescriptorTranslator,
): RoomNameSection[] {
  return sections.map((section) => {
    const title = Object.hasOwn(ROOM_NAME_SECTION_TITLES, section.id)
      ? ROOM_NAME_SECTION_TITLES[section.id]
      : undefined
    return {
      ...section,
      title: title ? i18n._(title) : section.title,
      labels: section.names.map((name) => displayRoomName(name, i18n)),
    }
  })
}

/**
 * A room name in the UI language. Catalog names stay English in the scene
 * (numbering, MCP and exports read them); a catalog name with the number the
 * picker adds shows translated with that number ("Bedroom 2" → "Chambre 2").
 * Anything else the user typed shows as written.
 */
export function displayRoomName(name: string, i18n: DescriptorTranslator): string {
  const { lead, base, number, trail } = roomNameParts(name)
  const label = catalogLabel(base, i18n)
  return label === undefined ? name : `${lead}${label}${number}${trail}`
}

/**
 * What an edit of a room's name field stores. The field shows the room's own
 * catalog name translated ("Lounge 2" as "Salon 2"); when the edit only
 * changes, adds or removes that name's number ("Salon 3"), it stores the
 * English name with the new number ("Lounge 3"), as editing it in English
 * would. Any other text, an exact translation of a different name included, is
 * stored exactly as typed.
 */
export function editedRoomName(stored: string, text: string, i18n: DescriptorTranslator): string {
  const own = roomNameParts(stored).base
  const label = catalogLabel(own, i18n)
  const edited = roomNameParts(text)
  if (label === undefined || edited.base !== label) return text
  return `${edited.lead}${own}${edited.number}${edited.trail}`
}

function roomNameParts(name: string) {
  const match = /^(\s*)(.*?)(\s+\d+)?(\s*)$/.exec(name)
  return {
    lead: match?.[1] ?? '',
    base: match?.[2] ?? '',
    number: match?.[3] ?? '',
    trail: match?.[4] ?? '',
  }
}

function catalogLabel(english: string, i18n: DescriptorTranslator): string | undefined {
  // Own keys only: a room named "constructor" or "__proto__" is free text.
  if (!(english && Object.hasOwn(ROOM_NAME_MESSAGES, english))) return undefined
  return i18n._(ROOM_NAME_MESSAGES[english]!)
}
