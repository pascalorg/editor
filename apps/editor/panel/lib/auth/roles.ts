import { query, type RowDataPacket } from '../db'
import { PERMISSIONS, type Permission, type Role, type RoleDefinition } from '../types'

/**
 * System roles are constants in code (section 10). The `roles` table only has to
 * answer for custom roles, but the seed writes the system three as well so the
 * Roles tab renders one uniform list. Code wins if the two ever disagree.
 */
const SYSTEM: Record<string, Permission[]> = {
  Admin: [...PERMISSIONS],
  Supervisor: [
    'edit_projects',
    'create_projects',
    'delete_projects',
    'access_settings',
    'view_projects',
    'edit_users',
    'view_logs',
  ],
  Editor: [
    'edit_projects',
    'create_projects',
    'delete_projects',
    'access_settings',
    'view_projects',
  ],
  Viewer: ['view_projects'],
}

let cache: { value: Map<string, RoleDefinition>; at: number } | null = null
const TTL_MS = 5_000

function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

async function loadRoles(): Promise<Map<string, RoleDefinition>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  const map = new Map<string, RoleDefinition>()
  for (const [name, permissions] of Object.entries(SYSTEM)) {
    map.set(name, { name, permissions, isSystem: true })
  }

  try {
    const rows = await query<
      RowDataPacket & { name: string; permissions: unknown; is_system: number }
    >('SELECT name, permissions, is_system FROM roles')
    for (const row of rows) {
      if (SYSTEM[row.name]) continue // code definition wins for system roles
      const raw = typeof row.permissions === 'string' ? safeParse(row.permissions) : row.permissions
      const permissions = Array.isArray(raw) ? raw.filter(isPermission) : []
      map.set(row.name, { name: row.name, permissions, isSystem: row.is_system === 1 })
    }
  } catch {
    // Roles table not migrated yet — the system three are enough to sign in.
  }

  cache = { value: map, at: Date.now() }
  return map
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function invalidateRolesCache(): void {
  cache = null
}

export async function permissionsForRole(role: string): Promise<Permission[]> {
  const roles = await loadRoles()
  // An unknown role grants nothing rather than falling back to Viewer — a typo
  // in a role name must not silently hand out read access.
  return roles.get(role)?.permissions ?? []
}

export async function allRoles(): Promise<RoleDefinition[]> {
  const roles = await loadRoles()
  const order = ['Admin', 'Supervisor', 'Editor', 'Viewer']
  return [...roles.values()].sort((a, b) => {
    const ai = order.indexOf(a.name)
    const bi = order.indexOf(b.name)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    // Custom roles alphabetically, with the Turkish collator so İ/ı sort right.
    return new Intl.Collator('tr').compare(a.name, b.name)
  })
}

export function hasPermission(permissions: Permission[], required: Permission): boolean {
  return permissions.includes(required)
}

/**
 * External accounts (org = 'external') cap out at Viewer globally — real access
 * only ever arrives through a site assignment (section 08, external user rule).
 */
export function clampExternalRole(org: 'internal' | 'external', role: Role): Role {
  return org === 'external' ? 'Viewer' : role
}
