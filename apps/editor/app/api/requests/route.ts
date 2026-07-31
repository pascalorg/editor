import { ulid } from 'ulid';
import { fail, handler, ok, parseBody } from '@panel/lib/api';
import {
  accessRequestSchema,
  type AccessRequestResponse,
  type PendingRequestsResponse,
} from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { requireSession } from '@panel/lib/auth/guard';
import { WORK_DOMAIN } from '@panel/lib/auth/users';
import { exec, query, queryOne, type RowDataPacket } from '@panel/lib/db';
import { deliverRequestReceipt } from '@panel/lib/mail';
import { getSettings } from '@panel/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/requests — the pending strip above the user table. */
export const GET = handler(async () => {
  const guard = await requireSession();
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired');

  const rows = await query<
    RowDataPacket & {
      public_id: string;
      full_name: string;
      email: string;
      username: string;
      department: string;
      requested_role: string;
      note: string | null;
      created_at: Date;
    }
  >(
    `SELECT public_id, full_name, email, username, department, requested_role, note, created_at
       FROM access_requests
      WHERE status = 'pending'
      ORDER BY created_at DESC`,
  );

  const body: PendingRequestsResponse = {
    requests: rows.map((r) => ({
      id: r.public_id,
      fullName: r.full_name,
      email: r.email,
      username: r.username,
      department: r.department,
      requestedRole: r.requested_role,
      note: r.note,
      status: 'pending' as const,
      createdAt: r.created_at.toISOString(),
    })),
  };
  return ok(body);
});

/**
 * POST /api/requests — the public "Request an account" screen.
 *
 * The domain suffix is applied server-side from WORK_DOMAIN, not taken from the
 * request: the form renders it as a fixed adornment, and a client that posts a
 * full foreign address must not be able to smuggle one past that.
 *
 * Duplicate handling is deliberately quiet. An existing account or a pending
 * request answers exactly like a fresh submission, because this endpoint is
 * unauthenticated and a distinguishable response turns it into a directory
 * oracle for "who works here".
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, accessRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { fullName, username, department, requestedRole, note } = parsed.data;
  const email = `${username}${WORK_DOMAIN}`;

  const settings = await getSettings();
  if (!settings.externalUsersAllowed && !email.endsWith(WORK_DOMAIN)) {
    return fail('forbidden', 'err.externalNotAllowed');
  }

  const existingUser = await queryOne<RowDataPacket & { id: number }>(
    'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
    [email, username],
  );
  const existingRequest = await queryOne<RowDataPacket & { public_id: string }>(
    "SELECT public_id FROM access_requests WHERE email = ? AND status = 'pending' LIMIT 1",
    [email],
  );

  const publicId = existingRequest?.public_id ?? ulid();

  if (!existingUser && !existingRequest) {
    await exec(
      `INSERT INTO access_requests (public_id, full_name, email, username, department, requested_role, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [publicId, fullName, email, username, department, requestedRole, note ?? null],
    );
    await deliverRequestReceipt({ email, fullName });
    await audit({
      actorLabel: email.slice(0, 64),
      level: 'info',
      kind: 'request',
      message: `Account requested — ${department} / ${requestedRole}`,
      event: { k: 'accountRequested', p: { department, role: requestedRole } },
      meta: { request: publicId },
    });
  } else {
    await audit({
      actorLabel: email.slice(0, 64),
      level: 'info',
      kind: 'request',
      message: existingUser
        ? 'Account request ignored — an account already exists'
        : 'Account request ignored — a request is already pending',
      event: { k: existingUser ? 'requestIgnoredExists' : 'requestIgnoredPending' },
    });
  }

  const body: AccessRequestResponse = { request: { id: publicId, email, status: 'pending' } };
  return ok(body, { status: 202 });
});
