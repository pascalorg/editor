'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { type ControlMode, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { StackIcon } from '@phosphor-icons/react'
import { Camera, Hammer, Image, MousePointer2, Trash2 } from 'lucide-react'

export function ControlModeMenu({
  className,
  onModeChange,
}: {
  className?: string
  onModeChange?: () => void
}) {
  const controlMode = useEditor((state) => state.controlMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  const handleModeClick = (mode: ControlMode) => {
    // Clear any in-progress placement states when switching modes
    onModeChange?.()

    // If switching to building mode without an active tool, default to 'wall'
    if (mode === 'building' && !activeTool) {
      setActiveTool('wall')
    } else {
      setControlMode(mode)
    }
  }

  const modes: Array<{
    id: ControlMode
    icon: typeof MousePointer2
    label: string
    shortcut: string
    color: string
  }> = [
    {
      id: 'select',
      icon: MousePointer2,
      label: 'Select',
      shortcut: 'V',
      color:
        'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-600/30 hover:text-blue-400',
    },
    {
      id: 'delete',
      icon: Trash2,
      label: 'Delete',
      shortcut: 'D',
      color: 'bg-red-500/20 text-red-400 border-red-500/50 hover:bg-red-600/30 hover:text-red-400',
    },
    {
      id: 'building',
      icon: Hammer,
      label: 'Building',
      shortcut: 'B',
      color:
        'bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-600/30 hover:text-green-400',
    },
    {
      id: 'guide',
      icon: Image,
      label: 'Guide',
      shortcut: 'G',
      color:
        'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-600/30 hover:text-purple-400',
    },
  ]

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed top-4 left-1/2 z-50 flex items-center gap-1 rounded-lg border p-1',
          'border-gray-800 bg-[#1b1c1f] shadow-lg backdrop-blur-sm',
          'text-white',
          'opacity-70 transition-opacity hover:opacity-100',
          className,
        )}
      >
        {modes.map((mode) => {
          const Icon = mode.icon
          const isActive = controlMode === mode.id

          return (
            <Tooltip key={mode.id}>
              <TooltipTrigger asChild>
                <Button
                  className={cn(
                    'h-8 w-8 transition-all',
                    'text-white hover:bg-gray-800 hover:text-white',
                    isActive && mode.color,
                  )}
                  onClick={() => handleModeClick(mode.id)}
                  size="icon"
                  variant={isActive ? 'default' : 'ghost'}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {mode.label} Mode
                  {mode.id === 'select' && ' (V)'}
                  {mode.id === 'delete' && ' (D)'}
                  {mode.id === 'building' && ' (B)'}
                  {mode.id === 'guide' && ' (G)'}
                  {isActive && mode.id !== 'select' && ' • Press Esc to exit'}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-gray-700" />

        {/* Camera toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
              onClick={() =>
                setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
              }
              size="icon"
              variant="ghost"
            >
              <Camera className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Camera: {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'} (C)</p>
          </TooltipContent>
        </Tooltip>
        {/* Exploded/Stacked toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
              onClick={toggleLevelMode}
              size="icon"
              variant="ghost"
            >
              <StackIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Level mode: {levelMode === 'stacked' ? 'Stacked' : 'Exploded'} (L)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
