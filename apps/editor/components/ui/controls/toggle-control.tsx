'use client'

import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface ToggleControlProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function ToggleControl({
  label,
  checked,
  onChange,
  className,
}: ToggleControlProps) {
  return (
    <div 
      className={cn("group flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm transition-colors hover:bg-[#3e3e3e]", className)}
      onClick={() => onChange(!checked)}
    >
      <div className="text-muted-foreground transition-colors group-hover:text-foreground select-none">
        {label}
      </div>
      
      <div 
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-[4px] border transition-all duration-200",
          checked 
            ? "border-primary bg-primary text-primary-foreground" 
            : "border-border bg-black/20 text-transparent group-hover:border-muted-foreground"
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </div>
    </div>
  )
}
