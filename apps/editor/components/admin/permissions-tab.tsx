'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { Group, ParameterPermission } from '@/lib/supabase-types'

export function PermissionsTab() {
  const [groups, setGroups] = useState<Group[]>([])
  const [permissions, setPermissions] = useState<ParameterPermission[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Collect all node kinds + parametric fields from the registry
  const nodeKinds = useMemo(() => {
    const kinds: Array<{
      kind: string
      label: string
      fields: Array<{ key: string; label: string }>
    }> = []
    for (const [kind, def] of nodeRegistry.entries()) {
      const parametrics = def.parametrics
      if (!parametrics) continue
      const fields = parametrics.groups.flatMap((g) =>
        g.fields.map((f) => ({
          key: String(f.key),
          label: prettify(String(f.key)),
        })),
      )
      if (fields.length === 0) continue
      kinds.push({
        kind,
        label: def.presentation?.label ?? kind,
        fields,
      })
    }
    return kinds.sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const load = async () => {
    const sb = getSupabaseClient()
    const [gRes, pRes] = await Promise.all([
      sb.from('groups').select('*').order('name'),
      sb.from('parameter_permissions').select('*'),
    ])
    const gs = gRes.data ?? []
    setGroups(gs)
    setPermissions(pRes.data ?? [])
    if (gs.length > 0 && !selectedGroup) setSelectedGroup(gs[0]!.id)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const isGranted = (nodeKind: string, paramKey: string) => {
    if (!selectedGroup) return false
    return permissions.some(
      (p) =>
        p.group_id === selectedGroup &&
        (p.node_kind === nodeKind || p.node_kind === '*') &&
        (p.parameter_key === paramKey || p.parameter_key === '*') &&
        p.can_write,
    )
  }

  const toggle = async (nodeKind: string, paramKey: string) => {
    if (!selectedGroup) return
    const sb = getSupabaseClient()
    const existing = permissions.find(
      (p) => p.group_id === selectedGroup && p.node_kind === nodeKind && p.parameter_key === paramKey,
    )

    if (existing) {
      const newVal = !existing.can_write
      await sb.from('parameter_permissions').update({ can_write: newVal }).eq('id', existing.id)
      setPermissions((prev) =>
        prev.map((p) => (p.id === existing.id ? { ...p, can_write: newVal } : p)),
      )
    } else {
      const { data } = await sb
        .from('parameter_permissions')
        .insert({ group_id: selectedGroup, node_kind: nodeKind, parameter_key: paramKey, can_write: true })
        .select()
        .single()
      if (data) setPermissions((prev) => [...prev, data])
    }
  }

  const toggleAllForKind = async (nodeKind: string, fields: string[]) => {
    if (!selectedGroup) return
    const allGranted = fields.every((f) => isGranted(nodeKind, f))
    const sb = getSupabaseClient()

    if (allGranted) {
      // Revoke all
      await sb
        .from('parameter_permissions')
        .delete()
        .eq('group_id', selectedGroup)
        .eq('node_kind', nodeKind)
      setPermissions((prev) =>
        prev.filter((p) => !(p.group_id === selectedGroup && p.node_kind === nodeKind)),
      )
    } else {
      // Grant all not yet granted
      const toAdd = fields
        .filter((f) => !isGranted(nodeKind, f))
        .map((f) => ({ group_id: selectedGroup, node_kind: nodeKind, parameter_key: f, can_write: true }))
      if (toAdd.length > 0) {
        const { data } = await sb.from('parameter_permissions').insert(toAdd).select()
        if (data) setPermissions((prev) => [...prev, ...data])
      }
    }
  }

  if (loading) return <div className="p-4 text-muted-foreground text-sm">Loading…</div>
  if (groups.length === 0) return (
    <p className="text-center text-muted-foreground text-sm py-8">
      Create a group first in the Groups tab.
    </p>
  )

  return (
    <div className="flex gap-6">
      {/* Group selector sidebar */}
      <div className="w-44 shrink-0">
        <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">Group</p>
        <div className="flex flex-col gap-1">
          {groups.map((g) => (
            <button
              className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                selectedGroup === g.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              }`}
              key={g.id}
              onClick={() => setSelectedGroup(g.id)}
              type="button"
            >
              <span
                className="mr-2 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: g.color ?? '#6366f1' }}
              />
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Permissions matrix */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        {nodeKinds.length === 0 && (
          <p className="text-muted-foreground text-sm">No node kinds with parametrics found.</p>
        )}
        <div className="flex flex-col gap-4">
          {nodeKinds.map(({ kind, label, fields }) => {
            const allGranted = fields.every((f) => isGranted(kind, f.key))
            return (
              <div className="rounded-xl border border-border/60 p-4" key={kind}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-sm">{label}</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => toggleAllForKind(kind, fields.map((f) => f.key))}
                    type="button"
                  >
                    {allGranted ? 'Revoke all' : 'Grant all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {fields.map((field) => {
                    const granted = isGranted(kind, field.key)
                    return (
                      <button
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          granted
                            ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
                            : 'bg-accent/30 text-muted-foreground hover:bg-accent/60'
                        }`}
                        key={field.key}
                        onClick={() => toggle(kind, field.key)}
                        type="button"
                      >
                        {field.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function prettify(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}
