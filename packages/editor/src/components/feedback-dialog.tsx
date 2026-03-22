'use client'

import { useScene } from '@vesper/core'
import { ImageIcon, MessageSquare, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button } from './ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/primitives/dialog'

const MAX_IMAGES = 5
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

type ImagePreview = { file: File; url: string }

export function FeedbackDialog({
  projectId: projectIdProp,
  onSubmit,
}: {
  projectId?: string
  onSubmit?: (data: {
    message: string
    projectId?: string
    sceneGraph: unknown
    images: File[]
  }) => Promise<{ success: boolean; error?: string }>
}) {
  const projectId = projectIdProp

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<ImagePreview[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const handleOpen = () => {
    setOpen(true)
    setSent(false)
    setError(null)
    setMessage('')
    setImages([])
    setIsDragging(false)
    dragCounter.current = 0
  }

  const handleClose = () => {
    if (isSubmitting) return
    setOpen(false)
    images.forEach((img) => {
      URL.revokeObjectURL(img.url)
    })
  }

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter(
      (f) => f.type.startsWith('image/') && f.size <= MAX_IMAGE_SIZE,
    )
    setImages((prev) => {
      const remaining = MAX_IMAGES - prev.length
      const added = incoming.slice(0, remaining).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }))
      return [...prev, ...added]
    })
  }, [])

  const removeImage = (index: number) => {
    setImages((prev) => {
      const img = prev[index]
      if (img) URL.revokeObjectURL(img.url)
      return prev.filter((_, i) => i !== index)
    })
  }

  // ── Drag handlers (on the entire dialog content) ──
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      if (!onSubmit) return
      const { nodes, rootNodeIds } = useScene.getState()
      const sceneGraph = { nodes, rootNodeIds }
      const result = await onSubmit({
        message,
        projectId,
        sceneGraph,
        images: images.map((img) => img.file),
      })
      if (result.success) {
        setSent(true)
        setTimeout(() => setOpen(false), 1500)
      } else {
        setError(result.error ?? 'Something went wrong')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 font-medium text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent/90"
        onClick={handleOpen}
      >
        <MessageSquare className="h-4 w-4" />
        Feedback
      </button>

      <Dialog onOpenChange={handleClose} open={open}>
        <DialogContent
          className="sm:max-w-[460px]"
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Drag overlay — only visible when dragging files over the dialog */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-primary/50 border-dashed bg-primary/5 backdrop-blur-sm transition-all">
              <div className="flex flex-col items-center gap-2 text-primary/70">
                <ImageIcon className="h-8 w-8" />
                <p className="font-medium text-sm">Drop images here</p>
              </div>
            </div>
          )}

          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>We&apos;d love to hear your thoughts</DialogDescription>
          </DialogHeader>

          {sent ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              Thanks for your feedback!
            </p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="font-medium text-sm" htmlFor="feedback-message">
                  Your feedback
                </label>
                <textarea
                  autoFocus
                  className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isSubmitting}
                  id="feedback-message"
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share your thoughts, suggestions, feature requests, or report issues..."
                  rows={5}
                  value={message}
                />
              </div>

              {/* Image thumbnails */}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <div
                      className="group relative h-14 w-14 overflow-hidden rounded-md border border-border"
                      key={img.url}
                    >
                      <img alt="" className="h-full w-full object-cover" src={img.url} />
                      <button
                        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => removeImage(i)}
                        type="button"
                      >
                        <X className="h-4 w-4 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-destructive text-sm">{error}</p>}

              <div className="flex items-center justify-between">
                {/* Subtle attach button */}
                <button
                  className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground disabled:opacity-40"
                  disabled={isSubmitting || images.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  {images.length > 0 ? `${images.length}/${MAX_IMAGES}` : 'Attach'}
                </button>
                <input
                  accept="image/*"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                  ref={fileInputRef}
                  type="file"
                />

                <div className="flex gap-2">
                  <Button
                    disabled={isSubmitting}
                    onClick={handleClose}
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button disabled={isSubmitting || !message.trim() || !onSubmit} type="submit">
                    {isSubmitting ? 'Sending...' : 'Send Feedback'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
