'use client'

import { Building2, Map, Sofa } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type EditorMode, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const editorModes: Array<{
  id: EditorMode
  icon: typeof Map
  label: string
  shortcut: string
  description: string
  color: string
  activeColor: string
}> = [
  {
    id: 'site',
    icon: Map,
    label: 'Site',
    shortcut: '1',
    description: 'Edit terrain, place buildings, set boundaries',
    color: 'hover:bg-emerald-500/20 hover:text-emerald-400',
    activeColor: 'bg-emerald-500/20 text-emerald-400',
  },
  {
    id: 'structure',
    icon: Building2,
    label: 'Structure',
    shortcut: '2',
    description: 'Walls, rooms, doors, windows, stairs',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'furnish',
    icon: Sofa,
    label: 'Furnish',
    shortcut: '3',
    description: 'Place furniture, appliances, decorations',
    color: 'hover:bg-amber-500/20 hover:text-amber-400',
    activeColor: 'bg-amber-500/20 text-amber-400',
  },
]

export function ModeSwitcher() {
  const editorMode = useEditor((state) => state.editorMode)
  const setEditorMode = useEditor((state) => state.setEditorMode)

  return (
    <div className="flex items-center gap-1">
      {editorModes.map((mode) => {
        const Icon = mode.icon
        const isActive = editorMode === mode.id

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
                onClick={() => setEditorMode(mode.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">
                {mode.label} ({mode.shortcut})
              </p>
              <p className="text-xs text-zinc-400">{mode.description}</p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
