import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { patchWebhookSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { deleteWebhook, setWebhookStatus } from '@panel/lib/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PATCH /api/webhooks/:id — pause / resume. */
export const PATCH = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, patchWebhookSchema)
  if (!parsed.ok) return parsed.response

  const { id } = await ctx.params
  const webhook = await setWebhookStatus(id, parsed.data.status)
  if (!webhook) return fail('not_found', 'err.notFound')

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'webhook',
    message: `Webhook ${parsed.data.status === 'paused' ? 'paused' : 'resumed'}: ${webhook.url}`,
    event: {
      k: parsed.data.status === 'paused' ? 'webhookPaused' : 'webhookResumed',
      p: { url: webhook.url },
    },
  })

  return ok({ webhook })
})

export const DELETE = handler(
  async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const guard = await requirePermission('admin_access')
    if (!guard.ok) {
      return guard.reason === 'forbidden'
        ? fail('forbidden', 'err.forbidden')
        : fail('unauthenticated', 'err.sessionExpired')
    }

    const { id } = await ctx.params
    if (!(await deleteWebhook(id))) return fail('not_found', 'err.notFound')

    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'warn',
      kind: 'webhook',
      message: `Webhook deleted: ${id}`,
      event: { k: 'webhookDeleted', p: { id } },
    })

    return ok({ deleted: true })
  },
)
