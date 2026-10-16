import {
  CATALOG_PLACEMENT_TOOLS,
  type DesignBrief,
  FURNISHING_CREATION_TOOLS,
} from '../agent-tools/design-brief'
import { AgentRefusal, refuse } from '../agent-tools/refusal'
import type { AgentOperation } from './types'

/**
 * Furnishing follows the turn's design brief. A host that gates keeps the brief in force
 * (`AgentContext.designBrief`, null while there is none) and each furnishing tool asks
 * `requireFurnishing` before it runs, inside `run_batch` too. A host that does not gate leaves the
 * context's brief out and nothing is refused (Pro, a person's own tools).
 */

export const NO_BRIEF =
  "Furnishing follows the turn's design brief: design_brief records what the request fixes, what it leaves open and where objects come from; until then the catalog can be searched and viewed, not placed, and no furnishing is made."

const openSource = (piece: string) =>
  `The brief left the source open: ${piece} can be made with add_object or place_design (view_assets shows the catalog's for reference), or named in the brief's asIs with a reason.`

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
            `place_items and place_in_room place the catalog pieces named in asIs: ${asIs.map((piece) => piece.assetId).join(', ')}.`,
          ]
        : []),
    ],
    closed: [
      'furnish_room places a whole stock set.',
      'Catalog pieces not named in asIs: place_items and place_in_room refuse them; view_assets shows the catalog for reference.',
    ],
  }
}

/**
 * `design_brief`: the request read as a brief, recorded as the turn's design record. The operation
 * echoes it with what it opens and hands it back for the host to keep with the session; nothing in
 * the scene changes.
 */
export const designBrief: AgentOperation<DesignBrief> = (_nodes, input) => {
  const brand = input.brand?.trim()
  if (input.source === 'brand' && !brand)
    refuse('brand_required', 'source brand names a range: give its name as brand ("IKEA").')
  const brief: DesignBrief = {
    fixed: input.fixed,
    open: input.open,
    source: input.source,
    ...(input.source === 'brand' && brand ? { brand } : {}),
    vision: input.vision,
    ...(input.source === 'open' && input.asIs?.length ? { asIs: input.asIs } : {}),
  }
  return {
    result: { status: 'recorded', brief, ...briefUnlocks(brief) },
    keep: { designBrief: brief },
  }
}
