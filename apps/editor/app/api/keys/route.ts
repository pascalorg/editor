import { fail, handler, ok, parseBody } from '@panel/lib/api';
import { createKeySchema, type CreateKeyResponse, type KeysResponse } from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { createKey, listKeys } from '@panel/lib/integrations';
import { siteNames } from '@panel/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/keys — prefixes only; the raw key exists nowhere on this path. */
export const GET = handler(async () => {
  const guard = await requirePermission('admin_access');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const body: KeysResponse = { keys: await listKeys(), sites: await siteNames(), canEdit: true };
  return ok(body);
});

/** POST /api/keys — the ONLY response that ever carries the raw key. */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('admin_access');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const parsed = await parseBody(request, createKeySchema);
  if (!parsed.ok) return parsed.response;

  const key = await createKey({
    name: parsed.data.name,
    scope: parsed.data.scope,
    siteName: parsed.data.siteName ?? null,
    createdBy: guard.session.userId,
  });

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'api_key',
    message: `API key created: ${key.name} (${key.scope}) · ${key.siteId ?? 'all sites'}`,
    event: { k: 'apiKeyCreated', p: { name: key.name, scope: key.scope, site: key.siteId ?? 'all sites' } },
    // The prefix is safe to record; the secret is not, and never appears here.
    meta: { key: key.id, prefix: key.prefix },
  });

  const body: CreateKeyResponse = { key };
  return ok(body, { status: 201 });
});
