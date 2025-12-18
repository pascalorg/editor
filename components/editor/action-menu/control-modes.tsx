'use client'

import { Hammer, Image, MousePointer2, Paintbrush, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type ControlMode, type EditorMode, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

type ModeConfig = {
  id: ControlMode
  icon: typeof MousePointer2
  label: string
  shortcut: string
  color: string
  activeColor: string
}

// All available control modes
const allModes: ModeConfig[] = [
  {
    id: 'select',
    icon: MousePointer2,
    label: 'Select',
    shortcut: 'V',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'edit',
    icon: Pencil,
    label: 'Edit',
    shortcut: 'E',
    color: 'hover:bg-orange-500/20 hover:text-orange-400',
    activeColor: 'bg-orange-500/20 text-orange-400',
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
    label: 'Build',
    shortcut: 'B',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'painting',
    icon: Paintbrush,
    label: 'Painting',
    shortcut: 'P',
    color: 'hover:bg-cyan-500/20 hover:text-cyan-400',
    activeColor: 'bg-cyan-500/20 text-cyan-400',
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

// Define which modes are available in each editor mode
const modesByEditorMode: Record<EditorMode, ControlMode[]> = {
  site: ['select', 'edit'], // Site: select (building) and edit (property line)
  structure: ['select', 'delete', 'building', 'guide'], // Structure: select, delete, build, guide
  furnish: ['select', 'delete', 'building', 'painting'], // Furnish: select, delete, build, painting
}

export function ControlModes() {
  const controlMode = useEditor((state) => state.controlMode)
  const editorMode = useEditor((state) => state.editorMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const lastBuildingTool = useEditor((state) => state.lastBuildingTool)
  const lastCatalogCategory = useEditor((state) => state.lastCatalogCategory)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  // Get available modes for current editor mode
  const availableModeIds = modesByEditorMode[editorMode]
  const availableModes = allModes.filter((m) => availableModeIds.includes(m.id))

  const handleModeClick = (mode: ControlMode) => {
    if (mode === 'building') {
      // Restore the last used building tool and catalog category
      setActiveTool(lastBuildingTool, lastCatalogCategory)
    } else {
      setControlMode(mode)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {availableModes.map((mode) => {
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
              </p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
