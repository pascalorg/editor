import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { createRoleSchema, type RolesFullResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { allRoles, invalidateRolesCache } from '@panel/lib/auth/roles'
import { exec, query, type RowDataPacket } from '@panel/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function rolesWithCounts(canEdit: boolean): Promise<RolesFullResponse> {
  const roles = await allRoles()
  const counts = await query<RowDataPacket & { global_role: string; n: number }>(
    'SELECT global_role, COUNT(*) AS n FROM users GROUP BY global_role',
  )
  const byName = new Map(counts.map((c) => [c.global_role, c.n]))

  return {
    roles: roles.map((r) => ({ ...r, userCount: byName.get(r.name) ?? 0 })),
    canEdit,
  }
}

/** GET /api/roles — the permission matrix and the role cards read from here. */
export const GET = handler(async () => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }
  return ok(await rolesWithCounts(guard.session.user.permissions.includes('edit_roles')))
})

/**
 * POST /api/roles — adds a custom role.
 *
 * Starts with `view_projects` only, matching the old panel: a new role that
 * arrives with no permissions looks broken, and one that arrives with many is a
 * privilege accident waiting to happen.
 */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('edit_roles')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, createRoleSchema)
  if (!parsed.ok) return parsed.response

  const name = parsed.data.name
  const existing = await allRoles()
  if (existing.some((r) => r.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
    return fail('conflict', 'err.roleExists')
  }

  await exec('INSERT INTO roles (name, permissions, is_system) VALUES (?, CAST(? AS JSON), 0)', [
    name,
    JSON.stringify(['view_projects']),
  ])
  invalidateRolesCache()

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'role_change',
    message: `Role created: ${name}`,
    event: { k: 'roleCreated', p: { name } },
  })

  return ok(await rolesWithCounts(true), { status: 201 })
})
