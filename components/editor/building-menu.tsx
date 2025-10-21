'use client'

import { Box, DoorOpen, RectangleHorizontal, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useEditorContext, type Tool } from '@/hooks/use-editor'

export function BuildingMenu() {
  const { activeTool, setActiveTool, controlMode } = useEditorContext()

  const tools: Array<{ id: Tool; icon: typeof Box; label: string }> = [
    { id: 'wall', icon: Box, label: 'Wall' },
    { id: 'door', icon: DoorOpen, label: 'Door' },
    { id: 'window', icon: RectangleHorizontal, label: 'Window' },
    { id: 'dummy1', icon: Circle, label: 'Tool 1' },
    { id: 'dummy2', icon: Circle, label: 'Tool 2' },
  ]

  return (
    <TooltipProvider>
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background/95 backdrop-blur-sm border rounded-lg px-3 py-2 shadow-lg">
        {tools.map((tool) => {
          const Icon = tool.icon
          // Only show as active if the tool is selected AND we're in building mode
          const isActive = activeTool === tool.id && controlMode === 'building'
          
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="icon"
                  onClick={() => {
                    // If clicking the currently active tool in building mode, deselect it
                    if (activeTool === tool.id && controlMode === 'building') {
                      setActiveTool(null)
                    } else {
                      // Otherwise, select this tool (which automatically switches to building mode)
                      setActiveTool(tool.id)
                    }
                  }}
                  className={cn(
                    'h-10 w-10 transition-all',
                    isActive && 'bg-primary text-primary-foreground',
                    controlMode !== 'building' && activeTool !== tool.id && 'opacity-50'
                  )}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {tool.label}
                  {isActive && ' (Click to deselect)'}
                  {controlMode !== 'building' && activeTool !== tool.id && ' (Click to switch to building mode)'}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

