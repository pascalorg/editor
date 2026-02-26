'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

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
  const [loaderClass, setLoaderClass] = useState<string | null>(null)

  useEffect(() => {
    // Pick a random loader on mount
    setLoaderClass(LOADERS[Math.floor(Math.random() * LOADERS.length)])
  }, [])

  if (!loaderClass) return null

  return (
    <div 
      className={cn(
        "z-100 flex items-center justify-center bg-background/80 backdrop-blur-md transition-opacity duration-300",
        fullScreen ? "fixed inset-0" : "absolute inset-0",
        className
      )}
    >
       <div className={cn(loaderClass, "text-foreground opacity-80")} />
    </div>
  )
}
