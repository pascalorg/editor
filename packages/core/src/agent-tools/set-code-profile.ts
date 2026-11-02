import { z } from 'zod'
import { CODE_PROFILE_IDS } from '../building/code-profile'

export const setCodeProfileTool = {
  name: 'set_code_profile',
  title: 'Set code profile',
  description:
    'Say which building code the project follows: irc-2021 (the US IRC 2021), au-ncc (the Australian NCC) or fr (the French regulations); null clears it. A project that names no code has none: nothing is guessed from an address. ' +
    'The checks that apply a code (bathroom clearances) read it: with irc-2021 they are warnings, with no code they are information that names the US IRC they used, and au-ncc and fr hold only the values read in their own texts (stairs, ceiling heights), none of which those checks use yet, so they report nothing. ' +
    'Stored as site.metadata.codeProfile. Refusals: no_site, ambiguous_site, invalid_input. One undo step.',
  input: {
    profile: z
      .enum(CODE_PROFILE_IDS)
      .nullable()
      .describe('The code: irc-2021, au-ncc or fr. null: the project names no code.'),
  },
}

export const codeProfileOutput = {
  siteId: z.string(),
  profile: z.enum(CODE_PROFILE_IDS).nullable(),
  previous: z.enum(CODE_PROFILE_IDS).nullable(),
  unchanged: z.boolean(),
  message: z.string(),
}
