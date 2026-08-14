import dedent from 'dedent'
import { generateId } from '../../schema/base'
import { FormworkBoxOutNode } from '../../schema/nodes/formwork-box-out'
import type { AnyNode } from '../../schema/types'

/**
 * What the void-former tool is for, shared verbatim between the MCP surface and
 * the editor's chat tool: a field described two ways is a decision the second
 * agent asks the user to restate.
 */
export const ADD_BOX_OUT_DESCRIPTION = dedent`
  Create a box-out — a void former — on a wall or a slab: a penetration that is
  neither a door nor a window, like a pipe sleeve, a cable penetration or a
  light shaft. The host's shutter cuts its panels around the void and returns
  the four reveal faces inside it, cut to the release details — creating one
  re-cuts the host's panels, so there is no second step.
  position is the centre of the void in the host's local frame: [along,
  centreY, z], where along is the distance from the host's start and centreY
  the height of the void's centre above the host's base (the third coordinate
  is the offset through the thickness). width and height are the clear opening
  the finished concrete shows, in meters.
  draftAngleDeg (0–10) tapers the reveal boards so the former strikes without
  wedging, and chamferStrips bevel the reveal edges to leave a clean arris —
  both optional, absent means plain boards, square-cut.
  Ask the user for the position and size rather than guessing, and say which
  element the void is in.
`

/** The kinds a void can cut through. A beam has no shutter that voids yet. */
export const BOX_OUT_HOST_TYPES: readonly string[] = ['wall', 'slab']

export type AddBoxOutInput = {
  elementId: string
  position: [number, number, number]
  width: number
  height: number
  draftAngleDeg?: number
  chamferStrips?: boolean
}

/**
 * The void-former node the tools create, or the refusal to hand back.
 *
 * Validated before anything is written so a refused call leaves the scene as it
 * was — the same contract the construction patch honours. The schema's own
 * defaults and range checks do the rest once the node parses.
 */
export function buildBoxOutNode(
  host: AnyNode,
  input: AddBoxOutInput,
): { node: FormworkBoxOutNode } | { error: string } {
  if (!BOX_OUT_HOST_TYPES.includes(host.type)) {
    return {
      error: `Error: a box-out voids a wall or a slab, and ${host.id} is a ${host.type}. Call list_castable_elements and read the id of the wall or slab the void is in.`,
    }
  }
  if (!(input.width > 0)) {
    return { error: `Error: width must be positive, got ${input.width}.` }
  }
  if (!(input.height > 0)) {
    return { error: `Error: height must be positive, got ${input.height}.` }
  }
  if (input.draftAngleDeg !== undefined && (input.draftAngleDeg < 0 || input.draftAngleDeg > 10)) {
    return {
      error: `Error: draftAngleDeg must be between 0 and 10 degrees, got ${input.draftAngleDeg}.`,
    }
  }
  return {
    node: FormworkBoxOutNode.parse({
      object: 'node',
      id: generateId('formwork-box-out'),
      type: 'formwork-box-out',
      parentId: host.id,
      visible: true,
      metadata: {},
      children: [],
      position: input.position,
      width: input.width,
      height: input.height,
      ...(input.draftAngleDeg !== undefined ? { draftAngleDeg: input.draftAngleDeg } : {}),
      ...(input.chamferStrips !== undefined ? { chamferStrips: input.chamferStrips } : {}),
    }),
  }
}
