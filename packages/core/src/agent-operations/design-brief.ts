import {
  AXIS_DESIGN_MIN_WORDS,
  BEYOND_LAYERS,
  BEYOND_MIN_LAYERS,
  BRIEF_AXES,
  type BriefAxes,
  CATALOG_PLACEMENT_TOOLS,
  type DesignBrief,
  type DesignBriefInput,
  FURNISHING_CREATION_TOOLS,
  layerPieces,
  MASSING_FIELDS,
} from '../agent-tools/design-brief'
import { AgentRefusal, refuse } from '../agent-tools/refusal'
import type { AssetInput } from '../schema'
import type { SessionRecord } from './scene-checkpoint'
import type { AgentContext, AgentOperation } from './types'

/**
 * Furnishing follows the turn's design brief. A host that gates keeps the brief in force
 * (`AgentContext.designBrief`, null while there is none) and each furnishing tool asks
 * `requireFurnishing` before it runs, inside `run_batch` too. A host that does not gate leaves the
 * context's brief out and nothing is refused (Pro, a person's own tools).
 */

export const NO_BRIEF =
  "Furnishing follows the turn's design brief: design_brief records what the request fixes, what it leaves open and where objects come from; until then the catalog can be searched and viewed, not placed, and no furnishing is made."

/**
 * Which tools make a piece and with what, as facts a refusal states: the field names are the
 * contracts' (a test reads them back). Kitchen cabinets are a run of modules, not one object.
 */
const MAKING_TOOLS =
  'add_object makes a piece (code, or piece for the object in words; parentId and position say where it goes); place_design places a designed piece (design, hostId, position).'

const openSource = (pieces: string) =>
  `The brief left the source open: ${pieces} cannot be placed from the catalog, pieces are made. Technical equipment (sanitaryware, appliances) and plants are placed from the catalog under an open source; every other catalog piece is made. ${MAKING_TOOLS} view_assets shows the catalog's pieces for reference.`

/** What a call answers when every piece it names was refused already: short, the same each time. */
const alreadyRefused = (pieces: string) =>
  `Already refused, the brief's source is open: ${pieces}. Technical equipment and plants are placed from the catalog; add_object and place_design make the other pieces.`

/** What `furnish_room` places: no piece is named, a stock set is. */
const FURNISH_ROOM_PIECES = "the pieces of furnish_room's stock set"

/** The session reading that holds the pieces refused under an open source (`SessionKeep.readings`). */
export const REFUSED_PIECES_KEY = 'brief.refusedPieces'
/** The reading keeps the most recent pieces up to here. */
const MAX_REFUSED_PIECES = 100

/** The pieces the session's catalog placements were refused for under an open source. */
function refusedPieces(session: Pick<SessionRecord, 'readings'> | undefined): string[] {
  const held = session?.readings?.[REFUSED_PIECES_KEY]
  return Array.isArray(held)
    ? held.filter((piece): piece is string => typeof piece === 'string')
    : []
}

const SOURCE_NOT_IN_REQUEST =
  "A source is set by the request: the brief's sourceQuote must be the person's own words naming it, a brand, the catalog or what is already there; this request names none, so its source is open."

/** Case, accents and spaces folded away: how a quote is compared with the request and the lists. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2019\u2018]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The words that name the catalog as a source, English and French, folded; a word matches from its
 * start. Phrases, not single words, where a single word also names a room or a building ("a house
 * with a library", "the existing house").
 */
const CATALOG_WORDS = [
  'catalog',
  'pascal library',
  "pascal's library",
  'bibliotheque pascal',
  "pascal's items",
  "pascal's objects",
  'pascal items',
  'pascal objects',
  'from the stock',
  'in stock',
  'du stock',
  'en stock',
]

/** The words that name what is already there as a source, English and French, folded. */
const EXISTING_WORDS = [
  'existing furniture',
  'existing pieces',
  'existing items',
  'my furniture',
  'my own furniture',
  'current furniture',
  'what is already there',
  "what's already there",
  'mes meubles',
  'meubles existants',
  'meubles actuels',
  "ce qu'il y a",
]

