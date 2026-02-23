'use client'

import { ImageIcon, MessageSquare, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useScene } from '@pascal-app/core'
import {
  createImageUploadUrls,
  submitFeedback,
} from '@/features/community/lib/feedback/actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Button } from '@/components/ui/primitives/button'

const MAX_IMAGES = 5
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

type ImagePreview = { file: File; url: string }

export function FeedbackDialog({ projectId: projectIdProp }: { projectId?: string }) {
  const params = useParams()
  const projectId = projectIdProp ?? (params?.projectId as string | undefined)

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
    images.forEach((img) => URL.revokeObjectURL(img.url))
  }

  const addFiles = useCallback(
    (files: FileList | File[]) => {
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
    },
    [],
  )

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
      // Capture scene graph snapshot
      let sceneGraph: unknown = null
      try {
        const { nodes, rootNodeIds } = useScene.getState()
        sceneGraph = { nodes, rootNodeIds }
      } catch {
        // Scene store may not be available (e.g. on non-editor pages)
      }

      // Upload images directly to Supabase Storage via signed URLs
      let imagePaths: string[] = []

      if (images.length > 0) {
        const urlResult = await createImageUploadUrls(
          images.map((img) => ({ name: img.file.name, type: img.file.type })),
        )

        if (!urlResult.success) {
          setError(urlResult.error)
          return
        }

        // Upload each file directly to Supabase (bypasses Vercel size limit)
        const uploadResults = await Promise.allSettled(
          urlResult.uploads.map(async ({ path, signedUrl }, i) => {
            const file = images[i]?.file
            if (!file) return null

            const res = await fetch(signedUrl, {
              method: 'PUT',
              headers: { 'Content-Type': file.type },
              body: file,
            })

            if (!res.ok) {
              console.error(`Upload failed for ${file.name}: ${res.status}`)
              return null
            }

            return path
          }),
        )

        imagePaths = uploadResults
          .filter(
            (r): r is PromiseFulfilledResult<string> =>
              r.status === 'fulfilled' && r.value !== null,
          )
          .map((r) => r.value)
      }

      const result = await submitFeedback({
        message,
        projectId,
        sceneGraph,
        imagePaths,
      })

      if (result.success) {
        setSent(true)
        setTimeout(() => setOpen(false), 1500)
      } else {
        setError(result.error)
      }
    } finally {
      setIsSubmitting(false)
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
        <DialogContent
          className="sm:max-w-[460px] relative"
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Drag overlay — only visible when dragging files over the dialog */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 backdrop-blur-sm transition-all">
              <div className="flex flex-col items-center gap-2 text-primary/70">
                <ImageIcon className="h-8 w-8" />
                <p className="text-sm font-medium">Drop images here</p>
              </div>
            </div>
          )}

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

              {/* Image thumbnails */}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <div
                      key={img.url}
                      className="group relative h-14 w-14 overflow-hidden rounded-md border border-border"
                    >
                      <img
                        src={img.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X className="h-4 w-4 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-between">
                {/* Subtle attach button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting || images.length >= MAX_IMAGES}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  {images.length > 0
                    ? `${images.length}/${MAX_IMAGES}`
                    : 'Attach'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting || !message.trim()}>
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
