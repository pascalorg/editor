'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { Group, UserProfile } from '@/lib/supabase-types'

export function GroupsTab() {
  const [groups, setGroups] = useState<Group[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [members, setMembers] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    const sb = getSupabaseClient()
    const [gRes, uRes, mRes] = await Promise.all([
      sb.from('groups').select('*').order('name'),
      sb.from('user_profiles').select('*').order('display_name'),
      sb.from('group_members').select('*'),
    ])
    setGroups(gRes.data ?? [])
    setUsers(uRes.data ?? [])

    const mMap: Record<string, string[]> = {}
    for (const m of mRes.data ?? []) {
      if (!mMap[m.group_id]) mMap[m.group_id] = []
      mMap[m.group_id]!.push(m.user_id)
    }
    setMembers(mMap)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    const sb = getSupabaseClient()
    const { data } = await sb
      .from('groups')
      .insert({ name: newName, description: newDesc || null, color: newColor })
      .select()
      .single()
    if (data) {
      setGroups((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
      setNewDesc('')
    }
    setCreating(false)
  }

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group? All permissions will be removed.')) return
    const sb = getSupabaseClient()
    await sb.from('groups').delete().eq('id', id)
    setGroups((prev) => prev.filter((g) => g.id !== id))
    setMembers((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const toggleMember = async (groupId: string, userId: string) => {
    const sb = getSupabaseClient()
    const current = members[groupId] ?? []
    const isMember = current.includes(userId)

    if (isMember) {
      await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId)
      setMembers((prev) => ({ ...prev, [groupId]: (prev[groupId] ?? []).filter((id) => id !== userId) }))
    } else {
      await sb.from('group_members').insert({ group_id: groupId, user_id: userId })
      setMembers((prev) => ({ ...prev, [groupId]: [...(prev[groupId] ?? []), userId] }))
    }
  }

  if (loading) return <div className="p-4 text-muted-foreground text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      {/* Create group */}
      <div className="rounded-xl border border-border/60 bg-accent/10 p-4">
        <h3 className="mb-3 font-semibold text-sm">New group</h3>
        <form className="flex flex-wrap items-end gap-3" onSubmit={createGroup}>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Name *</label>
            <input
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Hydraulics"
              required
              value={newName}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Description</label>
            <input
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none"
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
              value={newDesc}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Color</label>
            <input
              className="h-[32px] w-[48px] cursor-pointer rounded border border-border/50"
              onChange={(e) => setNewColor(e.target.value)}
              type="color"
              value={newColor}
            />
          </div>
          <button
            className="rounded-lg bg-foreground px-4 py-1.5 text-background text-sm font-medium disabled:opacity-50"
            disabled={creating || !newName.trim()}
            type="submit"
          >
            Create
          </button>
        </form>
      </div>

      {/* Groups list */}
      <div className="flex flex-col gap-4">
        {groups.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-8">No groups yet.</p>
        )}
        {groups.map((group) => {
          const groupMembers = members[group.id] ?? []
          return (
            <div className="rounded-xl border border-border/60 p-4" key={group.id}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: group.color ?? '#6366f1' }}
                  />
                  <span className="font-semibold">{group.name}</span>
                  {group.description && (
                    <span className="text-muted-foreground text-xs">— {group.description}</span>
                  )}
                </div>
                <button
                  className="rounded-md px-2 py-1 text-red-400 text-xs hover:bg-red-500/10"
                  onClick={() => deleteGroup(group.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {users.map((user) => {
                  const isMember = groupMembers.includes(user.id)
                  return (
                    <button
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isMember
                          ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                          : 'bg-accent/30 text-muted-foreground hover:bg-accent/60'
                      }`}
                      key={user.id}
                      onClick={() => toggleMember(group.id, user.id)}
                      type="button"
                    >
                      {user.display_name || user.id.slice(0, 8)}
                    </button>
                  )
                })}
                {users.length === 0 && (
                  <span className="text-muted-foreground text-xs">No users yet</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
