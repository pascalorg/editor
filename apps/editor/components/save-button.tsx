'use client'

import type { SceneGraph } from '@pascal-app/editor/scene'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { t } from '@/i18n'

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
export function CreateSceneButton({ label }: { label?: string } = {}) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const buttonLabel = label ?? t('scenes.createNewScene', 'Create new scene')

  const handleCreate = useCallback(async () => {
    setIsCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t('save.untitledScene', 'Untitled scene'),
          graph: EMPTY_GRAPH,
        }),
      })
      if (!response.ok) {
        setError(
          t('save.createFailed', {
            fallback: 'Failed to create scene ({status})',
            params: { status: response.status },
          }),
        )
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('save.createFailedGeneric', 'Failed to create scene'),
      )
    } finally {
      setIsCreating(false)
    }
  }, [router])

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive text-xs">{error}</span>}
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={isCreating}
        onClick={handleCreate}
        type="button"
      >
        {isCreating ? t('common.creating', 'Creating…') : buttonLabel}
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
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus(t('save.noSceneToSave', 'No scene to save'))
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
        setStatus(t('save.conflictReload', 'Conflict — reload to continue'))
        return
      }
      if (!response.ok) {
        setStatus(
          t('save.saveFailed', {
            fallback: 'Save failed ({status})',
            params: { status: response.status },
          }),
        )
        return
      }
      setStatus(t('common.saved', 'Saved'))
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t('save.saveFailed', { fallback: 'Save failed ({status})', params: { status: '' } }),
      )
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, sceneId, version])

  const handleSaveAs = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus(t('save.noSceneToSave', 'No scene to save'))
      return
    }
    const newName =
      typeof window !== 'undefined'
        ? window.prompt(t('save.newSceneName', 'New scene name'), name)
        : null
    if (!newName) return
    setIsSaving(true)
    setStatus(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, graph }),
      })
      if (!response.ok) {
        setStatus(
          t('save.saveAsFailed', {
            fallback: 'Save-as failed ({status})',
            params: { status: response.status },
          }),
        )
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t('save.saveAsFailed', { fallback: 'Save-as failed ({status})', params: { status: '' } }),
      )
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, router])

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSave}
        type="button"
      >
        {isSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
      </button>
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSaveAs}
        type="button"
      >
        {t('common.saveAs', 'Save as…')}
      </button>
      {status && <span className="text-muted-foreground text-xs">{status}</span>}
    </div>
  )
}
