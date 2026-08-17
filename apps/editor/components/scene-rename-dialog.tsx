'use client'

import { type FormEvent, useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneModal } from './scene-modal'

export function SceneRenameDialog({
  scene,
  onClose,
  onRenamed,
}: {
  scene: SceneMeta
  onClose: () => void
  onRenamed: () => void
}) {
  const [name, setName] = useState(scene.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 200) {
      setError('Ad 1 ile 200 karakter arasında olmalı.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        setError(`Yeniden adlandırılamadı (${response.status})`)
        return
      }
      onRenamed()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yeniden adlandırılamadı')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SceneModal onClose={onClose} title="Yeniden adlandır">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <input
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          placeholder="Sahne adı"
          value={name}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            Vazgeç
          </button>
          <button
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </SceneModal>
  )
}
