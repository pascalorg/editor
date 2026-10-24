import { z } from 'zod'
import type { AgentToolContract } from './contract'

/**
 * A hosted builder: one model writes a whole home as free three.js, others model its furniture in
 * parallel, and a program the same kind of model writes for the design converts it into ordinary
 * Pascal nodes. The host runs it (it calls models and spends credits); the contract is shared so
 * the chat and the hosted MCP offer one tool.
 */
export const buildDesignTool = {
  name: 'build_design',
  title: 'Build a design',
  description:
    'Design and build a whole home from a brief: one architect writes the whole house freely, as three.js (its shape, walls, windows and doors, facades, roof, finishes and lights); a second call writes the program that converts that design into editable walls, doors and windows that open, rooms with their floors and authored objects, corrected once from what Pascal measured in the scene it wrote; every piece of furniture the architect delegates is modelled on its own and placed as it is finished. Use it to design a new home, or to rebuild a design it made before (replace: true); change what it built with the ordinary tools, since it writes ordinary walls, rooms and objects. It takes several minutes and spends credits on every model call it makes; it stops starting pieces when the balance would not cover them. It answers a report: what it built by kind, how the scene measured against the design (openings that open, glass, floors covering their rooms, pieces placed, what stands outside, wall finishes; complete only when all pass), the pieces it could not build or place with their reasons, and what it skipped. Where the host runs it in the background (the hosted MCP), it answers at once with a turn id instead: poll get_architect_turn with it.',
  input: {
    brief: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .describe(
        "The home to design, in the person's words plus what you know: rooms and storeys, size, style, finishes, the site, anything they asked for or ruled out.",
      ),
    replace: z
      .boolean()
      .default(false)
      .describe(
        'true to rebuild a design an earlier build made on this project (default false: the project must have no walls or rooms yet).',
      ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const satisfies AgentToolContract
