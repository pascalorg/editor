'use client'

import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './primitives/button'

const LOADERS = [
  'pascal-loader-1',
  'pascal-loader-2',
  'pascal-loader-3',
  'pascal-loader-4',
  'pascal-loader-5',
]

interface SceneLoaderProps {
  className?: string
  fullScreen?: boolean
}

export function SceneLoader({ className, fullScreen = false }: SceneLoaderProps) {
  const [loaderClass, setLoaderClass] = useState(LOADERS[0]!)

  useEffect(() => {
    // Pick a random loader on mount
    setLoaderClass(LOADERS[Math.floor(Math.random() * LOADERS.length)] ?? LOADERS[0]!)
  }, [])

  return (
    <div
      className={cn(
        'z-100 flex items-center justify-center bg-background/80 backdrop-blur-md transition-opacity duration-300',
        fullScreen ? 'fixed inset-0' : 'absolute inset-0',
        className,
      )}
    >
      <div className={cn(loaderClass, 'text-foreground opacity-80')} />
    </div>
  )
}

interface SceneLoadFailedProps {
  className?: string
  onRetry: () => void
}

/**
 * Replaces the loader when the host could not deliver the scene. Rendered
 * INSTEAD of falling back to an empty default scene: a session that shows
 * scaffold nodes after a failed load autosaves that scaffold over the real
 * project (prod scene-wipe class, 2026-09-02).
 */
export function SceneLoadFailed({ className, onRetry }: SceneLoadFailedProps) {
  return (
    <div
      className={cn(
        'z-100 flex flex-col items-center justify-center gap-4 bg-background/90 px-6 text-center backdrop-blur-md',
        'absolute inset-0',
        className,
      )}
      role="alert"
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground text-sm">This project couldn't be loaded</p>
        <p className="text-muted-foreground text-sm">
          Nothing was changed. Check your connection and try again.
        </p>
      </div>
      <Button className="rounded-full" onClick={onRetry} size="sm" type="button">
        Try again
      </Button>
    </div>
  )
}
