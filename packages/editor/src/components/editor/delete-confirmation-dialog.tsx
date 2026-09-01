'use client'

import { useEffect } from 'react'
import { useTranslations } from '../../lib/i18n'
import useDeleteConfirmation from '../../store/use-delete-confirmation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/primitives/dialog'

export function DeleteConfirmationDialog() {
  const t = useTranslations()
  const request = useDeleteConfirmation((state) => state.request)
  const cancel = useDeleteConfirmation((state) => state.cancel)
  const confirm = useDeleteConfirmation((state) => state.confirm)

  useEffect(() => cancel, [cancel])

  return (
    <Dialog onOpenChange={(open) => !open && cancel()} open={request !== null}>
      <DialogContent
        className="border-border/70 bg-background/95 shadow-2xl backdrop-blur-xl sm:max-w-md"
        data-delete-confirmation-dialog
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t('dialog.deleteElements.title', { count: request?.count ?? 0 })}</DialogTitle>
          <DialogDescription>{t('dialog.deleteElements.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            onClick={cancel}
            type="button"
          >
            {t('editor.cancel')}
          </button>
          <button
            className="rounded-full bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
            onClick={confirm}
            type="button"
          >
            {t('editor.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
