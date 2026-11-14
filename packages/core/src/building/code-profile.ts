/**
 * The thresholds a building code sets, one table, every row with its unit, its citation and whether the
 * text behind it was read. A check that applies a code reads its numbers here, never from a literal.
 *
 * Which code applies is the project's to say: `site.metadata.codeProfile`. A scene that does not say has
 * no jurisdiction, and a code-specific check then reports information that names the code it used, never
 * a warning (the listing houses are Australian designs; the US IRC is not what they were drawn to). These are usage indicators, not a compliance check.
 */

export const CODE_PROFILE_IDS = ['irc-2021'] as const
export type CodeProfileId = (typeof CODE_PROFILE_IDS)[number]

/** The text the number was read in (a state's adoption of the model code, or UpCodes), or only a guide, a forum or another checker's constant. */
export type ThresholdSource = 'code text' | 'secondary source'

/**
 * When a row applies, for a rule that is not for every case. A row without it applies wherever the check that
 * reads it looks; a check that reads a row with it evaluates it. `every-exterior-door` is a landing at each
 * exterior door; `{ dropOverM, risersOver }` is a doorway whose sill opens onto a stairway or ramp with a
 * change in level of more than that many metres or risers (either is enough: the text reads "greater than
 * 3 risers or 570 mm").
 */
export type Applicability = 'every-exterior-door' | { dropOverM: number; risersOver: number }

export type Threshold = {
  value: number
  unit: 'm' | 'm2' | 'ratio'
  /** The section as a finding names it. */
  section: string
  /** The section and, where it matters, the edition and where it was read. */
  cite: string
  appliesWhen?: Applicability
  source: ThresholdSource
}

const inches = (n: number) => n * 0.0254
const feet = (n: number) => n * 0.3048

const R311_READ = 'read in the Minnesota (2020) and Colorado (2021) residential codes'

/** The US International Residential Code, 2021. */
export const IRC_2021 = {
  stairWidth: {
    value: inches(36),
    unit: 'm',
    section: 'IRC R311.7.1',
    cite: `IRC R311.7.1, stairway clear width above the handrail (${R311_READ})`,
    source: 'code text',
  },
  handrailProjection: {
    value: inches(4.5),
    unit: 'm',
    section: 'IRC R311.7.1',
    cite: `IRC R311.7.1, a handrail projects at most this far into the stairway (${R311_READ})`,
    source: 'code text',
  },
  stairHeadroom: {
    value: inches(80),
    unit: 'm',
    section: 'IRC R311.7.2',
    cite: `IRC R311.7.2, 6 ft 8 in from the line of the nosings (${R311_READ})`,
    source: 'code text',
  },
  stairLanding: {
    value: inches(36),
    unit: 'm',
    section: 'IRC R311.7.6',
    cite: 'IRC R311.7.6, landing depth in the direction of travel on a straight run (read in the Colorado 2021 residential code)',
    source: 'code text',
  },
  riserMax: {
    value: inches(7.75),
    unit: 'm',
    section: 'IRC R311.7.5.1',
    cite: 'IRC R311.7.5.1 riser height, as the Architect checker holds it; the section text was not read',
    source: 'secondary source',
  },
  treadMin: {
    value: inches(10),
    unit: 'm',
    section: 'IRC R311.7.5.2',
    cite: 'IRC R311.7.5.2 tread depth, as the Architect checker holds it; the section text was not read',
    source: 'secondary source',
  },
  hallWidth: {
    value: inches(36),
    unit: 'm',
    section: 'IRC R311.6',
    cite: 'IRC R311.6 hallway width, as the Architect checker holds it; the section text was not read',
    source: 'secondary source',
  },
  hallComfortable: {
    value: inches(42),
    unit: 'm',
    section: 'IRC R311.6',
    cite: 'a comfortable hallway, as the Architect checker holds it (not a code row)',
    source: 'secondary source',
  },
  exteriorDoorLanding: {
    value: inches(36),
    unit: 'm',
    section: 'IRC R311.3',
    cite: 'IRC R311.3, landing depth at an exterior door, as wide as the door (read in the Colorado 2021 residential code)',
    appliesWhen: 'every-exterior-door',
    source: 'code text',
  },
  doorThresholdDrop: {
    value: inches(1.5),
    unit: 'm',
    section: 'IRC R311.7.6 / R311.3',
    cite: 'IRC R311.7.6 (no top landing for an interior flight only if no door swings over the stairs) and R311.3.1 / R311.3.2 (a landing or floor at an exterior door is at most 1-1/2 in below the threshold, or 7-3/4 in where the door does not swing over it); read in the Colorado 2021 residential code',
    source: 'code text',
  },
  habitableRoomArea: {
    value: feet(70) * 0.3048,
    unit: 'm2',
    section: 'IRC R304.1',
    cite: 'IRC R304.1, 70 sq ft (read in the Virginia 2021 residential code); kitchens are exempt',
    source: 'code text',
  },
  habitableRoomDimension: {
    value: feet(7),
    unit: 'm',
    section: 'IRC R304.2',
    cite: 'IRC R304.2, 7 ft in any horizontal dimension (read in the Virginia 2021 residential code); kitchens are exempt',
    source: 'code text',
  },
  ceilingHeight: {
    value: feet(7),
    unit: 'm',
    section: 'IRC R305.1',
    cite: 'IRC R305.1 (read in the Virginia 2021 residential code); a sloped ceiling needs half the floor at this height and none under 5 ft',
    source: 'code text',
  },
  egressArea: {
    value: 0.53,
    unit: 'm2',
    section: 'IRC R310.2.1',
    cite: 'IRC R310.2.1, net clear opening 5.7 sq ft, kept at the 0.53 m2 the Architect checker uses; sizes read in city and county guides summarising the 2021 numbering',
    source: 'secondary source',
  },
  egressSill: {
    value: inches(44),
    unit: 'm',
    section: 'IRC R310.2.2',
    cite: 'IRC R310.2.2 (2018 numbering, R310.2.3 in 2021), sill at most 44 in above the floor (read in the Texas 2018 residential code on UpCodes)',
    source: 'code text',
  },
  toiletSideClear: {
    value: inches(15),
    unit: 'm',
    section: 'IRC R307.1 / P2705.1',
    cite: 'IRC R307.1 / P2705.1 and Figure R307.1: 15 in from the centre to a side wall, partition or vanity. The section text sends to the figure and holds no number; the figure was not read: a 2009 P2705.1 quote and a 2021 training site',
    source: 'secondary source',
  },
  toiletFrontClear: {
    value: inches(21),
    unit: 'm',
    section: 'IRC R307.1 / P2705.1',
    cite: 'IRC R307.1 / P2705.1 and Figure R307.1: 21 in in front to any wall, fixture or door. The figure was not read: a 2009 P2705.1 quote and a 2021 training site',
    source: 'secondary source',
  },
  lavatorySideClear: {
    value: inches(15),
    unit: 'm',
    section: 'IRC R307.1 / P2705.1',
    cite: 'IRC R307.1 / P2705.1 and Figure R307.1, as for a water closet; the figure was not read',
    source: 'secondary source',
  },
  lavatoryFrontClear: {
    value: inches(21),
    unit: 'm',
    section: 'IRC R307.1 / P2705.1',
    cite: 'IRC R307.1 / P2705.1 and Figure R307.1, as for a water closet; the figure was not read',
    source: 'secondary source',
  },
  showerFrontClear: {
    value: inches(24),
    unit: 'm',
    section: 'IRC R307.1 / P2705.1',
    cite: "in front of the shower opening, from the team designer's list; not found in the IRC text or in a 2021 guide (a guide gives 24 in as the Uniform Plumbing Code figure for a water closet)",
    source: 'secondary source',
  },
} as const satisfies Record<string, Threshold>

