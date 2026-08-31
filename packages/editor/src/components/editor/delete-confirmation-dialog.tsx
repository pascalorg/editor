'use client'

import { useEffect } from 'react'
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
          <DialogTitle>Delete {request?.count ?? 0} elements?</DialogTitle>
          <DialogDescription>
            This removes every selected element. You can undo the deletion while it remains in the
            editor history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
            onClick={confirm}
            type="button"
          >
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