const wordsRegex = (words: string[]) =>
  new RegExp(`\\b(?:${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
const CATALOG_WORD = wordsRegex(CATALOG_WORDS)
const EXISTING_WORD = wordsRegex(EXISTING_WORDS)

/** Whether the quote, at least two words, names the brief's source: its brand, the catalog, what is already there. */
function quoteNamesSource(source: string, brand: string | undefined, quote: string): boolean {
  const folded = fold(quote)
  if (folded.split(' ').length < 2) return false
  if (source === 'brand') return Boolean(brand) && folded.includes(fold(brand!))
  return (source === 'catalog' ? CATALOG_WORD : EXISTING_WORD).test(folded)
}

/** The building's form and facade are the brief's own record: nothing reads them back yet, so a brief may leave them out. */
const OPTIONAL_AXES: readonly string[] = ['form', 'facade']

/**
 * Every axis but form and facade is stated, bounded or open. A bounded axis quotes the person's own words: where
 * the host lends the message (the chat, `requestText`) the quote is in it, folded as the
 * source quote is; over MCP there is no message, so the quote is required by the contract and
 * not compared with anything. An open axis carries a design statement of at least
 * AXIS_DESIGN_MIN_WORDS words. The source axis is the `source` fields, checked separately.
 */
function requireAxes(input: DesignBriefInput, context: AgentContext): BriefAxes {
  const axes = input.axes ?? {}
  const missing = BRIEF_AXES.filter((axis) => !(axes[axis] || OPTIONAL_AXES.includes(axis)))
  if (missing.length)
    refuse(
      'axis_missing',
      `The brief reads the request axis by axis: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} absent. Each axis is bounded by the person's words or open with a design statement; an axis the request does not touch is open.`,
      { axes: missing },
    )
  for (const axis of BRIEF_AXES) {
    const reading = axes[axis]
    if (!reading) continue
    if (reading.kind === 'bounded') {
      const quote = fold(reading.quote)
      if (
        !quote ||
        (context.requestText !== undefined && !fold(context.requestText).includes(quote))
      )
        refuse(
          'axis_quote_not_in_request',
          `The ${axis} is bounded by the request's own words: its quote must be words of the person's message.`,
          { axis },
        )
    } else if (fold(reading.design).split(' ').filter(Boolean).length < AXIS_DESIGN_MIN_WORDS)
      refuse('axis_open_without_design', `The ${axis} is open: say how it is designed.`, { axis })
  }
  if (axes.form) requireMassing(axes.form)
  if (axes.facade) requireTreatment(axes.facade)
  return axes
}

/** An open facade states what it is clad in or carries, and the rhythm of its openings. */
function requireTreatment(facade: NonNullable<BriefAxes['facade']>): void {
  if (facade.kind !== 'open') return
  const treatment = facade.treatment ?? {}
  const absent = [
    ...(treatment.cladding?.length || treatment.elements?.length ? [] : ['cladding or elements']),
    ...(treatment.rhythm ? [] : ['rhythm']),
  ]
  if (absent.length)
    refuse(
      'facade_treatment_missing',
      `The facade is open: its treatment states what it is clad in or carries (cladding, bands, elements) and whether its openings follow a regular rhythm or a free one. Absent: ${absent.join(', ')}.`,
      { fields: absent },
    )
}

/**
 * An open form states its massing in full, and a form of one volume is neither detached nor at
 * several heights.
 */
function requireMassing(form: NonNullable<BriefAxes['form']>): void {
  const massing = form.massing ?? {}
  if (form.kind === 'open') {
    const absent = MASSING_FIELDS.filter((field) => massing[field] === undefined)
    if (absent.length)
      refuse(
        'form_massing_missing',
        `The form is open: its massing states the plan, the number of volumes and whether they stand at one height or several; ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} absent.`,
        { fields: absent },
      )
  }
  if (massing.volumes === 1 && (massing.plan === 'detached' || massing.heights === 'several'))
    refuse(
      'form_massing_inconsistent',
      `A form of one volume cannot be ${massing.plan === 'detached' ? 'detached' : 'at several heights'}: state the number of volumes that stand apart or at different heights.`,
      { volumes: 1 },
    )
}

