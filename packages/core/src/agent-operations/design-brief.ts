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
} from '../agent-tools/design-brief'
import { AgentRefusal, refuse } from '../agent-tools/refusal'
import type { AssetInput } from '../schema'
import type { AgentContext, AgentOperation } from './types'

/**
 * Furnishing follows the turn's design brief. A host that gates keeps the brief in force
 * (`AgentContext.designBrief`, null while there is none) and each furnishing tool asks
 * `requireFurnishing` before it runs, inside `run_batch` too. A host that does not gate leaves the
 * context's brief out and nothing is refused (Pro, a person's own tools).
 */

export const NO_BRIEF =
  "Furnishing follows the turn's design brief: design_brief records what the request fixes, what it leaves open and where objects come from; until then the catalog can be searched and viewed, not placed, and no furnishing is made."

const openSource = (piece: string) =>
  `The brief left the source open: ${piece} can be made with add_object or place_design (view_assets shows the catalog's for reference), or, for technical equipment, named in the brief's asIs after view_assets, with a reason.`

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

const furnitureFact = (name: string) =>
  `${name} is furniture: in an open brief furniture is made (add_object, place_design) or the request names a catalog source; asIs keeps technical equipment (sanitaryware, appliances).`

const notViewed = (ids: string[]) =>
  `${ids.join(', ')} ${ids.length === 1 ? 'was' : 'were'} not viewed: asIs keeps a catalog piece only after view_assets showed it earlier in the same turn (chat) or session (MCP).`

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

/**
 * Every axis is stated, bounded or open. A bounded axis quotes the person's own words: where
 * the host lends the message (the chat, `requestText`) the quote is in it, folded as the
 * source quote is; over MCP there is no message, so the quote is required by the contract and
 * not compared with anything. An open axis carries a design statement of at least
 * AXIS_DESIGN_MIN_WORDS words. The source axis is the `source` fields, checked separately.
 */
