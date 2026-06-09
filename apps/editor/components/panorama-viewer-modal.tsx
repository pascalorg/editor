'use client'

import { Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type PhotoSphereViewer = {
  destroy: () => void
}

interface PanoramaViewerModalProps {
  imageUrl: string
  onClose: () => void
}

export function PanoramaViewerModal({ imageUrl, onClose }: PanoramaViewerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<PhotoSphereViewer | null>(null)
  const [mounted, setMounted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mounted, onClose])

  useEffect(() => {
    if (!mounted || !containerRef.current) return

    let cancelled = false
    setLoadError(null)

    async function initViewer() {
      try {
        const { Viewer } = await import('@photo-sphere-viewer/core')
        if (cancelled || !containerRef.current) return

        viewerRef.current?.destroy()
        viewerRef.current = new Viewer({
          container: containerRef.current,
          panorama: imageUrl,
          caption: 'Panorama Photo',
          defaultZoomLvl: 35,
          mousewheel: true,
          navbar: ['zoom', 'move', 'fullscreen'],
          loadingTxt: 'Loading panorama...',
        }) as PhotoSphereViewer
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load panorama viewer')
        }
      }
    }

    void initViewer()

    return () => {
      cancelled = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [mounted, imageUrl])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black text-white">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-white/15 bg-black/55 px-3 py-2 text-white/75 text-xs backdrop-blur md:flex">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          Drag to look around. Scroll to zoom.
        </div>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-black/65 text-white transition-colors hover:bg-white/15"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" aria-hidden />
          <span className="sr-only">Close panorama viewer</span>
        </button>
      </div>
      <div className="h-full w-full" ref={containerRef} />
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6">
          <div className="max-w-md rounded-md border border-white/15 bg-black/70 p-4 text-center shadow-xl">
            <h2 className="font-semibold text-base">Unable to open panorama</h2>
            <p className="mt-2 text-sm text-white/70">{loadError}</p>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
