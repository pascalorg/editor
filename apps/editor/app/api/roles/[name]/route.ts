import { fail, handler, ok, parseBody } from '@panel/lib/api';
import { updateRoleSchema, type DeleteRoleResponse } from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { allRoles, invalidateRolesCache } from '@panel/lib/auth/roles';
import { exec, transaction } from '@panel/lib/db';
import { PERMISSIONS, type Permission } from '@panel/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * PUT /api/roles/:name — toggles in the permission matrix write straight here.
 *
 * System roles (Admin, Supervisor, Editor, Viewer) are defined in code and are
 * not editable: letting someone strip `admin_access` off Admin is a one-click
 * way to lock the whole tenant out.
 */
export const PUT = handler(async (request: Request, ctx: { params: Promise<{ name: string }> }) => {
  const guard = await requirePermission('edit_roles');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const parsed = await parseBody(request, updateRoleSchema);
  if (!parsed.ok) return parsed.response;

  const { name } = await ctx.params;
  const role = (await allRoles()).find((r) => r.name === decodeURIComponent(name));
  if (!role) return fail('not_found', 'err.notFound');
  if (role.isSystem) return fail('forbidden', 'err.systemRoleLocked');

  const permissions = parsed.data.permissions.filter(isPermission);
  await exec('UPDATE roles SET permissions = CAST(? AS JSON) WHERE name = ?', [
    JSON.stringify(permissions),
    role.name,
  ]);
  invalidateRolesCache();

  const added = permissions.filter((p) => !role.permissions.includes(p));
  const removed = role.permissions.filter((p) => !permissions.includes(p));
  // Built once: the stored sentence and the rendered one must not drift apart.
  const permissionDelta =
    (added.length ? ` · +${added.join(', ')}` : '') + (removed.length ? ` · -${removed.join(', ')}` : '');

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'role_change',
    message: `Permissions updated for ${role.name}${permissionDelta}`,
    event: { k: 'rolePermissions', p: { name: role.name, changes: permissionDelta } },
    meta: { added, removed },
  });

  return ok({ name: role.name, permissions });
});

/** DELETE /api/roles/:name — custom roles only; their users fall back to Viewer. */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ name: string }> }) => {
  const guard = await requirePermission('edit_roles');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const { name } = await ctx.params;
  const role = (await allRoles()).find((r) => r.name === decodeURIComponent(name));
  if (!role) return fail('not_found', 'err.notFound');
  if (role.isSystem) return fail('forbidden', 'err.systemRoleLocked');

  // Reassign inside the transaction so no account is ever left pointing at a
  // role that no longer exists — an unknown role grants nothing at all.
  const reassigned = await transaction(async (cx) => {
    const [res] = await cx.execute("UPDATE users SET global_role = 'Viewer' WHERE global_role = ?", [role.name]);
    await cx.execute("UPDATE assignments SET role = 'Viewer' WHERE role = ?", [role.name]);
    await cx.execute('DELETE FROM roles WHERE name = ?', [role.name]);
    return (res as { affectedRows: number }).affectedRows;
  });
  invalidateRolesCache();

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'role_change',
    message: `Role deleted: ${role.name} — ${reassigned} account(s) reassigned to Viewer`,
    event: { k: 'roleDeleted', p: { name: role.name, count: reassigned } },
  });

  const body: DeleteRoleResponse = { reassigned };
  return ok(body);
});
