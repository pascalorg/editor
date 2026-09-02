import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * Utility systems carried by a `utility-line`.
 *
 * COLOURS — APWA Uniform Color Code (American Public Works Association,
 * the ANSI Z535.1 safety-colour palette adopted by the Common Ground
 * Alliance for underground facility locate marks):
 *
 *   RED     — electric power lines, cables, conduit, lighting cables
 *   YELLOW  — gas, oil, steam, petroleum, gaseous materials
 *   ORANGE  — communication, alarm/signal lines, cables, conduit
 *   BLUE    — potable water
 *   GREEN   — sewers and DRAIN lines
 *   PURPLE  — reclaimed water, irrigation, slurry lines
 *   PINK    — temporary survey markings
 *   WHITE   — proposed excavation
 *
 * DEFECT / DEVIATION, stated rather than papered over: APWA puts STORM
 * drains under GREEN together with sanitary sewers — there is no brown in
 * the APWA code at all. This workstream was specified with sewer green and
 * storm brown, so `storm` below is a HOUSE convention (brown) that is NOT
 * APWA-conformant. Anything printed for a locate request should re-map
 * storm to green. Purple/pink/white have no kind here yet.
 */
export const UTILITY_SYSTEMS = ['power', 'sewer', 'water', 'gas', 'comm', 'storm'] as const
export const UtilitySystem = z.enum(UTILITY_SYSTEMS)
export type UtilitySystem = z.infer<typeof UtilitySystem>

export const UTILITY_ROUTINGS = ['overhead', 'underground'] as const
export const UtilityRouting = z.enum(UTILITY_ROUTINGS)
export type UtilityRouting = z.infer<typeof UtilityRouting>

/** Ink per system. See the APWA note above (`storm` is the house deviation). */
export const SYSTEM_COLOR: Record<UtilitySystem, string> = {
  power: '#d21f26', // APWA red
  sewer: '#1f9d4d', // APWA green
  water: '#1668c2', // APWA blue
  gas: '#f2b705', // APWA yellow
  comm: '#f07d18', // APWA orange
  storm: '#7a4b1e', // house brown — APWA would be green
}

/**
 * Single-letter plan tag repeated along an underground run — the standard
 * civil-plan shorthand. E electric, S sanitary sewer, W water, G gas,
 * T telecommunications, D storm drain.
 */
export const SYSTEM_LETTER: Record<UtilitySystem, string> = {
  power: 'E',
  sewer: 'S',
  water: 'W',
  gas: 'G',
  comm: 'T',
  storm: 'D',
}

export const SYSTEM_LABEL: Record<UtilitySystem, string> = {
  power: 'Power',
  sewer: 'Sewer',
  water: 'Water',
  gas: 'Gas',
  comm: 'Comm',
  storm: 'Storm',
}

/**
 * Materials offered per system. These are the common trade materials, not a
 * code list — no minimum-material requirement is asserted here.
 *   sewer  — PVC (ASTM D3034), ABS, legacy cast iron
 *   water  — copper (ASTM B88), PEX, PVC
 *   power  — copper or aluminium conductor
 * gas / comm / storm are left free-text until a cited source exists.
 */
export const SYSTEM_MATERIALS: Record<UtilitySystem, readonly string[]> = {
  power: ['copper', 'aluminum'],
  sewer: ['pvc', 'abs', 'cast-iron'],
  water: ['copper', 'pex', 'pvc'],
  gas: ['steel', 'polyethylene'],
  comm: ['fiber', 'copper'],
  storm: ['hdpe', 'pvc', 'concrete'],
}

/**
 * Display sag as a fraction of the span, for OVERHEAD spans only.
 *
 * NOT an engineered sag: real conductor sag comes from tension, weight per
 * unit length, span and temperature (the catenary `y = a·cosh(x/a)`), and
 * NESC C2 governs the resulting ground clearance. 1.5% is a drawing
 * default that reads correctly at domestic service spans; it is marked
 * unverified against any code and must not be used for clearance checks.
 */
export const DEFAULT_SAG_RATIO = 0.015

/**
 * Default burial depth (metres, NEGATIVE — depths are stored as the vertex
 * elevation, so cover is a negative y). 0.75 m ≈ 30 in.
 *
 * UNVERIFIED against a cited code in this repo: NEC 300.5 Table gives
 * minimum cover for electrical (e.g. 24 in direct-burial under most
 * conditions) and local water/sewer depths follow the frost line. Treat it
 * as a drawing default the user overrides per line.
 */
export const DEFAULT_BURIAL_DEPTH = -0.75

