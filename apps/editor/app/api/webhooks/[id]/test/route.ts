import { fail, handler, ok } from '@panel/lib/api'
import type { WebhookTestResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { deliverTest } from '@panel/lib/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/:id/test — sends one real ping and reports what came back.
 *
 * It is a genuine outbound request, not a simulation: the only useful answer to
 * "is this endpoint reachable" is one that actually tried.
 */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const result = await deliverTest(id)
  if (!result.hook) return fail('not_found', 'err.notFound')

  const httpSuffix = result.responseStatus ? ` (HTTP ${result.responseStatus})` : ''

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: result.delivered ? 'info' : 'warn',
    kind: 'webhook',
    message: `Webhook test ${result.delivered ? 'delivered' : 'failed'}: ${result.hook.url}${httpSuffix}`,
    event: {
      k: result.delivered ? 'webhookTestDelivered' : 'webhookTestFailed',
      p: { url: result.hook.url, status: httpSuffix },
    },
  })

  const body: WebhookTestResponse = {
    delivered: result.delivered,
    status: result.hook.status,
    responseStatus: result.responseStatus,
  }
  return ok(body)
})
