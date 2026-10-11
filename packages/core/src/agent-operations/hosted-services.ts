import { z } from 'zod'
import {
  findHostedServiceTool,
  type HostedServiceAction,
  siteContextInputSchema,
} from '../agent-tools/hosted-services'
import { AgentRefusal } from '../agent-tools/refusal'

export type HostedServiceRequest = {
  action: HostedServiceAction
  pluginId: string
  projectId?: string
  maxCredits?: number
  input: Record<string, unknown>
  signal?: AbortSignal
}

/** Identity, project access, provider credentials and billing are supplied by the host. */
export type HostedServiceExecutor = (request: HostedServiceRequest) => Promise<unknown>

export async function executeHostedServiceTool(
  name: string,
  raw: unknown,
  execute: HostedServiceExecutor,
  signal?: AbortSignal,
): Promise<unknown> {
  const contract = findHostedServiceTool(name)
  if (!contract)
    throw new AgentRefusal('unknown_service_tool', 'This hosted service tool is not available.')
  const parsed = z.object(contract.input).strict().safeParse(raw)
  if (!parsed.success)
    throw new AgentRefusal('invalid_service_input', 'Invalid hosted service input.', {
      issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
    })
  const { pluginId, projectId, maxCredits, ...input } = parsed.data as {
    pluginId: string
    projectId?: string
    maxCredits?: number
    [key: string]: unknown
  }
  if (contract.action === 'site.pull') {
    const { pullKey: _key, ...location } = input
    const valid = siteContextInputSchema.safeParse(location)
    if (!valid.success)
      throw new AgentRefusal(
        'invalid_site_location',
        'Supply an address or both latitude and longitude.',
      )
  }
  signal?.throwIfAborted()
  return execute({ action: contract.action, pluginId, projectId, maxCredits, input, signal })
}
