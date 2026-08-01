'use client'

import { AuditTab } from '@panel/components/console/audit-tab'
import { GuidesTab } from '@panel/components/console/guides-tab'
import { IntegrationsTab } from '@panel/components/console/integrations-tab'
import { JobsTab } from '@panel/components/console/jobs-tab'
import { LogsTab } from '@panel/components/console/logs-tab'
import { OverviewTab } from '@panel/components/console/overview-tab'
import { RolesTab } from '@panel/components/console/roles-tab'
import { ScenesTab } from '@panel/components/console/scenes-tab'
import { SessionsTab } from '@panel/components/console/sessions-tab'
import { SettingsTab } from '@panel/components/console/settings-tab'
import { SitesTab } from '@panel/components/console/sites-tab'
import { UpdatesTab } from '@panel/components/console/updates-tab'
import { UsersTab } from '@panel/components/console/users-tab'
import type { ConsoleTab } from '@panel/lib/console-tabs'

/**
 * One switch, so adding a tab in a later handover step is a single edit here
 * rather than a change to the route, the shell and the rail.
 */
export function TabContent({ tab }: { tab: ConsoleTab }) {
  switch (tab) {
    case 'users':
      return <UsersTab />
    case 'roles':
      return <RolesTab />
    case 'sessions':
      return <SessionsTab />
    case 'sites':
      return <SitesTab />
    case 'scenes':
      return <ScenesTab />
    case 'jobs':
      return <JobsTab />
    case 'integrations':
      return <IntegrationsTab />
    case 'settings':
      return <SettingsTab />
    case 'overview':
      return <OverviewTab />
    case 'logs':
      return <LogsTab />
    case 'audit':
      return <AuditTab />
    case 'updates':
      return <UpdatesTab />
    case 'guides':
      return <GuidesTab />
    // No default: `tab` is a ConsoleTab, every one of the eleven is handled
    // above, and TypeScript now fails the build if a twelfth is added without a
    // screen. A fallback here would have hidden that.
  }
}
