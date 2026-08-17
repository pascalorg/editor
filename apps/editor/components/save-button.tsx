'use client'

import { type SceneGraph, useTranslation } from '@pascal-app/editor'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { authClient } from '@/lib/auth-client'

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
export function CreateSceneButton({ label = 'Create new scene' }: { label?: string } = {}) {
  const t = useTranslation()
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: session } = authClient.useSession()
  const handleCreate = useCallback(async () => {
    setIsCreating(true)
    setError(null)
    try {
      if (!session) {
        const { error: signInError } = await authClient.signIn.anonymous()
        if (signInError) {
          setError('Failed to initialize anonymous session')
          setIsCreating(false)
          return
        }
      }

      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled scene', graph: EMPTY_GRAPH }),
      })
      if (!response.ok) {
        let msg = `Failed to create scene (${response.status})`
        try {
          const errData = await response.json()
          if (errData.details && typeof errData.details === 'string') msg = errData.details
        } catch {}
        setError(msg)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scene')
    } finally {
      setIsCreating(false)
    }
  }, [router, session])

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive text-xs">{t(error)}</span>}
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={isCreating}
        onClick={handleCreate}
        type="button"
      >
        {isCreating ? t('Creating…') : t(label)}
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
  const t = useTranslation()
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus('No scene to save')
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
  }, [getGraph, name, sceneId, version])

  const { data: session } = authClient.useSession()

  const handleSaveAs = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus('No scene to save')
      return
    }
    const newName = typeof window !== 'undefined' ? window.prompt('New scene name', name) : null
    if (!newName) return
    setIsSaving(true)
    setStatus(null)
    try {
      if (!session) {
        const { error: signInError } = await authClient.signIn.anonymous()
        if (signInError) {
          setStatus('Failed to initialize anonymous session')
          setIsSaving(false)
          return
        }
      }

      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, graph }),
      })
      if (!response.ok) {
        let msg = `Save-as failed (${response.status})`
        try {
          const errData = await response.json()
          if (errData.details && typeof errData.details === 'string') msg = errData.details
        } catch {}
        setStatus(msg)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save-as failed')
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, router, session])

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSave}
        type="button"
      >
        {isSaving ? t('Saving…') : t('Save')}
      </button>
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSaveAs}
        type="button"
      >
        {t('Save as…')}
      </button>
      {status && <span className="text-muted-foreground text-xs">{t(status)}</span>}
    </div>
  )
}