/** The pieces `beyond` names, flattened: the brief's own list of the dressing. */
export function dressingOf(beyond: DesignBriefInput['beyond']): string[] {
  return BEYOND_LAYERS.flatMap(([key]) => layerPieces(beyond[key]))
}

/**
 * The dressing axis alone decides what `beyond` owes. Bounded, `beyond` may say none
 * everywhere, except that the named pieces read as a minimum do not bound it: a dressing
 * quote inside a minimum pieces quote is refused. Open, at least BEYOND_MIN_LAYERS of the
 * layers name pieces.
 */
function requireDressing(input: DesignBriefInput, axes: BriefAxes): void {
  const dressing = axes.dressing!
  if (dressing.kind === 'bounded') {
    const pieces = axes.pieces!
    if (
      pieces.kind === 'bounded' &&
      (pieces.extent ?? 'minimum') === 'minimum' &&
      fold(dressing.quote) &&
      fold(pieces.quote).includes(fold(dressing.quote))
    )
      refuse(
        'dressing_bounded_by_minimum',
        'The pieces the request names are a minimum: they do not bound the dressing. The dressing is bounded only by words that limit the pieces or the action.',
      )
    return
  }
  const empty = BEYOND_LAYERS.filter(([key]) => layerPieces(input.beyond[key]).length === 0)
  if (BEYOND_LAYERS.length - empty.length >= BEYOND_MIN_LAYERS) return
  refuse(
    'beyond_too_thin',
    `The request leaves the dressing open: beyond names pieces for at least ${BEYOND_MIN_LAYERS} of its ${BEYOND_LAYERS.length} layers (${BEYOND_LAYERS.map(([, label]) => label).join(', ')}); ${empty.map(([, label]) => label).join(', ')} say none.`,
    { layers: empty.map(([key]) => key) },
  )
}

/**
 * The rooms of a building the brief designs: an open form owes one entry per room, each with its
 * own distinct line, and rooms of one use are not copies of one another.
 */
function requireRooms(input: DesignBriefInput, axes: BriefAxes): void {
  const rooms = input.rooms ?? []
  if (!rooms.length && axes.form?.kind === 'open')
    refuse(
      'rooms_missing',
      'The form is open, so the request builds a building: rooms lists each room it builds, with its use, what sets it apart, its finishes and its main pieces.',
    )
  for (const room of rooms)
    if (!fold(room.distinct ?? ''))
      refuse(
        'room_distinct_missing',
        `The room "${room.name}" says nothing of what sets it apart: distinct is one line on who it is for and its character, against the other rooms of its use.`,
        { room: room.name },
      )
  rooms.forEach((room, index) => {
    for (const other of rooms.slice(index + 1))
      if (
        room.use === other.use &&
        fold(room.distinct ?? '') === fold(other.distinct ?? '') &&
        pieceKey(room.pieces) === pieceKey(other.pieces)
      )
        refuse(
          'rooms_identical',
          `The rooms "${room.name}" and "${other.name}" are of one use and state the same distinct line and the same pieces: rooms of one use are distinct rooms, each with its own.`,
          { rooms: [room.name, other.name], use: room.use },
        )
  })
}

/** A room's pieces as a comparison reads them: folded, in no order. */
const pieceKey = (pieces: string[]) => pieces.map(fold).sort().join('|')

const isCatalogPlacement = (tool: string) =>
  (CATALOG_PLACEMENT_TOOLS as readonly string[]).includes(tool)
const isCreation = (tool: string) => (FURNISHING_CREATION_TOOLS as readonly string[]).includes(tool)

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/**
 * The function tags of the catalog's technical equipment: sanitaryware, kitchen, laundry and climate
 * appliances, fixed services. A hosted item's `category` is its primary function tag; the built-in
 * list carries function tags too. An item whose tags are not all technical is furniture here.
 */
