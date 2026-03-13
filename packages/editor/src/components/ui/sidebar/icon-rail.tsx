'use client'

import { useViewer } from '@pascal-app/viewer'
import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './../../../components/ui/primitives/tooltip'
import { cn } from './../../../lib/utils'

export type PanelId = 'site' | 'settings'

interface IconRailProps {
  activePanel: PanelId
  onPanelChange: (panel: PanelId) => void
  appMenuButton?: ReactNode
  className?: string
}

const panels: { id: PanelId; iconSrc: string; label: string }[] = [
  { id: 'site', iconSrc: '/icons/level.png', label: 'Site' },
  { id: 'settings', iconSrc: '/icons/settings.png', label: 'Settings' },
]

export function IconRail({ activePanel, onPanelChange, appMenuButton, className }: IconRailProps) {
  const theme = useViewer((state) => state.theme)
  const setTheme = useViewer((state) => state.setTheme)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div
      className={cn(
        'flex h-full w-11 flex-col items-center gap-1 border-border/50 border-r py-2',
        className,
      )}
    >
      {/* App menu slot */}
      {appMenuButton}

      {/* Divider */}
      <div className="mb-1 h-px w-8 bg-border/50" />

      {panels.map((panel) => {
        const isActive = activePanel === panel.id
        return (
          <Tooltip key={panel.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-all',
                  isActive ? 'bg-accent' : 'hover:bg-accent',
                )}
                onClick={() => onPanelChange(panel.id)}
                type="button"
              >
                <img
                  alt={panel.label}
                  className={cn(
                    'h-6 w-6 object-contain transition-all',
                    !isActive && 'opacity-50 saturate-0',
                  )}
                  src={panel.iconSrc}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{panel.label}</TooltipContent>
          </Tooltip>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme Toggle */}
      {mounted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-accent/40 text-foreground transition-all hover:bg-accent"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
            >
              <motion.div
                animate={{ rotate: 0, opacity: 1 }}
                initial={{ rotate: -90, opacity: 0 }}
                key={theme}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </motion.div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle theme</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

export { panels }
