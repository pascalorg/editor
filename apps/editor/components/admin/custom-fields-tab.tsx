'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { CustomField, CustomFieldPermission, Group } from '@/lib/supabase-types'

export function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [cfPerms, setCfPerms] = useState<CustomFieldPermission[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<CustomField['field_type']>('text')
  const [newKind, setNewKind] = useState('*')
  const [newOptions, setNewOptions] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const nodeKinds = useMemo(() => {
    const kinds = ['*']
    for (const [kind] of nodeRegistry.entries()) {
      kinds.push(kind)
    }
    return kinds.sort()
  }, [])

  const load = async () => {
    const sb = getSupabaseClient()
    const [fRes, gRes, cpRes] = await Promise.all([
      sb.from('custom_fields').select('*').order('sort_order').order('label'),
      sb.from('groups').select('*').order('name'),
      sb.from('custom_field_permissions').select('*'),
    ])
    setFields(fRes.data ?? [])
    setGroups(gRes.data ?? [])
    setCfPerms(cpRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createField = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    const sb = getSupabaseClient()

    const key = newKey.trim().toLowerCase().replace(/\s+/g, '_')
    let options = null
    if (newType === 'enum' && newOptions.trim()) {
      options = newOptions.split(',').map((o) => o.trim()).filter(Boolean)
    }

    const { data, error } = await sb
      .from('custom_fields')
      .insert({
        key,
        label: newLabel.trim(),
        field_type: newType,
        node_kind: newKind,
        options,
        unit: newUnit.trim() || null,
        sort_order: fields.length,
      })
      .select()
      .single()

    if (error) {
      setCreateError(error.message)
    } else if (data) {
      setFields((prev) => [...prev, data])
      setNewKey('')
      setNewLabel('')
      setNewOptions('')
      setNewUnit('')
    }
    setCreating(false)
  }

  const deleteField = async (id: string) => {
    if (!confirm('Delete this custom field?')) return
    const sb = getSupabaseClient()
    await sb.from('custom_fields').delete().eq('id', id)
    setFields((prev) => prev.filter((f) => f.id !== id))
  }

  const toggleGroupPerm = async (fieldId: string, groupId: string) => {
    const sb = getSupabaseClient()
    const existing = cfPerms.find((p) => p.custom_field_id === fieldId && p.group_id === groupId)
    if (existing) {
      await sb.from('custom_field_permissions').delete().eq('id', existing.id)
      setCfPerms((prev) => prev.filter((p) => p.id !== existing.id))
    } else {
      const { data } = await sb
        .from('custom_field_permissions')
        .insert({ custom_field_id: fieldId, group_id: groupId, can_write: true })
        .select()
        .single()
      if (data) setCfPerms((prev) => [...prev, data])
    }
  }

  if (loading) return <div className="p-4 text-muted-foreground text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      {/* Create form */}
      <div className="rounded-xl border border-border/60 bg-accent/10 p-4">
        <h3 className="mb-3 font-semibold text-sm">New custom field</h3>
        <form className="flex flex-wrap items-end gap-3" onSubmit={createField}>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Label *</label>
            <input
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none"
              onChange={(e) => { setNewLabel(e.target.value); if (!newKey) setNewKey(e.target.value) }}
              placeholder="Nota Fiscal"
              required
              value={newLabel}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Key *</label>
            <input
              className="rounded-lg border border-border/50 bg-background px-3 py-1.5 font-mono text-sm focus:outline-none"
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="nota_fiscal"
              required
              value={newKey}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Type</label>
            <select
              className="rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
              onChange={(e) => setNewType(e.target.value as CustomField['field_type'])}
              value={newType}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Boolean</option>
              <option value="enum">Enum</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Node kind</label>
            <select
              className="rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
              onChange={(e) => setNewKind(e.target.value)}
              value={newKind}
            >
              {nodeKinds.map((k) => (
                <option key={k} value={k}>{k === '*' ? 'All kinds' : k}</option>
              ))}
            </select>
          </div>
          {newType === 'enum' && (
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Options (comma-separated)</label>
              <input
                className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm"
                onChange={(e) => setNewOptions(e.target.value)}
                placeholder="opt1, opt2, opt3"
                value={newOptions}
              />
            </div>
          )}
          {newType === 'number' && (
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Unit</label>
              <input
                className="w-20 rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm"
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="m³/h"
                value={newUnit}
              />
            </div>
          )}
          <button
            className="rounded-lg bg-foreground px-4 py-1.5 text-background text-sm font-medium disabled:opacity-50"
            disabled={creating || !newLabel.trim() || !newKey.trim()}
            type="submit"
          >
            Create
          </button>
        </form>
        {createError && <p className="mt-2 text-red-400 text-xs">{createError}</p>}
      </div>

      {/* Fields list */}
      <div className="flex flex-col gap-4">
        {fields.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-4">No custom fields yet.</p>
        )}
        {fields.map((field) => (
          <div className="rounded-xl border border-border/60 p-4" key={field.id}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-semibold">{field.label}</span>
                <code className="rounded bg-accent/40 px-1.5 py-0.5 font-mono text-xs">{field.key}</code>
                <span className="rounded-full border border-border/40 bg-accent/20 px-2 py-0.5 text-muted-foreground text-xs">
                  {field.field_type}{field.unit ? ` (${field.unit})` : ''}
                </span>
                <span className="text-muted-foreground text-xs">{field.node_kind === '*' ? 'All nodes' : field.node_kind}</span>
              </div>
              <button
                className="text-red-400 text-xs hover:underline"
                onClick={() => deleteField(field.id)}
                type="button"
              >
                Delete
              </button>
            </div>
            <div>
              <p className="mb-1.5 text-muted-foreground text-xs">Groups with write access:</p>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const granted = cfPerms.some(
                    (p) => p.custom_field_id === field.id && p.group_id === g.id,
                  )
                  return (
                    <button
                      className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                        granted
                          ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
                          : 'bg-accent/30 text-muted-foreground hover:bg-accent/60'
                      }`}
                      key={g.id}
                      onClick={() => toggleGroupPerm(field.id, g.id)}
                      type="button"
                    >
                      {g.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
