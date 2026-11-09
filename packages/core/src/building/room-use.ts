/**
 * What a room is for, read from its name: zones carry no use, so the name says (as
 * `room-habitable.ts` does for windows). The patterns are the scene program's
 * (`inferRoomType`, apps/community scene-program/library.ts, English only, first match wins) with the
 * French the houses are named in, and `laundry`, which the program folds into `other`. The uses are
 * the design brief's (`ROOM_USES`), so a room the brief announces and a room the scene holds are
 * compared in one vocabulary.
 */

import type { ZoneNode } from '../schema'

/** What a room is for, in the words the scene's own room types use, with laundry besides. */
export const ROOM_USES = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'dining',
  'office',
  'hallway',
  'laundry',
  'garage',
  'other',
] as const

export type RoomUse = (typeof ROOM_USES)[number]

/**
 * A name as one comparison sees it: lower case, accents stripped, curly apostrophes straight,
 * spaces collapsed ("Salle d’eau" and "salle d'eau" are one name).
 */
export function foldRoomName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** A name that opens with a circulation word is a hallway whatever follows: "Hall des chambres". */
const CIRCULATION_FIRST =
  /^(hall|halle|couloir|palier|vestibule|galerie|entree|corridor|landing|foyer|passage|degagement)\b/

/**
 * A name that ends in a circulation noun (and perhaps a number) is a hallway whatever its first word
 * says: "Study lobby", "Lower gallery", "Kitchen hall 2". One that ends in a closet is storage.
 */
const CIRCULATION_LAST =
  /\b(hall|hallway|entry|entrance|landing|corridor|foyer|vestibule|lobby|gallery|galerie|couloir|palier|entree|degagement)(?: \d+)?$/
const STORAGE_LAST = /\b(closet|dressing room|walk[- ]?in(?: closet)?)$/

/**
 * A bed word as a word of its own: "Bed 1", "Bedroom 2", "Chambre". A name with one and a word for what stands beside a bedroom
 * without being one (the way into it, its robe, its ensuite) is that other thing: "Bed 1 Entry" is the way into a bedroom, "Bed 3 WIR"
 * its walk-in robe. Without this the bedroom pattern, which comes before the others, takes them.
 */
const BED_WORD = /\b(?:beds?|bedrooms?|chambres?)(?![a-z])/g
const BED_ANNEX =
  /\b(?:entry|entrance|entree|hall|hallway|passage|corridor|couloir|degagement|vestibule|landing|palier|robes?|wardrobe|walk[- ]?in|wir|ensuite|en-suite)\b/

/**
 * In order, the first match wins: "family bathroom" is a bathroom, not a living room; "dressing of
 * the suite" is storage, not a bedroom. A bare "office" is an office, as the scene program has always
 * read it, though in a French house it is the pantry beside the kitchen: an office is owed no
 * window and asked for no tile, so the pantry is not wrongly held to either. A cellier is storage.
 */
const PATTERNS: readonly (readonly [RegExp, RoomUse])[] = [
  [
    /bath|shower|\bwc\b|toilet|ensuite|en-suite|powder|\bbains?\b|\bsdb\b|salle d'eau|douche|sanitaire|lavabo|lavatory|washroom|restroom/,
    'bathroom',
  ],
  [/laundry|buanderie|lingerie|utility|laverie/, 'laundry'],
  [/dressing|walk-?in|closet|wardrobe|storage|rangement|placard|cellier|mud ?room/, 'other'],
  [/bed(?!side)|nursery|chambre|\bsuite\b|dortoir|dormitory/, 'bedroom'],
  [/kitchen|pantry|cuisine|garde-manger/, 'kitchen'],
  [/dining|salle a manger/, 'dining'],
  [/living|lounge|family|sitting|salon|sejour|piece de vie|great room/, 'living'],
  [
    /hall|entry|entrance|landing|corridor|foyer|vestibule|lobby|gallery|stair|entree|palier|couloir|escalier|galerie|degagement|passage/,
    'hallway',
  ],
  [/office|study|\bden\b|library|workspace|bureau|bibliotheque/, 'office'],
  [/garage|carport|parking/, 'garage'],
]

/** The use a room's name gives it; `other` when the name says none. */
export function roomUseOfName(name: string): RoomUse {
  const folded = foldRoomName(name)
  if (CIRCULATION_FIRST.test(folded) || CIRCULATION_LAST.test(folded)) return 'hallway'
  if (STORAGE_LAST.test(folded)) return 'other'
  if (BED_ANNEX.test(folded) && folded.match(BED_WORD)) {
    const beside = roomUseOfName(
      folded
        .replace(BED_WORD, ' ')
        .replace(/\b\d+\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    if (beside !== 'bedroom') return beside
  }
  for (const [pattern, use] of PATTERNS) if (pattern.test(folded)) return use
  return 'other'
}

const OUTDOOR_USE =
  /\b(outdoor|outside|exterior|terrace|balcony|patio|porch|courtyard|garden|open air|alfresco|veranda|verandah|deck|pergola|carport|void|shaft|crawl ?space|non ?habitable|uninhabitable|unoccupied)\b/i

/** A room that is not indoors: open on a side, or named or declared for an outdoor or unoccupied space (porch, alfresco, balcony, void). */
export const isOutdoorRoom = (zone: Pick<ZoneNode, 'name' | 'occupancy' | 'enclosureStatus'>) =>
  zone.enclosureStatus === 'open' ||
  OUTDOOR_USE.test(`${zone.occupancy ?? ''} ${zone.name ?? ''}`.replace(/[-_]/g, ' '))

/** Rooms that are wet: tiled floors or walls are expected of them. */
export const isWetRoomUse = (use: RoomUse) => use === 'bathroom' || use === 'laundry'

/** Rooms whose walls meet a finished floor in view: the ones skirting is expected in. */
export const isSkirtedRoomUse = (use: RoomUse) =>
  use === 'bedroom' || use === 'living' || use === 'dining' || use === 'office' || use === 'hallway'
