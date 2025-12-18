'use client'

import { Building2, PenTool } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type SiteTool, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const siteTools: Array<{
  id: SiteTool
  icon: typeof PenTool
  label: string
}> = [
  {
    id: 'property-line',
    icon: PenTool,
    label: 'Property Line',
  },
  {
    id: 'building-select',
    icon: Building2,
    label: 'Select Building',
  },
]

export function SiteTools() {
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const controlMode = useEditor((state) => state.controlMode)

  return (
    <div className="flex items-center gap-1">
      {siteTools.map((tool) => {
        const Icon = tool.icon
        const isActive =
          (controlMode === 'building' || controlMode === 'build') && activeTool === tool.id

        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'h-10 w-10 transition-all',
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-400',
                )}
                onClick={() => setActiveTool(isActive ? null : tool.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{tool.label}</p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
