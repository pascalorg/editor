'use client'

import type { SceneGraph } from '@pascal-app/editor'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'

const EMPTY_GRAPH: SceneGraph = {
  nodes: {},
  rootNodeIds: [],
}

interface SaveButtonProps {
  sceneId: string
  name: string
  version: number
  getGraph: () => SceneGraph | null
}

/**
 * Creates a new empty scene and navigates the user to it.
 */
export function CreateSceneButton({ label = 'Create new project' }: { label?: string } = {}) {
  const router = useRouter()
  const { user, openAuth } = useSession()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!user) {
      openAuth()
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled project', graph: EMPTY_GRAPH }),
      })
      if (response.status === 401) {
        openAuth()
        return
      }
      if (!response.ok) {
        setError(`Failed to create project (${response.status})`)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setIsCreating(false)
    }
  }, [router, user, openAuth])

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive text-xs">{error}</span>}
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={isCreating}
        onClick={handleCreate}
        type="button"
      >
        {isCreating ? 'Creating…' : label}
      </button>
    </div>
  )
}

/**
 * Save + Save-as buttons that call the scenes API directly.
 * Used for UIs that want explicit save controls outside of the Editor's
 * built-in autosave plumbing.
 */
export function SaveButton({ sceneId, name, version, getGraph }: SaveButtonProps) {
  const router = useRouter()
  const { user, openAuth } = useSession()
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!user) {
      openAuth()
      return
    }
    const graph = getGraph()
    if (!graph) {
      setStatus('No project to save')
      return
    }
    setIsSaving(true)
    setStatus(null)
    try {
      const response = await fetch(`/api/scenes/${sceneId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(version),
        },
        body: JSON.stringify({ name, graph }),
      })
      if (response.status === 401) {
        openAuth()
        return
      }
      if (response.status === 409) {
        setStatus('Conflict — reload to continue')
        return
      }
      if (!response.ok) {
        setStatus(`Save failed (${response.status})`)
        return
      }
      setStatus('Saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, sceneId, version, user, openAuth])

  const handleSaveAs = useCallback(async () => {
    if (!user) {
      openAuth()
      return
    }
    const graph = getGraph()
    if (!graph) {
      setStatus('No project to save')
      return
    }
    const newName = typeof window !== 'undefined' ? window.prompt('New project name', name) : null
    if (!newName) return
    setIsSaving(true)
    setStatus(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, graph }),
      })
      if (response.status === 401) {
        openAuth()
        return
      }
      if (!response.ok) {
        setStatus(`Save-as failed (${response.status})`)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save-as failed')
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, router, user, openAuth])

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSave}
        type="button"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSaveAs}
        type="button"
      >
        Save as…
      </button>
      {status && <span className="text-muted-foreground text-xs">{status}</span>}
    </div>
  )
}
