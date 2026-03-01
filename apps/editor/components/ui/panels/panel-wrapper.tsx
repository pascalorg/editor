'use client'

import { cn } from '@/lib/utils'
import { X, RotateCcw, Moon } from 'lucide-react'
import Image from 'next/image'

interface PanelWrapperProps {
  title: string
  icon?: string
  onClose?: () => void
  onReset?: () => void
  children: React.ReactNode
  className?: string
  width?: number | string
}

export function PanelWrapper({
  title,
  icon,
  onClose,
  onReset,
  children,
  className,
  width = 320, // default width
}: PanelWrapperProps) {
  return (
    <div 
      className={cn(
        "pointer-events-auto fixed right-4 top-20 z-50 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-2xl backdrop-blur-xl dark:text-foreground max-h-[calc(100dvh-100px)]",
        className
      )}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          {icon && (
            <Image 
              src={icon} 
              alt="" 
              width={16} 
              height={16} 
              className="shrink-0 object-contain" 
            />
          )}
          <h2 className="font-semibold text-foreground text-sm truncate tracking-tight">
            {title}
          </h2>
        </div>
        
        <div className="flex items-center gap-1">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors bg-[#2C2C2E] hover:bg-[#3e3e3e] hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors bg-[#2C2C2E] hover:bg-[#3e3e3e] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 no-scrollbar flex flex-col">
        {children}
      </div>
    </div>
  )
}
