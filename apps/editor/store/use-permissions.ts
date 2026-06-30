'use client'

import { create } from 'zustand'
import { getSupabaseClient } from '@/lib/supabase'
import type { CustomField, ParameterPermission } from '@/lib/supabase-types'

interface PermissionsState {
  /** Flattened set of "nodeKind:paramKey" → writable. Loaded from Supabase. */
  writableFields: Set<string>
  /** Custom fields visible to this user (can be read by anyone in their groups). */
  customFields: CustomField[]
  /** Custom field IDs the user can write to. */
  writableCustomFields: Set<string>
  loaded: boolean

  /** Load permissions for a list of group IDs (called after auth). */
  loadForGroups: (groupIds: string[]) => Promise<void>
  clear: () => void

  /** Returns true if the current user can write this field on this node kind.
   *  Admin bypass handled by the caller checking useAuth().isAdmin(). */
  canWrite: (nodeKind: string, fieldKey: string) => boolean
  canWriteCustomField: (customFieldId: string) => boolean
}

export const usePermissions = create<PermissionsState>((set, get) => ({
  writableFields: new Set(),
  customFields: [],
  writableCustomFields: new Set(),
  loaded: false,

  loadForGroups: async (groupIds) => {
    if (!groupIds.length) {
      set({ writableFields: new Set(), customFields: [], writableCustomFields: new Set(), loaded: true })
      return
    }

    const sb = getSupabaseClient()

    const [permsRes, cfRes, cfPermRes] = await Promise.all([
      sb.from('parameter_permissions').select('*').in('group_id', groupIds),
      sb.from('custom_fields').select('*').order('sort_order'),
      sb.from('custom_field_permissions').select('*').in('group_id', groupIds),
    ])

    const perms: ParameterPermission[] = permsRes.data ?? []
    const allCustomFields: CustomField[] = cfRes.data ?? []
    const cfPerms = cfPermRes.data ?? []

    const writableFields = new Set<string>()
    for (const p of perms) {
      if (p.can_write) {
        writableFields.add(`${p.node_kind}:${p.parameter_key}`)
        // '*' means all fields of this kind
        if (p.parameter_key === '*') writableFields.add(`${p.node_kind}:*`)
      }
    }

    const writableCustomFields = new Set<string>(
      cfPerms.filter((p) => p.can_write).map((p) => p.custom_field_id),
    )

    set({ writableFields, customFields: allCustomFields, writableCustomFields, loaded: true })
  },

  clear: () =>
    set({ writableFields: new Set(), customFields: [], writableCustomFields: new Set(), loaded: false }),

  canWrite: (nodeKind, fieldKey) => {
    const { writableFields } = get()
    return (
      writableFields.has(`${nodeKind}:${fieldKey}`) ||
      writableFields.has(`${nodeKind}:*`) ||
      writableFields.has(`*:${fieldKey}`) ||
      writableFields.has('*:*')
    )
  },

  canWriteCustomField: (customFieldId) => get().writableCustomFields.has(customFieldId),
}))