function requireAxes(input: DesignBriefInput, context: AgentContext): BriefAxes {
  const axes = input.axes ?? {}
  const missing = BRIEF_AXES.filter((axis) => !axes[axis])
  if (missing.length)
    refuse(
      'axis_missing',
      `The brief reads the request axis by axis: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} absent. Each axis is bounded by the person's words or open with a design statement; an axis the request does not touch is open.`,
      { axes: missing },
    )
  for (const axis of BRIEF_AXES) {
    const reading = axes[axis]!
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
  return axes
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

/** Whether `design_brief` reads the item library: an open brief naming pieces as they are. */
export function briefReadsCatalog(tool: string, input: unknown): boolean {
  const { source, asIs } = asRecord(input)
  return tool === 'design_brief' && source === 'open' && Array.isArray(asIs) && asIs.length > 0
}

/**
 * An open brief keeps a catalog piece as it is only if it is technical equipment and view_assets
 * showed it to the agent (the session's `viewed`). Furniture is refused first: looking at it would
 * change nothing.
 */
function requireAsIs(brief: DesignBrief, context: AgentContext): void {
  const named = [...new Set((brief.asIs ?? []).map((piece) => piece.assetId))]
  if (brief.source !== 'open' || !named.length) return
  const furniture = named.flatMap((id) => {
    const item = context.catalog?.find((candidate) => candidate.id === id)
    return item && !isTechnicalEquipment(item) ? [{ id, name: item.name }] : []
  })
  if (furniture.length)
    refuse('brief_as_is_furniture', furniture.map(({ name }) => furnitureFact(name)).join(' '), {
      pieces: furniture.map(({ id }) => id),
    })
  const viewed = new Set(context.session?.viewed ?? [])
  const unseen = named.filter((id) => !viewed.has(id))
  if (unseen.length) refuse('brief_as_is_not_viewed', notViewed(unseen), { pieces: unseen })
}

const isCatalogPlacement = (tool: string) =>
  (CATALOG_PLACEMENT_TOOLS as readonly string[]).includes(tool)
const isCreation = (tool: string) => (FURNISHING_CREATION_TOOLS as readonly string[]).includes(tool)

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** The catalog ids a placement call names. */
function placedAssets(tool: string, input: Record<string, unknown>): string[] {
  const named =
    tool === 'place_items'
      ? (Array.isArray(input.items) ? input.items : []).map((item) => asRecord(item).assetId)
      : [input.assetId]
  return [...new Set(named.filter((id): id is string => typeof id === 'string'))]
}

/**
 * Why a furnishing call may not run under this brief, or null. `brief` null is no brief yet. An
 * `add_object` that names a `nodeId` edits an object that stands: it places and makes nothing.
 * A batch holding a refused call is refused whole: the gate says nothing about its other calls.
 */
export function furnishingRefusal(
  tool: string,
  input: unknown,
  brief: DesignBrief | null,
): AgentRefusal | null {
  if (tool === 'run_batch') {
    const calls = asRecord(input).calls
    for (const [index, call] of (Array.isArray(calls) ? calls : []).entries()) {
      const { tool: name, input: callInput } = asRecord(call)
      if (typeof name !== 'string') continue
      const refusal = furnishingRefusal(name, callInput, brief)
      if (refusal)
        return new AgentRefusal(
          refusal.code,
          `The batch's call ${index + 1} (${name}) is refused: ${refusal.message} Nothing in the batch was applied.`,
          { ...refusal.details, index, tool: name },
        )
    }
    return null
  }
  if (!(isCatalogPlacement(tool) || isCreation(tool))) return null
  const args = asRecord(input)
  if (tool === 'add_object' && typeof args.nodeId === 'string') return null
  if (!brief) return new AgentRefusal('design_brief_required', NO_BRIEF, { tool })
  if (brief.source !== 'open' || isCreation(tool)) return null
  if (tool === 'furnish_room')
    return new AgentRefusal(
      'brief_source_open',
      openSource("the pieces of furnish_room's stock set"),
      {
        tool,
        source: brief.source,
      },
    )
  const unnamed = placedAssets(tool, args).filter(
    (id) => !brief.asIs?.some((piece) => piece.assetId === id),
  )
  return unnamed.length
    ? new AgentRefusal('brief_source_open', openSource(unnamed.join(', ')), {
        tool,
        source: brief.source,
        pieces: unnamed,
      })
    : null
}

/** Throws the refusal when the host gates and the call may not run; a host with no brief to keep passes. */
export function requireFurnishing(
  tool: string,
  input: unknown,
  brief: DesignBrief | null | undefined,
): void {
  if (brief === undefined) return
  const refusal = furnishingRefusal(tool, input, brief)
  if (refusal) throw refusal
}

/** The operation of a furnishing tool, refusing as `requireFurnishing` says before it runs. */
export function gatedByBrief<Input>(
  tool: string,
  operation: AgentOperation<Input>,
): AgentOperation<Input> {
  return (nodes, input, context) => {
    requireFurnishing(tool, input, context.designBrief)
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
  const asIs = brief.asIs ?? []
  return {
    unlocks: [
      `${FURNISHING_CREATION_TOOLS.join(', ')} make the pieces.`,
      ...(asIs.length
        ? [
            `place_items and place_in_room place the technical equipment named in asIs: ${asIs.map((piece) => piece.assetId).join(', ')}.`,
          ]
        : []),
    ],
    closed: [
      'furnish_room places a whole stock set.',
      'Catalog pieces not named in asIs: place_items and place_in_room refuse them; view_assets shows the catalog for reference.',
      'asIs keeps technical equipment (sanitaryware, appliances); furniture is made.',
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
  const brief: DesignBrief = {
    axes,
    source: input.source,
    ...(input.source !== 'open' && quote ? { sourceQuote: quote } : {}),
    ...(input.source === 'brand' && brand ? { brand } : {}),
    vision: input.vision,
    beyond: input.beyond,
    ...(input.source === 'open' && input.asIs?.length ? { asIs: input.asIs } : {}),
  }
  requireAsIs(brief, context)
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
