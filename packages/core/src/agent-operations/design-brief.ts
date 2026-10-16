import {
  CATALOG_PLACEMENT_TOOLS,
  type DesignBrief,
  FURNISHING_CREATION_TOOLS,
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
  "A source is set by the request: the brief's sourceQuote must be the person's own words naming it; this request names none, so its source is open."

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

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
export const designBrief: AgentOperation<DesignBrief> = (_nodes, input, context) => {
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
    if (context.requestText !== undefined && !squash(context.requestText).includes(squash(quote)))
      refuse('source_not_in_request', SOURCE_NOT_IN_REQUEST)
  }
  const brief: DesignBrief = {
    fixed: input.fixed,
    open: input.open,
    source: input.source,
    ...(input.source !== 'open' && quote ? { sourceQuote: quote } : {}),
    ...(input.source === 'brand' && brand ? { brand } : {}),
    vision: input.vision,
    beyond: input.beyond,
    ...(input.source === 'open' && input.asIs?.length ? { asIs: input.asIs } : {}),
  }
  requireAsIs(brief, context)
  return {
    result: { status: 'recorded', brief, ...briefUnlocks(brief) },
    keep: { designBrief: brief },
  }
}
