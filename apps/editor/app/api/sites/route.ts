import { ulid } from 'ulid';
import { fail, handler, ok, parseBody } from '@panel/lib/api';
import { createSiteSchema } from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission, requireSession } from '@panel/lib/auth/guard';
import { exec, query, queryOne, type RowDataPacket } from '@panel/lib/db';
import { enqueueJob, startJobWorker } from '@panel/lib/jobs';
import type { Site } from '@panel/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/sites — every site, archived ones included, newest name order. */
export const GET = handler(async () => {
  const guard = await requireSession();
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired');

  const rows = await query<
    RowDataPacket & {
      public_id: string;
      name: string;
      status: 'active' | 'setup' | 'archived';
      storage_slots: number | null;
      picking_slots: number | null;
      footprint_m2: number | null;
      created_by_email: string;
      created_at: Date;
      user_count: number;
    }
  >(
    `SELECT s.public_id, s.name, s.status, s.storage_slots, s.picking_slots, s.footprint_m2,
            u.email AS created_by_email, s.created_at,
            (SELECT COUNT(*) FROM assignments a WHERE a.site_id = s.id) AS user_count
       FROM sites s
       JOIN users u ON u.id = s.created_by
      ORDER BY s.name`,
  );

  const sites: Site[] = rows.map((r) => ({
    id: r.public_id,
    name: r.name,
    status: r.status,
    storageSlots: r.storage_slots ?? undefined,
    pickingSlots: r.picking_slots ?? undefined,
    footprintM2: r.footprint_m2 ?? undefined,
    createdBy: r.created_by_email,
    createdAt: r.created_at.toISOString(),
    userCount: r.user_count,
  }));

  return ok({ sites, canEdit: guard.session.user.permissions.includes('admin_access') });
});

/**
 * POST /api/sites — creates the site in `setup` and queues its provisioning.
 *
 * The site is NOT active on return: a provisioning job carries it there, which
 * is what makes the "Setting up" card state and the job queue two views of one
 * fact rather than two independent fictions.
 */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('admin_access');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const parsed = await parseBody(request, createSiteSchema);
  if (!parsed.ok) return parsed.response;

  const { name, template, footprintM2 } = parsed.data;

  const clash = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM sites WHERE name = ?', [name]);
  if (clash) return fail('conflict', 'err.siteExists');

  const publicId = ulid();
  await exec(
    `INSERT INTO sites (public_id, name, status, footprint_m2, created_by)
     VALUES (?, ?, 'setup', ?, ?)`,
    [publicId, name, footprintM2 ?? null, guard.session.userId],
  );

  const row = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM sites WHERE public_id = ?', [publicId]);
  const jobId = await enqueueJob({
    kind: 'site_provision',
    siteId: row?.id ?? null,
    payload: { template, footprintM2: footprintM2 ?? null },
    queuedBy: guard.session.userId,
  });
  startJobWorker();

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'site',
    message: `Site created: ${name} (${template}) — provisioning queued as ${jobId}`,
    event: { k: 'siteCreated', p: { name, template, jobId } },
    meta: { site: publicId, job: jobId },
  });

  return ok({ site: publicId, job: jobId }, { status: 201 });
});
