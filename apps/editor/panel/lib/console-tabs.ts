import type { Dictionary } from './i18n'
import type { Permission } from './types'

export const CONSOLE_TABS = [
  'overview',
  'logs',
  'users',
  'roles',
  'audit',
  'sessions',
  'sites',
  'scenes',
  'jobs',
  'integrations',
  'updates',
  'guides',
  'settings',
] as const

export type ConsoleTab = (typeof CONSOLE_TABS)[number]

export function isConsoleTab(value: string): value is ConsoleTab {
  return (CONSOLE_TABS as readonly string[]).includes(value)
}

export interface TabMeta {
  /** Permission the tab needs; absent means every signed-in user may see it. */
  permission?: Permission
  /** Dictionary key under `c` for the rail label. */
  labelKey: keyof Dictionary['c']
}

/**
 * Single source of truth for what a tab requires and where its label comes from.
 * Kept free of the dictionary so the route guard can consult it on the server
 * without dragging translations into the decision.
 *
 * Two notes on the gates:
 *
 * The old panel put the whole console behind `admin_access`. v3 does not — it
 * has an explicit read-only state ("your role does not carry edit_users, so
 * accounts are listed but not editable"), which only means anything if a
 * non-admin can open the console at all. So the shell is open to any signed-in
 * user and each tab carries its own gate.
 *
 * Settings and Integrations ask for `admin_access` rather than `access_settings`.
 * `access_settings` is an Editor-level permission about the editor's own
 * settings; the org settings row (session length, MFA requirement, invite
 * expiry) and raw API keys are a different blast radius entirely.
 */
export const TAB_META: Record<ConsoleTab, TabMeta> = {
  overview: { labelKey: 'overview' },
  logs: { labelKey: 'diagnostics', permission: 'view_logs' },
  users: { labelKey: 'users' },
  roles: { labelKey: 'roles' },
  audit: { labelKey: 'audit', permission: 'view_logs' },
  sessions: { labelKey: 'sessions' },
  sites: { labelKey: 'sites' },
  // Scene ownership moves data between accounts — same blast radius as the
  // org settings, so the same gate.
  scenes: { labelKey: 'scenes', permission: 'admin_access' },
  jobs: { labelKey: 'jobs' },
  integrations: { labelKey: 'integrations', permission: 'admin_access' },
  updates: { labelKey: 'changelog' },
  // The manual is for everyone signed in, not just admins.
  guides: { labelKey: 'guides' },
  settings: { labelKey: 'settings', permission: 'admin_access' },
}

export interface RailEntry {
  kind: 'heading' | 'item'
  id?: ConsoleTab
  label: string
  permission?: Permission
}

/**
 * The rail's three groups, in the order the design fixes them: Monitor, Access,
 * Platform. Labels resolve through the dictionary so the rail switches language
 * with everything else.
 */
export function railEntries(t: Dictionary): RailEntry[] {
  const item = (id: ConsoleTab): RailEntry => ({
    kind: 'item',
    id,
    label: t.c[TAB_META[id].labelKey] as string,
    permission: TAB_META[id].permission,
  })

  return [
    { kind: 'heading', label: t.c.monitor },
    item('overview'),
    item('logs'),

    { kind: 'heading', label: t.c.access },
    item('users'),
    item('roles'),
    item('audit'),
    item('sessions'),

    { kind: 'heading', label: t.c.platform },
    item('sites'),
    item('scenes'),
    item('jobs'),
    item('integrations'),
    item('updates'),
    item('guides'),
    item('settings'),
  ]
}

export function tabLabel(t: Dictionary, tab: ConsoleTab): string {
  return (t.c[TAB_META[tab].labelKey] as string) ?? tab
}

export function tabPermission(tab: ConsoleTab): Permission | undefined {
  return TAB_META[tab].permission
}