/** Standard distribution pole height, metres. 10.7 m = 35 ft. */
export const DEFAULT_POLE_HEIGHT = 10.668

export const UtilityLineNode = BaseNode.extend({
  id: objectId('utilln'),
  type: nodeType('utility-line'),
  system: UtilitySystem.default('power'),
  routing: UtilityRouting.default('underground'),
  /**
   * Run vertices in SITE metres `[x, y, z]` — x east, z south, y elevation.
   * Underground vertices carry a NEGATIVE y (the burial depth / cover);
   * overhead vertices carry the attachment height above grade.
   */
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).default([]),
  /** Nominal size in INCHES (conduit / pipe / conductor). Null = unstated. */
  sizeInches: z.number().positive().nullable().default(null),
  /** Trade material — see `SYSTEM_MATERIALS`. Null = unstated. */
  material: z.string().trim().max(32).nullable().default(null),
  label: z.string().trim().max(64).default(''),
  /** Node id the run starts at (a pole / service point), if snapped. */
  fromRef: z.string().nullable().default(null),
  /** Node id the run ends at (a pole / service point), if snapped. */
  toRef: z.string().nullable().default(null),
  /** Overhead display sag as a fraction of each span. See DEFAULT_SAG_RATIO. */
  sagRatio: z.number().min(0).max(0.2).default(DEFAULT_SAG_RATIO),
}).describe(
  `Site utility run. system: power | sewer | water | gas | comm | storm (APWA colours; storm is a house deviation, APWA puts storm under green).
  - routing: overhead (catenary-sagged cable) | underground (buried, dashed)
  - path: vertices in SITE metres [x, y, z]; x east, z south, y elevation. Underground vertices carry a NEGATIVE y = burial depth.
  - sizeInches / material: nominal size and trade material; null when unstated
  - fromRef / toRef: node ids of the pole or service point each end lands on
  - sagRatio: overhead display sag as a fraction of span (drawing default, not an engineered sag)`,
)
export type UtilityLineNode = z.infer<typeof UtilityLineNode>

export const GUY_DIRECTIONS = ['none', 'north', 'east', 'south', 'west'] as const
export const GuyDirection = z.enum(GUY_DIRECTIONS)
export type GuyDirection = z.infer<typeof GuyDirection>

/**
 * Legacy poles stored `position` as a PLAN pair `[x, z]`. The host move tool
 * writes an `[x, y, z]` triple (`move-registry-node-tool.tsx` commits
 * `position: [...lastCursorRef.current]` unconditionally), so the field is a
 * triple now and old pairs are WIDENED on parse rather than rejected — an
 * existing scene keeps its poles.
 */
const polePosition = z.preprocess(
  (value) => (Array.isArray(value) && value.length === 2 ? [value[0], 0, value[1]] : value),
  z.tuple([z.number(), z.number(), z.number()]),
)

export const UtilityPoleNode = BaseNode.extend({
  id: objectId('utilpl'),
  type: nodeType('utility-pole'),
  /**
   * Butt position in SITE metres `[x, y, z]` — x east, z south, y the butt
   * elevation (0 = at grade). A legacy `[x, z]` pair is accepted.
   */
  position: polePosition.default([0, 0, 0]),
  /**
   * Crossarm direction, radians about +Y. 0 lays the arm along the site x
   * axis. R / T step it by 45°, and `resolveLineEndpoints` attaches a span to
   * the insulator pin on whichever end of the arm faces the run.
   *
   * `yaw` is the ONLY rotation this kind has, deliberately. The host move
   * tool writes a `rotation` on every commit; an unknown key is merged into
   * the store and dropped by this schema on the next parse, so it can never
   * become a second, competing source of truth. The definition's
   * `keyboardActions` (R / T) and its rotate handle both write `yaw`.
   */
  yaw: z.number().default(0),
  /**
   * Above-grade height, metres. Default 10.668 m = 35 ft, the common
   * distribution-pole length; ANSI O5.1 (Wood Poles — Specifications and
   * Dimensions) sets pole lengths in 5 ft increments and the class/top
   * circumference table. 35 ft is a typical stock length, NOT a code
   * minimum, and this stores the height as erected, not the buried length.
   */
  height: z.number().positive().default(DEFAULT_POLE_HEIGHT),
  /** Free-text class label, e.g. 'Class 4'. ANSI O5.1 classes 1–10, H1–H6. */
  classLabel: z.string().trim().max(24).default(''),
  hasTransformer: z.boolean().default(false),
  /** Down-guy direction, or 'none'. */
  guy: GuyDirection.default('none'),
  label: z.string().trim().max(24).default(''),
}).describe(
  `Utility pole. position is [x, y, z] in SITE metres (the butt; y = 0 at grade, a legacy [x, z] pair is widened on parse); yaw is the crossarm direction in radians about +Y (R / T step it by 45°); height metres above grade (default 10.668 m / 35 ft, a common ANSI O5.1 stock length, not a code minimum); classLabel is free text; hasTransformer adds a pole-mounted transformer can; guy adds a down-guy in that compass direction.`,
)
export type UtilityPoleNode = z.infer<typeof UtilityPoleNode>

