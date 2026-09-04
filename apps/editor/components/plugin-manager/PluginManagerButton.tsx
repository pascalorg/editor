'use client'

import { pluginManager } from '@pascal-app/core'
import { Blocks, Puzzle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/toolbar-tooltip'
import { usePluginManager } from '@/lib/plugins/use-plugin-manager'
import { cn } from '@/lib/utils'

interface PluginManagerButtonProps {
  className?: string
  variant?: 'toolbar' | 'icon' | 'labeled'
}

export function PluginManagerButton({
  className,
  variant = 'toolbar',
}: PluginManagerButtonProps) {
  const setModalOpen = usePluginManager((s) => s.setModalOpen)

  const snapshot = useSyncExternalStore(
    pluginManager.subscribe,
    pluginManager.getSnapshot,
    pluginManager.getSnapshot,
  )

  const installedCount = Object.values(snapshot.states).filter(
    (p) => p.status === 'installed',
  ).length

  if (variant === 'labeled') {
    return (
      <button
        className={cn(
          'inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-1.5 font-medium text-foreground text-xs shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground',
          className,
        )}
        onClick={() => setModalOpen(true)}
        type="button"
      >
        <Blocks className="h-4 w-4 text-primary" />
        <span>Eklentiler</span>
        {installedCount > 0 && (
          <span className="rounded-full bg-primary/20 px-1.5 py-0.2 font-semibold text-[10px] text-primary">
            {installedCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Eklenti Yöneticisi"
          className={cn(
            'relative flex h-8 w-8 items-center justify-center text-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground',
            className,
          )}
          onClick={() => setModalOpen(true)}
          type="button"
        >
          <Puzzle className="h-4 w-4" />
          {installedCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary font-bold text-[8px] text-primary-foreground shadow-sm">
              {installedCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Eklenti Yöneticisi (Plugins)</TooltipContent>
    </Tooltip>
  )
}
