'use client'

import { MousePointer2, Trash2, Hammer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useEditorContext, type ControlMode } from '@/hooks/use-editor'

export function ControlModeMenu({ className }: { className?: string }) {
  const { controlMode, setControlMode, activeTool } = useEditorContext()

  const modes: Array<{ id: ControlMode; icon: typeof MousePointer2; label: string; shortcut: string; color: string }> = [
    { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-600/30 hover:text-blue-400' },
    { id: 'delete', icon: Trash2, label: 'Delete', shortcut: 'D', color: 'bg-red-500/20 text-red-400 border-red-500/50 hover:bg-red-600/30 hover:text-red-400' },
    { id: 'building', icon: Hammer, label: 'Building', shortcut: 'Tool', color: 'bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-600/30 hover:text-green-400' },
  ]

  return (
    <TooltipProvider>
      <div className={cn(
        'fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 border rounded-lg p-1 ', 
        'bg-[#1b1c1f] backdrop-blur-sm border-gray-800 shadow-lg',
        'text-white',
        className,
        )}> 
        {modes.map((mode) => {
          const Icon = mode.icon
          const isActive = controlMode === mode.id
          const isDisabled = mode.id === 'building' && !activeTool
          
          return (
            <Tooltip key={mode.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="icon"
                  onClick={() => setControlMode(mode.id)}
                  className={cn(
                    'h-8 w-8 transition-all',
                    'text-white hover:text-white hover:bg-gray-800',
                    isActive && mode.color,
                    isDisabled && 'opacity-50 cursor-not-allowed'
                  )}
                  disabled={isDisabled}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {mode.label} Mode
                  {mode.id === 'select' && ' (V)'}
                  {mode.id === 'delete' && ' (D)'}
                  {mode.id === 'building' && !activeTool && ' (Select a tool first)'}
                  {mode.id === 'building' && activeTool && ' (Active)'}
                  {isActive && mode.id !== 'select' && ' • Press Esc to exit'}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

