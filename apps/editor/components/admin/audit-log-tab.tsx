'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { AuditLogEntry } from '@/lib/supabase-types'

const PAGE_SIZE = 50

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ sceneId: '', userId: '', nodeKind: '', action: '' })
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const load = async (reset = true) => {
    setLoading(true)
    const sb = getSupabaseClient()
    let q = sb
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(reset ? 0 : page * PAGE_SIZE, (reset ? 0 : page) * PAGE_SIZE + PAGE_SIZE - 1)

    if (filter.sceneId) q = q.eq('scene_id', filter.sceneId)
    if (filter.userId) q = q.eq('user_id', filter.userId)
    if (filter.nodeKind) q = q.eq('node_kind', filter.nodeKind)
    if (filter.action) q = q.eq('action', filter.action as AuditLogEntry['action'])

    const { data } = await q
    const rows = data ?? []
    if (reset) {
      setEntries(rows)
      setPage(0)
    } else {
      setEntries((prev) => [...prev, ...rows])
    }
    setHasMore(rows.length === PAGE_SIZE)
    setLoading(false)
  }

  useEffect(() => { load(true) }, [filter])

  const formatValue = (v: AuditLogEntry['old_value']): string => {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  const actionColor = (action: string) => {
    if (action === 'create') return 'text-green-400'
    if (action === 'delete') return 'text-red-400'
    return 'text-blue-400'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {[
          { key: 'sceneId', placeholder: 'Scene ID' },
          { key: 'nodeKind', placeholder: 'Node kind (e.g. wall)' },
          { key: 'userId', placeholder: 'User ID' },
        ].map(({ key, placeholder }) => (
          <input
            className="rounded-lg border border-border/50 bg-accent/20 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
            key={key}
            onChange={(e) => setFilter((prev) => ({ ...prev, [key]: e.target.value }))}
            placeholder={placeholder}
            value={filter[key as keyof typeof filter]}
          />
        ))}
        <select
          className="rounded-lg border border-border/50 bg-accent/20 px-3 py-1.5 text-sm"
          onChange={(e) => setFilter((prev) => ({ ...prev, action: e.target.value }))}
          value={filter.action}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
      </div>

      {loading && entries.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">No entries found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-border/60 border-b bg-accent/20 text-muted-foreground">
                <th className="px-3 py-2.5 text-left">When</th>
                <th className="px-3 py-2.5 text-left">Who</th>
                <th className="px-3 py-2.5 text-left">Action</th>
                <th className="px-3 py-2.5 text-left">Node</th>
                <th className="px-3 py-2.5 text-left">Field</th>
                <th className="px-3 py-2.5 text-left">Before</th>
                <th className="px-3 py-2.5 text-left">After</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr className="border-border/40 border-b last:border-0 hover:bg-accent/10" key={e.id}>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{e.user_name}</td>
                  <td className={`px-3 py-2.5 font-semibold uppercase tracking-wide ${actionColor(e.action)}`}>
                    {e.action}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono">{e.node_kind}</span>
                    <span className="ml-1 text-muted-foreground">{e.node_id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{e.field_key ?? '—'}</td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-muted-foreground">
                    {formatValue(e.old_value)}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2.5">
                    {formatValue(e.new_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <button
          className="rounded-lg border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          onClick={() => {
            setPage((p) => p + 1)
            load(false)
          }}
          type="button"
        >
          Load more
        </button>
      )}
    </div>
  )
}
