import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { createWebhookSchema, type WebhooksResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { createWebhook, HOOK_EVENTS, listWebhooks } from '@panel/lib/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(async () => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const body: WebhooksResponse = {
    webhooks: await listWebhooks(),
    events: [...HOOK_EVENTS],
    canEdit: true,
  }
  return ok(body)
})

/** POST /api/webhooks — https only; the schema refuses plaintext endpoints. */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, createWebhookSchema)
  if (!parsed.ok) return parsed.response

  const known = new Set<string>(HOOK_EVENTS)
  const events = parsed.data.events.filter((e) => known.has(e))
  if (events.length === 0) return fail('validation', 'err.eventRequired', { field: 'events' })

  const webhook = await createWebhook(parsed.data.url, events)

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'webhook',
    message: `Webhook added: ${webhook.url} · ${events.join(', ')}`,
    event: { k: 'webhookAdded', p: { url: webhook.url, events: events.join(', ') } },
    meta: { webhook: webhook.id },
  })

  return ok({ webhook }, { status: 201 })
})