export const SERVICE_POINT_KINDS = [
  'electric-meter',
  'panel',
  'water-meter',
  'sewer-cleanout',
  'gas-meter',
  'water-entry',
  'sewer-exit',
  'power-entry',
  'telecom-nid',
] as const
export const ServicePointKind = z.enum(SERVICE_POINT_KINDS)
export type ServicePointKind = z.infer<typeof ServicePointKind>

export const SERVICE_POINT_LABEL: Record<ServicePointKind, string> = {
  'electric-meter': 'Electric meter',
  panel: 'Panel',
  'water-meter': 'Water meter',
  'sewer-cleanout': 'Sewer cleanout',
  'gas-meter': 'Gas meter',
  'water-entry': 'Water entry',
  'sewer-exit': 'Sewer exit',
  'power-entry': 'Power entry',
  'telecom-nid': 'Telecom NID',
}

/** Plan abbreviation drawn beside each service-point symbol. */
export const SERVICE_POINT_ABBR: Record<ServicePointKind, string> = {
  'electric-meter': 'EM',
  panel: 'EP',
  'water-meter': 'WM',
  'sewer-cleanout': 'CO',
  'gas-meter': 'GM',
  'water-entry': 'WE',
  'sewer-exit': 'SE',
  'power-entry': 'PE',
  'telecom-nid': 'NID',
}

/** Which system's APWA colour a service point is drawn in. */
export const SERVICE_POINT_SYSTEM: Record<ServicePointKind, UtilitySystem> = {
  'electric-meter': 'power',
  panel: 'power',
  'power-entry': 'power',
  'water-meter': 'water',
  'water-entry': 'water',
  'sewer-cleanout': 'sewer',
  'sewer-exit': 'sewer',
  'gas-meter': 'gas',
  'telecom-nid': 'comm',
}

/**
 * `service-point` — the interface between a utility run and the building.
 *
 * Anchoring mirrors `bones:service` (plugin-bones `src/service/schema.ts`):
 * wall-mounted points carry `wallId` + `wallT` (0..1 along the wall) +
 * `height` (above the wall's base), free-standing points carry `position`.
 * A resolving wall anchor WINS while `position` is still the default
 * sentinel `[0, 0, 0]`; a `position` written OFF that sentinel outranks the
 * anchor. That is bones' precedence, matched deliberately (this package used
 * to invert it).
 *
 * The reason is the move gesture. The host move tool previews a drag by
 * pushing `{ position }` into `useLiveNodeOverrides`
 * (`move-registry-node-tool.tsx:482`) and never touches `wallId` / `wallT`.
 * Under "the anchor always wins" the meter sat frozen on its wall for the
 * whole drag and only jumped at the end — so the drop it feeds could not
 * follow it either. With this rule the live position drives the preview, and
 * the move's `onCommit` re-anchors to the nearest wall and resets `position`
 * to the sentinel, leaving the anchor authoritative the instant the drag
 * ends.
 */
export const ServicePointNode = BaseNode.extend({
  id: objectId('utilsp'),
  type: nodeType('service-point'),
  serviceKind: ServicePointKind.default('electric-meter'),
  /** Free-standing spot in SITE metres `[x, y, z]`. */
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** Host wall node id when wall-mounted. */
  wallId: z.string().nullable().default(null),
  /** Normalised distance along the host wall from its `start` (0..1). */
  wallT: z.number().min(0).max(1).nullable().default(null),
  /** Mount height above the wall base, metres (device centre). */
  height: z.number().default(1.5),
  label: z.string().trim().max(48).default(''),
}).describe(
  `Building/utility interface point. serviceKind: electric-meter | panel | water-meter | sewer-cleanout | gas-meter | water-entry | sewer-exit | power-entry | telecom-nid.
  - wallId + wallT (0..1 along the wall) + height: wall-mounted anchor (wins while position is the default [0, 0, 0])
  - position: [x, y, z] SITE metres for free-standing points; written off [0, 0, 0] it outranks the wall anchor (that is what a live drag does, and the drag's commit re-anchors and resets it)`,
)
export type ServicePointNode = z.infer<typeof ServicePointNode>
