'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { Group, UserProfile } from '@/lib/supabase-types'
import { cn } from '@/lib/utils'

type UserWithProfile = UserProfile & { email: string; groups: string[] }

export function UsersTab() {
  const [users, setUsers] = useState<UserWithProfile[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)

  const load = async () => {
    const sb = getSupabaseClient()
    const [profilesRes, groupsRes, membersRes] = await Promise.all([
      sb.from('user_profiles').select('*').order('created_at'),
      sb.from('groups').select('*').order('name'),
      sb.from('group_members').select('*'),
    ])
    const profiles = profilesRes.data ?? []
    const allGroups = groupsRes.data ?? []
    const members = membersRes.data ?? []
    setGroups(allGroups)

    // Fetch emails via admin API (only works if you have service-role key)
    // For MVP, display_name + id is enough. Email can be fetched via admin.listUsers
    // if SUPABASE_SERVICE_ROLE_KEY is set server-side. For now just show profile.
    const userList: UserWithProfile[] = profiles.map((p) => ({
      ...p,
      email: '',
      groups: members.filter((m) => m.user_id === p.id).map((m) => {
        const g = allGroups.find((g) => g.id === m.group_id)
        return g?.name ?? m.group_id
      }),
    }))
    setUsers(userList)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const updateRole = async (userId: string, role: 'admin' | 'editor' | 'viewer') => {
    const sb = getSupabaseClient()
    await sb.from('user_profiles').update({ role }).eq('id', userId)
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
  }

  const toggleActive = async (userId: string, current: boolean) => {
    const sb = getSupabaseClient()
    await sb.from('user_profiles').update({ is_active: !current }).eq('id', userId)
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: !current } : u)))
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)
    // Use Supabase Admin API via a server action / API route in production.
    // For MVP, call the Supabase Auth admin.inviteUserByEmail endpoint via the client.
    const sb = getSupabaseClient()
    const { error } = await (sb.auth.admin as unknown as {
      inviteUserByEmail: (email: string, opts: unknown) => Promise<{ error: { message: string } | null }>
    }).inviteUserByEmail(inviteEmail, { data: { role: inviteRole } }).catch(() => ({
      error: { message: 'Invite requires service-role key on the server. Use Supabase Dashboard → Authentication → Users → Invite.' },
    }))
    if (error) {
      setInviteError(error.message)
    } else {
      setInviteSuccess(true)
      setInviteEmail('')
      setTimeout(() => setInviteSuccess(false), 3000)
    }
    setInviting(false)
  }

  if (loading) return <div className="p-4 text-muted-foreground text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      {/* Invite form */}
      <div className="rounded-xl border border-border/60 bg-accent/10 p-4">
        <h3 className="mb-3 font-semibold text-sm">Invite user</h3>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleInvite}>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Email</label>
            <input
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              required
              type="email"
              value={inviteEmail}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Role</label>
            <select
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none"
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor' | 'viewer')}
              value={inviteRole}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            className="rounded-lg bg-foreground px-4 py-1.5 text-background text-sm font-medium disabled:opacity-50"
            disabled={inviting}
            type="submit"
          >
            {inviting ? 'Inviting…' : 'Send invite'}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-red-400 text-xs">{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-green-400 text-xs">Invite sent!</p>}
      </div>

      {/* Users table */}
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border/60 border-b bg-accent/20 text-muted-foreground text-xs">
              <th className="px-4 py-2.5 text-left">Name</th>
              <th className="px-4 py-2.5 text-left">Groups</th>
              <th className="px-4 py-2.5 text-left">Role</th>
              <th className="px-4 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr className="border-border/40 border-b last:border-0 hover:bg-accent/10" key={user.id}>
                <td className="px-4 py-3">
                  <span className="font-medium">{user.display_name || '—'}</span>
                  <span className="block text-muted-foreground text-xs">{user.id.slice(0, 8)}…</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.groups.length === 0 ? (
                      <span className="text-muted-foreground text-xs">No group</span>
                    ) : (
                      user.groups.map((g) => (
                        <span
                          className="rounded-full border border-border/50 bg-accent/30 px-2 py-0.5 text-xs"
                          key={g}
                        >
                          {g}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-md border border-border/50 bg-background px-2 py-0.5 text-xs"
                    onChange={(e) => updateRole(user.id, e.target.value as 'admin' | 'editor' | 'viewer')}
                    value={user.role}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      user.is_active
                        ? 'bg-green-500/15 text-green-400 hover:bg-red-500/15 hover:text-red-400'
                        : 'bg-red-500/15 text-red-400 hover:bg-green-500/15 hover:text-green-400',
                    )}
                    onClick={() => toggleActive(user.id, user.is_active)}
                    type="button"
                  >
                    {user.is_active ? 'Active' : 'Disabled'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
