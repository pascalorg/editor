'use client'

import { Hammer, Image, MousePointer2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type ControlMode, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const modes: Array<{
  id: ControlMode
  icon: typeof MousePointer2
  label: string
  shortcut: string
  color: string
  activeColor: string
}> = [
  {
    id: 'select',
    icon: MousePointer2,
    label: 'Select',
    shortcut: 'V',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'delete',
    icon: Trash2,
    label: 'Delete',
    shortcut: 'D',
    color: 'hover:bg-red-500/20 hover:text-red-400',
    activeColor: 'bg-red-500/20 text-red-400',
  },
  {
    id: 'building',
    icon: Hammer,
    label: 'Building',
    shortcut: 'B',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'guide',
    icon: Image,
    label: 'Guide',
    shortcut: 'G',
    color: 'hover:bg-purple-500/20 hover:text-purple-400',
    activeColor: 'bg-purple-500/20 text-purple-400',
  },
]

export function ControlModes() {
  const controlMode = useEditor((state) => state.controlMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  const handleModeClick = (mode: ControlMode) => {
    if (mode === 'building' && !activeTool) {
      setActiveTool('wall')
    } else {
      setControlMode(mode)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {modes.map((mode) => {
        const Icon = mode.icon
        const isActive = controlMode === mode.id

        return (
          <Tooltip key={mode.id}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'h-8 w-8 transition-all',
                  'text-zinc-400',
                  !isActive && mode.color,
                  isActive && mode.activeColor,
                )}
                onClick={() => handleModeClick(mode.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {mode.label} ({mode.shortcut})
                {isActive && mode.id !== 'select' && ' • Esc to exit'}
              </p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

