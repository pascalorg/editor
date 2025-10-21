'use client'

import { DoorOpen, Circle, Blinds } from 'lucide-react'
import { WallIcon, type Icon} from '@phosphor-icons/react'
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

  const tools: Array<{ id: Tool; icon: Icon; label: string; enabled: boolean }> = [
    { id: 'wall', icon: WallIcon, label: 'Wall' , enabled: true},
    { id: 'door', icon: DoorOpen, label: 'Door' , enabled: false},
    { id: 'window', icon: Blinds, label: 'Window' , enabled: false},
    { id: 'dummy1', icon: Circle, label: 'Tool 1' , enabled: false},
    { id: 'dummy2', icon: Circle, label: 'Tool 2' , enabled: false},
  ]

  return (
    <TooltipProvider>
      <div className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2", 
        'bg-background/95 backdrop-blur-sm border rounded-lg  shadow-lg',
        'hover:opacity-100 transition-opacity opacity-70',
        'p-2',
        controlMode !== 'building' && 'cursor-not-allowed')}>
        {tools.map((tool) => {
          const Icon = tool.icon
          // Only show as active if the tool is selected AND we're in building mode
          const isActive = activeTool === tool.id && controlMode === 'building'
          
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  disabled={!tool.enabled}
                  variant={isActive && tool.enabled ? 'default' : 'ghost'}
                  size="icon"
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
                  className={cn(
                    'size-10 transition-all',
                    tool.enabled ? 'font-extrabold text-primary' : 'text-gray-500',
                    isActive && tool.enabled && 'bg-primary text-primary-foreground',
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

