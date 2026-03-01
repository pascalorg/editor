'use client'

import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface PanelSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
  className?: string
}

export function PanelSection({
  title,
  children,
  defaultExpanded = true,
  className,
}: PanelSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <motion.div 
      layout
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
      className={cn("flex flex-col shrink-0 overflow-hidden border-b border-border/50", className)}
    >
      <motion.button
        layout="position"
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "group/section flex items-center justify-between h-10 px-3 transition-all duration-200 shrink-0",
          isExpanded
            ? "bg-accent/50 text-foreground"
            : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
        )}
      >
        <span className="font-medium text-sm truncate">{title}</span>
        <ChevronDown 
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            isExpanded ? "rotate-180" : "rotate-0",
            isExpanded ? "text-foreground" : "opacity-0 group-hover/section:opacity-100"
          )} 
        />
      </motion.button>
      
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 p-3 pt-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
