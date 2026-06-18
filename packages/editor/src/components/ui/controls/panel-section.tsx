'use client'

import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useContext, useEffect, useState } from 'react'
import { cn } from '../../../lib/utils'

type PanelSectionExpansionContextValue = {
  pinned: boolean
  resetKey: string
}

export const PanelSectionExpansionContext =
  createContext<PanelSectionExpansionContextValue | null>(null)

interface PanelSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
  className?: string
}

const HIDDEN_INSPECTOR_SECTION_TITLES = new Set(['操作', 'Actions', '鎿嶄綔'])

export function PanelSection({
  title,
  children,
  defaultExpanded = true,
  className,
}: PanelSectionProps) {
  const expansion = useContext(PanelSectionExpansionContext)
  const hasExpansion = !!expansion
  const expansionPinned = expansion?.pinned ?? null
  const expansionResetKey = expansion?.resetKey ?? null
  const preferredExpanded = expansion ? expansion.pinned && defaultExpanded : defaultExpanded
  const [isExpanded, setIsExpanded] = useState(preferredExpanded)

  useEffect(() => {
    if (!hasExpansion) return
    setIsExpanded(expansionPinned === true && defaultExpanded)
  }, [defaultExpanded, expansionPinned, expansionResetKey, hasExpansion])

  if (HIDDEN_INSPECTOR_SECTION_TITLES.has(title)) return null

  return (
    <motion.div
      className={cn('flex shrink-0 flex-col overflow-hidden border-border/50 border-b', className)}
      layout
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
    >
      <motion.button
        className={cn(
          'group/section flex h-10 shrink-0 items-center justify-between px-3 transition-all duration-200',
          isExpanded
            ? 'bg-accent/50 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
        )}
        layout="position"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <span className="truncate font-medium text-sm">{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            isExpanded ? 'rotate-180' : 'rotate-0',
            isExpanded ? 'text-foreground' : 'opacity-0 group-hover/section:opacity-100',
          )}
        />
      </motion.button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          >
            <div className="flex flex-col gap-1.5 p-3 pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
