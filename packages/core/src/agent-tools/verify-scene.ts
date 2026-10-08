import type { z } from 'zod'

/**
 * `verify_scene`'s contract. Other modules extend it with an input and a sentence for the check
 * they register (the photo's: `photo`), so it stays one tool agents know, with one contract on
 * both surfaces, and imports none of them.
 */
const extensions: { input: Record<string, z.ZodType>; description: string }[] = []

/** Adds inputs and a sentence of description to verify_scene, for a check registered with it. */
export function extendVerifyScene(extension: {
  input: Record<string, z.ZodType>
  description: string
}) {
  extensions.push(extension)
}

const DESCRIPTION =
  'Check the whole scene after complex edits, and before retrying a failed tool: per-level content and roles (storey, roof-only, support), then every problem found, each with a type: empty levels, walls with no room or door, rooms with no floor or ceiling, storeys with no stair, roof levels misused, openings off their wall, stairs off their slab or blocked, furniture blocking a door or overlapping, nodes their schema rejects.'

export const verifySceneTool = {
  name: 'verify_scene',
  title: 'Verify scene',
  get description() {
    return [DESCRIPTION, ...extensions.map((extension) => extension.description)].join(' ')
  },
  get input(): Record<string, z.ZodType> {
    return Object.assign({}, ...extensions.map((extension) => extension.input))
  },
}