const TECHNICAL_FUNCTIONS: ReadonlySet<string> = new Set([
  'plumbing',
  'sinks',
  'toilets',
  'showers',
  'bathtubs',
  'appliances',
  'appliance',
  'kitchen-appliances',
  'laundry-appliances',
  'climate-appliances',
  'utilities',
])

export function isTechnicalEquipment(item: Pick<AssetInput, 'category' | 'functionTags'>): boolean {
  const tags = item.functionTags?.length ? item.functionTags : [item.category]
  return tags.every((tag) => TECHNICAL_FUNCTIONS.has(tag))
}

/**
 * The catalog's vegetation, as its function leaves (`plants`, `indoor-plants`, `trees`) and item
 * tags (`tree`, `plant`, `garden`) write it. A tag counts by its hyphen-separated words, so
 * `indoor-plants` is plants and `planter` is not.
 */
const VEGETATION_WORDS: ReadonlySet<string> = new Set([
  'plant',
  'plants',
  'tree',
  'trees',
  'palm',
  'palms',
  'bush',
  'bushes',
  'shrub',
  'shrubs',
  'hedge',
  'hedges',
  'grass',
  'flower',
  'flowers',
  'fern',
  'ferns',
  'cactus',
  'cacti',
  'vegetation',
  'foliage',
])

export function isVegetation(
  item: Pick<AssetInput, 'category' | 'functionTags' | 'tags'>,
): boolean {
  const tags = [item.category, ...(item.functionTags ?? []), ...(item.tags ?? [])]
  return tags.some((tag) => tag.split('-').some((word) => VEGETATION_WORDS.has(word)))
}

/** Whether the catalog files a piece as one an open source places: technical equipment or a plant. */
function placeableFromCatalog(id: string, catalog: readonly AssetInput[] | undefined): boolean {
  const item = catalog?.find((candidate) => candidate.id === id)
  return item ? isTechnicalEquipment(item) || isVegetation(item) : false
}

/** The catalog ids a placement call names. */
export function placedAssets(tool: string, input: unknown): string[] {
  const args = asRecord(input)
  const named =
    tool === 'place_items' || tool === 'place_by_relation'
      ? (Array.isArray(args.items) ? args.items : []).map((item) => asRecord(item).assetId)
      : [args.assetId]
  return [...new Set(named.filter((id): id is string => typeof id === 'string'))]
}

/** What the gate reads beyond the brief: the session's refusals, and the catalog's tags. */
type BriefGateContext = Pick<AgentContext, 'session' | 'catalog'>

/**
 * Why a furnishing call may not run under this brief, or null. `brief` null is no brief yet. An
 * `add_object` that names a `nodeId` edits an object that stands: it places and makes nothing.
 * A batch checks each call in its operation, under the same policy as runtime refusals.
 */
export function furnishingRefusal(
  tool: string,
  input: unknown,
  brief: DesignBrief | null,
  context: BriefGateContext = {},
): AgentRefusal | null {
  const args = asRecord(input)
  if (tool === 'place_by_relation') {
    const pieces = placedAssets(tool, args)
    if (!pieces.length) return null
    return furnishingRefusal(
      'place_items',
      { items: pieces.map((assetId) => ({ assetId })) },
      brief,
      context,
    )
  }
  if (!(isCatalogPlacement(tool) || isCreation(tool))) return null
  if (tool === 'add_object' && typeof args.nodeId === 'string') return null
  if (!brief) return new AgentRefusal('design_brief_required', NO_BRIEF, { tool })
  if (brief.source !== 'open' || isCreation(tool)) return null
  const pieces = tool === 'furnish_room' ? [FURNISH_ROOM_PIECES] : placedAssets(tool, args)
  const refused = pieces.filter((piece) => !placeableFromCatalog(piece, context.catalog))
  return refused.length ? openSourceRefusal(tool, refused, context.session) : null
}

/**
 * The refusal of a catalog placement under an open source. A piece refused before in the session
 * is named briefly; the pieces not refused yet get the facts, and the refusal asks the host to
 * remember them (`REFUSED_PIECES_KEY`), so a retry, by any placing tool, is short.
 */
