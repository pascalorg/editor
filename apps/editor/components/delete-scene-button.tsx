'use client'

import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/i18n'

export function DeleteSceneButton({
  sceneId,
  sceneName,
  version,
}: {
  sceneId: string
  sceneName: string
  version: number
}) {
  const router = useRouter()
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, {
        method: 'DELETE',
        headers: { 'If-Match': `"${version}"` },
      })

      if (!response.ok && response.status !== 404) {
        setError(
          t('scenes.deleteFailed', {
            fallback: 'Delete failed ({status})',
            params: { status: response.status },
          }),
        )
        return
      }

      setIsConfirmOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scenes.deleteFailedGeneric', 'Delete failed'))
    } finally {
      setIsDeleting(false)
    }
  }, [router, sceneId, version])

  return (
    <>
      <button
        aria-label={t('scenes.deleteScene', 'Delete scene')}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground opacity-0 shadow-sm transition hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
        disabled={isDeleting}
        onClick={() => {
          setError(null)
          setIsConfirmOpen(true)
        }}
        title={t('scenes.deleteScene', 'Delete scene')}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
      {isConfirmOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-2xl">
              <h2 className="font-semibold text-base text-foreground">
                {t('scenes.deleteScene', 'Delete scene')}
              </h2>
              <p className="mt-2 text-muted-foreground text-sm leading-5">
                {t('scenes.confirmDelete', {
                  fallback: 'Delete scene "{name}"? This cannot be undone.',
                  params: { name: sceneName },
                })}
              </p>
              {error && <p className="mt-3 text-destructive text-xs">{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40 disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={() => setIsConfirmOpen(false)}
                  type="button"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-medium text-destructive text-sm hover:bg-destructive/15 disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  type="button"
                >
                  {isDeleting ? t('common.deleting', 'Deleting...') : t('common.delete', 'Delete')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
