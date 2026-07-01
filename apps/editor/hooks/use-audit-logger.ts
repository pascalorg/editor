'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/lib/supabase-types'
import { useAuth } from '@/store/use-auth'

type AuditInsert = Database['public']['Tables']['audit_log']['Insert']

/**
 * Subscribes to useScene and logs node create/update/delete to the
 * Supabase audit_log table. Mount once in the scene page.
 */
export function useAuditLogger(sceneId: string) {
  useEffect(() => {
    const unsubscribe = useScene.subscribe((state, prevState) => {
      const { user, profile } = useAuth.getState()
      if (!user) return

      const userName = profile?.display_name || user.email || 'Unknown'
      const curr = state.nodes as Record<string, unknown>
      const prev = prevState.nodes as Record<string, unknown>
      const sb = getSupabaseClient()

      const entries: AuditInsert[] = []

      // Detect creations
      for (const id of Object.keys(curr)) {
        if (!prev[id]) {
          const node = curr[id] as Record<string, unknown>
          entries.push({
            user_id: user.id,
            user_name: userName,
            scene_id: sceneId,
            node_id: id,
            node_kind: String(node['type'] ?? 'unknown'),
            node_label: null,
            action: 'create',
            field_key: null,
            field_label: null,
            old_value: null,
            new_value: node as unknown as AuditInsert['new_value'],
          })
        }
      }

      // Detect deletions
      for (const id of Object.keys(prev)) {
        if (!curr[id]) {
          const node = prev[id] as Record<string, unknown>
          entries.push({
            user_id: user.id,
            user_name: userName,
            scene_id: sceneId,
            node_id: id,
            node_kind: String(node['type'] ?? 'unknown'),
            node_label: null,
            action: 'delete',
            field_key: null,
            field_label: null,
            old_value: node as unknown as AuditInsert['old_value'],
            new_value: null,
          })
        }
      }

      // Detect field updates
      for (const id of Object.keys(curr)) {
        if (!prev[id]) continue // already logged as create
        const currNode = curr[id] as Record<string, unknown>
        const prevNode = prev[id] as Record<string, unknown>
        if (currNode === prevNode) continue

        for (const key of Object.keys(currNode)) {
          if (key === 'id' || key === 'type' || key === 'object') continue
          const oldVal = prevNode[key]
          const newVal = currNode[key]
          if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue

          entries.push({
            user_id: user.id,
            user_name: userName,
            scene_id: sceneId,
            node_id: id,
            node_kind: String(currNode['type'] ?? 'unknown'),
            node_label: null,
            action: 'update',
            field_key: key,
            field_label: null,
            old_value: (oldVal ?? null) as AuditInsert['old_value'],
            new_value: (newVal ?? null) as AuditInsert['new_value'],
          })
        }
      }

      if (entries.length > 0) {
        // Fire-and-forget: don't block the render on audit writes
        sb.from('audit_log').insert(entries).then(() => {})
      }
    })

    return unsubscribe
  }, [sceneId])
}
