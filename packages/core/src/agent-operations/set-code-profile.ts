import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { setCodeProfileTool } from '../agent-tools/set-code-profile'
import {
  CODE_PROFILE_KEY,
  CODE_PROFILES,
  type CodeProfileId,
  codeProfileOf,
} from '../building/code-profile'
import type { SiteNode } from '../schema'
import { queryNodes } from './scene-queries'
import type { AgentOperation } from './types'

const inputSchema = z.strictObject(setCodeProfileTool.input)

function siteOf(nodes: Parameters<AgentOperation<unknown>>[0]): SiteNode {
  const sites = queryNodes<SiteNode>(nodes, { type: 'site' })
  if (!sites.length) refuse('no_site', 'The scene has no site to hold the code profile.')
  if (sites.length > 1)
    refuse(
      'ambiguous_site',
      'The scene has more than one site; which one names the code is ambiguous.',
    )
  return sites[0]!
}

const effect = (profile: CodeProfileId | null) =>
  profile === null
    ? 'The project names no code: the checks that apply a code report information that names the US IRC they used.'
    : CODE_PROFILES[profile].id === 'irc-2021'
      ? 'The project follows the US IRC 2021: the checks that apply a code report warnings.'
      : `The project follows ${CODE_PROFILES[profile].label}, which holds only the values read in its own texts: a check that has no value for it reports nothing.`

/**
 * `set_code_profile`: the one place `site.metadata.codeProfile` is written (the agent tool, the MCP
 * tool, the site panel and Architect Pro's `code_basis_set` all call it). The rest of the site's
 * metadata is kept; clearing removes the key.
 */
export const setCodeProfile: AgentOperation<z.output<typeof inputSchema>> = (nodes, input) => {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const site = siteOf(nodes)
  const profile = parsed.data.profile
  const previous = codeProfileOf({ [site.id]: site })?.id ?? null
  const message = effect(profile)
  const result = { siteId: site.id, profile, previous, unchanged: previous === profile, message }
  if (previous === profile) return { result }
  const metadata: Record<string, unknown> = { ...site.metadata }
  if (profile === null) delete metadata[CODE_PROFILE_KEY]
  else metadata[CODE_PROFILE_KEY] = profile
  return { result, changes: { update: [{ id: site.id, data: { metadata } }] } }
}
