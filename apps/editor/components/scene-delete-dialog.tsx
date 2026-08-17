'use client'

import { useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneModal } from './scene-modal'

export function SceneDeleteDialog({
  scene,
  onClose,
  onDeleted,
}: {
  scene: SceneMeta
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        setError(`Silinemedi (${response.status})`)
        return
      }
      onDeleted()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SceneModal onClose={onClose} title="Sahneyi sil">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          <span className="font-medium text-foreground">{scene.name}</span> silinsin mi? Bu geri
          alınamaz.
        </p>
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
            className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => void confirm()}
            type="button"
          >
            {busy ? 'Siliniyor…' : 'Sil'}
          </button>
        </div>
      </div>
    </SceneModal>
  )
}
