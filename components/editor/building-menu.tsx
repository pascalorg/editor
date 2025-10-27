'use client'

import { BoundingBoxIcon, type Icon, LineSegmentsIcon, WallIcon } from '@phosphor-icons/react'
import { Blinds, Circle, DoorOpen, Pyramid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { type Tool, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
export function BuildingMenu() {
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const controlMode = useEditor((state) => state.controlMode)

  const tools: Array<{ id: Tool; icon: Icon | typeof Pyramid; label: string; enabled: boolean }> = [
    { id: 'wall', icon: WallIcon, label: 'Wall', enabled: true },
    { id: 'room', icon: BoundingBoxIcon, label: 'Room', enabled: true },
    { id: 'custom-room', icon: LineSegmentsIcon, label: 'Custom Room', enabled: true },
    { id: 'roof', icon: Pyramid, label: 'Gable Roof', enabled: true },
    { id: 'door', icon: DoorOpen, label: 'Door', enabled: false },
    { id: 'window', icon: Blinds, label: 'Window', enabled: false },
    { id: 'dummy1', icon: Circle, label: 'Tool 1', enabled: false },
    { id: 'dummy2', icon: Circle, label: 'Tool 2', enabled: false },
  ]

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed bottom-8 left-1/2 z-50 flex items-center gap-2',
          'rounded-lg border bg-background/95 shadow-lg backdrop-blur-sm',
          'opacity-70 transition-opacity hover:opacity-100',
          'p-2',
          controlMode !== 'building' && 'cursor-not-allowed',
        )}
      >
        {tools.map((tool) => {
          const Icon = tool.icon
          // Only show as active if the tool is selected AND we're in building mode
          const isActive = activeTool === tool.id && controlMode === 'building'

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  className={cn(
                    'size-10 transition-all',
                    tool.enabled ? 'font-extrabold text-primary' : 'text-gray-500',
                    isActive && tool.enabled && 'bg-primary text-primary-foreground',
                    controlMode !== 'building' && activeTool !== tool.id && 'opacity-50',
                  )}
                  disabled={!tool.enabled}
                  onClick={() => {
                    // If clicking the currently active tool in building mode, deselect it
                    if (activeTool === tool.id && controlMode === 'building') {
                      setActiveTool(null)
                    } else if (tool.enabled) {
                      // Otherwise, select this tool (which automatically switches to building mode)
                      setActiveTool(tool.id)
                    } else {
                      // Otherwise, do nothing
                      return
                    }
                  }}
                  size="icon"
                  variant={isActive && tool.enabled ? 'default' : 'ghost'}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {tool.label}
                  {isActive && ' (Click to deselect)'}
                  {controlMode !== 'building' &&
                    activeTool !== tool.id &&
                    ' (Click to switch to building mode)'}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
