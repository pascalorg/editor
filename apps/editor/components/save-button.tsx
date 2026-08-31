'use client'

import type { SceneGraph } from '@pascal-app/editor'
import { useLocale, messages } from '@pascal-app/editor'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

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

const t = (key: string, locale: string) => {
  const msgs = messages[locale as keyof typeof messages] as Record<string, string>
  return msgs[key] || key
}

/**
 * Creates a new empty scene and navigates the user to it.
 */
export function CreateSceneButton({ label }: { label?: string } = {}) {
  const router = useRouter()
  const { locale } = useLocale()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    setIsCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('untitledScene', locale), graph: EMPTY_GRAPH }),
      })
      if (!response.ok) {
        setError(`${t('failedToCreateScene', locale)} (${response.status})`)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToCreateScene', locale))
    } finally {
      setIsCreating(false)
    }
  }, [locale, router])

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive text-xs">{error}</span>}
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm text-foreground hover:bg-accent/80 disabled:opacity-50"
        disabled={isCreating}
        onClick={handleCreate}
        type="button"
      >
        {isCreating ? t('creating', locale) : label ?? t('createNewScene', locale)}
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
  const { locale } = useLocale()
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus(t('noSceneToSave', locale))
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
        setStatus(t('conflictReload', locale))
        return
      }
      if (!response.ok) {
        setStatus(`${t('saveFailed', locale)} (${response.status})`)
        return
      }
      setStatus(t('saved', locale))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('saveFailed', locale))
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, locale, name, sceneId, version])

  const handleSaveAs = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus(t('noSceneToSave', locale))
      return
    }
    const newName = typeof window !== 'undefined' ? window.prompt(t('newSceneName', locale), name) : null
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
        setStatus(`${t('saveAsFailed', locale)} (${response.status})`)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('saveAsFailed', locale))
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, locale, name, router])

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSave}
        type="button"
      >
        {isSaving ? t('saving', locale) : t('save', locale)}
      </button>
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSaveAs}
        type="button"
      >
        {t('saveAs', locale)}
      </button>
      {status && <span className="text-muted-foreground text-xs">{status}</span>}
    </div>
  )
}
