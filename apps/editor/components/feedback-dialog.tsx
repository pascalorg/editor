'use client'

import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { submitFeedback } from '@/features/community/lib/feedback/actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Button } from '@/components/ui/primitives/button'

export function FeedbackDialog() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleOpen = () => {
    setOpen(true)
    setSent(false)
    setError(null)
    setMessage('')
  }

  const handleClose = () => {
    if (isSubmitting) return
    setOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const result = await submitFeedback(message)
    setIsSubmitting(false)
    if (result.success) {
      setSent(true)
      setTimeout(() => setOpen(false), 1500)
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-md hover:bg-accent/50 transition-colors"
      >
        <MessageSquare className="h-4 w-4" />
        Feedback
      </button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>We&apos;d love to hear your thoughts</DialogDescription>
          </DialogHeader>

          {sent ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Thanks for your feedback!
            </p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="feedback-message" className="text-sm font-medium">
                  Your feedback
                </label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share your thoughts, suggestions, feature requests, or report issues..."
                  rows={5}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !message.trim()}>
                  {isSubmitting ? 'Sending...' : 'Send Feedback'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
