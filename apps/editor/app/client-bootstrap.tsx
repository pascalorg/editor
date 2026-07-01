'use client'

// Loads `@pascal-app/nodes`' built-in plugin into the node registry on the
// client. Mounted from `layout.tsx` so every page in the standalone
// editor gets the registry populated before its first `<Viewer>` /
// `<Editor>` mounts — without this the registry is empty on the client
// (the server registers in its own module instance, which is unreachable
// from hydrated pages) and every `NodeRenderer` resolves to `null`. The
// `loaded` guard inside `../lib/bootstrap` keeps the side effect
// idempotent under HMR.
import '../lib/bootstrap'
import { type ReactNode, useEffect } from 'react'
import { useAuth } from '@/store/use-auth'
import { usePermissions } from '@/store/use-permissions'
import { getSupabaseClient } from '@/lib/supabase'

export function ClientBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    // Loaded here (not via a `<Script>` tag in <head>) to avoid React's
    // "script inside a React component" hydration warning. The package
    // is already a direct dep, so we don't need the CDN auto-global.
    import('react-scan').then(({ scan }) => scan({ enabled: true }))
  }, [])

  useEffect(() => {
    // Initialize auth session and subscribe to changes.
    useAuth.getState().init()

    // When auth state changes, reload permissions for the user's groups.
    const sb = getSupabaseClient()
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: memberRows } = await sb
          .from('group_members')
          .select('group_id')
          .eq('user_id', session.user.id)
        const groupIds = (memberRows ?? []).map((r) => r.group_id)
        await usePermissions.getState().loadForGroups(groupIds)
      } else {
        usePermissions.getState().clear()
      }
    })
    return () => { subscription.unsubscribe() }
  }, [])

  return children
}