function openSourceRefusal(
  tool: string,
  pieces: string[],
  session: Pick<SessionRecord, 'readings'> | undefined,
): AgentRefusal {
  const held = refusedPieces(session)
  const fresh = pieces.filter((piece) => !held.includes(piece))
  const repeated = pieces.filter((piece) => held.includes(piece))
  const message = fresh.length
    ? openSource(fresh.join(', ')) +
      (repeated.length ? ` Already refused: ${repeated.join(', ')}.` : '')
    : alreadyRefused(repeated.join(', '))
  const keep = fresh.length
    ? { readings: { [REFUSED_PIECES_KEY]: [...held, ...fresh].slice(-MAX_REFUSED_PIECES) } }
    : undefined
  return new AgentRefusal('brief_source_open', message, { tool, source: 'open', pieces }, keep)
}

/** Throws the refusal when the host gates and the call may not run; a host with no brief to keep passes. */
export function requireFurnishing(
  tool: string,
  input: unknown,
  brief: DesignBrief | null | undefined,
  context: BriefGateContext = {},
): void {
  if (brief === undefined) return
  const refusal = furnishingRefusal(tool, input, brief, context)
  if (refusal) throw refusal
}

/** The operation of a furnishing tool, refusing as `requireFurnishing` says before it runs. */
export function gatedByBrief<Input>(
  tool: string,
  operation: AgentOperation<Input>,
): AgentOperation<Input> {
  return (nodes, input, context) => {
    requireFurnishing(tool, input, context.designBrief, context)
    return operation(nodes, input, context)
  }
}

/** What a brief opens and leaves closed, as facts. */
export function briefUnlocks(brief: DesignBrief): { unlocks: string[]; closed: string[] } {
  if (brief.source !== 'open')
    return {
      unlocks: [
        `${CATALOG_PLACEMENT_TOOLS.join(', ')} place the catalog's pieces.`,
        `${FURNISHING_CREATION_TOOLS.join(', ')} stay open for what the catalog lacks.`,
      ],
      closed: [],
    }
  return {
    unlocks: [
      `${FURNISHING_CREATION_TOOLS.join(', ')} make the pieces.`,
      'place_items and place_in_room place technical equipment and plants from the catalog.',
    ],
    closed: [
      'furnish_room places a whole stock set.',
      'Every other catalog piece is made; view_assets shows the catalog for reference.',
    ],
  }
}

/**
 * `design_brief`: the request read as a brief, recorded as the turn's design record. The operation
 * echoes it with what it opens and hands it back for the host to keep with the session; nothing in
 * the scene changes.
 */
export const designBrief: AgentOperation<DesignBriefInput> = (_nodes, input, context) => {
  const axes = requireAxes(input, context)
  const brand = input.brand?.trim()
  if (input.source === 'brand' && !brand)
    refuse('brand_required', 'source brand names a range: give its name as brand ("IKEA").')
  const quote = input.sourceQuote?.trim()
  if (input.source !== 'open') {
    if (!quote)
      refuse(
        'source_quote_required',
        `source ${input.source} is set by the request: give sourceQuote, the person's own words that name it ("IKEA furniture only"); a request that names no source is open.`,
      )
    if (!quoteNamesSource(input.source, brand, quote))
      refuse('source_not_named', SOURCE_NOT_IN_REQUEST)
    if (context.requestText !== undefined && !fold(context.requestText).includes(fold(quote)))
      refuse('source_not_in_request', SOURCE_NOT_IN_REQUEST)
  }
  requireDressing(input, axes)
  requireRooms(input, axes)
  const brief: DesignBrief = {
    axes,
    source: input.source,
    ...(input.source !== 'open' && quote ? { sourceQuote: quote } : {}),
    ...(input.source === 'brand' && brand ? { brand } : {}),
    vision: input.vision,
    beyond: input.beyond,
    ...(input.rooms?.length ? { rooms: input.rooms } : {}),
  }
  return {
    result: {
      status: 'recorded',
      brief,
      dressing: dressingOf(input.beyond),
      ...briefUnlocks(brief),
    },
    keep: { designBrief: brief },
  }
}
