'use client'

import { Building2, Layers, Map as MapIcon, Settings } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type PanelId = 'site' | 'zones' | 'collections' | 'settings'

interface IconRailProps {
  activePanel: PanelId
  onPanelChange: (panel: PanelId) => void
  className?: string
}

const panels: { id: PanelId; icon: typeof Building2; label: string }[] = [
  { id: 'site', icon: Building2, label: 'Site' },
  { id: 'zones', icon: MapIcon, label: 'Zones' },
  { id: 'collections', icon: Layers, label: 'Collections' },
  { id: 'settings', icon: Settings, label: 'Settings' },
]

export function IconRail({ activePanel, onPanelChange, className }: IconRailProps) {
  return (
    <div
      className={cn(
        'flex w-11 flex-col items-center gap-1 border-border/50 border-r py-2',
        className,
      )}
    >
      {panels.map((panel) => {
        const Icon = panel.icon
        const isActive = activePanel === panel.id
        return (
          <Tooltip key={panel.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onClick={() => onPanelChange(panel.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{panel.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export { panels }
