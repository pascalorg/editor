'use client'

import type { PluginStatus } from '@pascal-app/core'
import { AlertCircle, Check, Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PluginStatusBadgeProps {
  status: PluginStatus
  className?: string
}

export function PluginStatusBadge({ status, className }: PluginStatusBadgeProps) {
  switch (status) {
    case 'installed':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-400 text-xs',
            className,
          )}
        >
          <Check className="h-3.5 w-3.5" />
          Yüklendi
        </span>
      )
    case 'loading':
      return (
        <span
          className={cn(
            'inline-flex animate-pulse items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-400 text-xs',
            className,
          )}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Yükleniyor...
        </span>
      )
    case 'error':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 font-medium text-rose-400 text-xs',
            className,
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Hata
        </span>
      )
    case 'unloaded':
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/60 px-2.5 py-0.5 font-medium text-muted-foreground text-xs',
            className,
          )}
        >
          <Download className="h-3.5 w-3.5" />
          Kullanılabilir
        </span>
      )
  }
}