/**
 * Numbers the usage checks borrow for what a person can do in a house: a clear passage, a door, a turning
 * space, the edge a cane finds. They are not a code row and apply to every project whatever its jurisdiction
 * (a usage indicator, not a compliance check); each says where the number comes from. The French figures were
 * checked against the arrêté du 24 décembre 2015 (Légifrance); the ADA figures are as the checks held them.
 */
export const USAGE_INDICATORS = {
  passage: {
    value: 0.9,
    unit: 'm',
    section: 'arrêté du 24 décembre 2015 art. 11 II, 36 in',
    cite: 'clear width of a path in a house: 0,90 m, the French arrêté du 24 décembre 2015 art. 11 II (consolidated text in force on 27 October 2026, Légifrance); 36 in is the IRC figure for a hall',
    source: 'code text',
  },
  doorClear: {
    value: 0.8,
    unit: 'm',
    section: 'arrêté du 24 décembre 2015 art. 11 II (0,77 m clear), 32 in',
    cite: 'clear width through an interior door: 32 in (the US figure, not read); the French arrêté du 24 décembre 2015 art. 11 II (consolidated text in force on 27 October 2026, Légifrance) asks 0,80 m nominal and 0,77 m clear, which is why a doorway is read at 0.80 m here and a pinch under it is told apart from a passage',
    source: 'secondary source',
  },
  turning: {
    value: 1.5,
    unit: 'm',
    section: 'arrêté du 24 décembre 2015 art. 13 and annexe 2; ADA 304.3',
    cite: "wheelchair turning space, 1.50 m: an espace de manœuvre avec possibilité de demi-tour, Ø 1,50 m (annexe 2), in a bedroom and a salle d'eau, arrêté du 24 décembre 2015 art. 13 (consolidated text in force on 27 October 2026, Légifrance); ADA 304.3 not read",
    source: 'code text',
  },
} as const satisfies Record<string, Threshold>

export type IrcThresholdId = keyof typeof IRC_2021
export type ThresholdId = IrcThresholdId

export type CodeProfile = {
  id: CodeProfileId
  label: string
  thresholds: Readonly<Partial<Record<ThresholdId, Threshold>>>
}

export const CODE_PROFILES: Readonly<Record<CodeProfileId, CodeProfile>> = {
  'irc-2021': { id: 'irc-2021', label: 'the US IRC 2021', thresholds: IRC_2021 },
}

/** Where a project says which code applies: `site.metadata.codeProfile`. */
export const CODE_PROFILE_KEY = 'codeProfile'

type SiteLike = { type: string; metadata?: unknown }

/**
 * The profile the project names, or null: a scene that does not say has no jurisdiction. Nothing is
 * guessed from an address, a state code (WA is a US and an Australian state) or the browser.
 */
export function codeProfileOf(nodes: Readonly<Record<string, SiteLike>>): CodeProfile | null {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'site') continue
    const named = (node.metadata as Record<string, unknown> | undefined)?.[CODE_PROFILE_KEY]
    if (typeof named === 'string' && (CODE_PROFILE_IDS as readonly string[]).includes(named))
      return CODE_PROFILES[named as CodeProfileId]
  }
  return null
}

/** What a profile holds for a threshold, or undefined: a rule the other codes' texts do not set has no row. */
export const thresholdOf = (profile: CodeProfile, id: ThresholdId): Threshold | undefined =>
  profile.thresholds[id]

/** The IRC value of a threshold, for a checker that is a US checker by design (a host's own design checker). */
export const ircValue = (id: IrcThresholdId): number => IRC_2021[id].value
