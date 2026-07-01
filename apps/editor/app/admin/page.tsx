'use client'

import { useState } from 'react'
import { AuditLogTab } from '@/components/admin/audit-log-tab'
import { CustomFieldsTab } from '@/components/admin/custom-fields-tab'
import { GroupsTab } from '@/components/admin/groups-tab'
import { PermissionsTab } from '@/components/admin/permissions-tab'
import { UsersTab } from '@/components/admin/users-tab'

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'groups', label: 'Groups' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'custom-fields', label: 'Custom Fields' },
  { id: 'audit-log', label: 'Audit Log' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('users')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Admin Panel</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage users, groups, permissions, custom fields, and audit logs.
          </p>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex gap-1 border-b border-border/60">
          {TABS.map((tab) => (
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'groups' && <GroupsTab />}
          {activeTab === 'permissions' && <PermissionsTab />}
          {activeTab === 'custom-fields' && <CustomFieldsTab />}
          {activeTab === 'audit-log' && <AuditLogTab />}
        </div>
      </div>
    </div>
  )
}
