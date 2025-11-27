'use client'

import { StackIcon } from '@phosphor-icons/react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

export function ViewToggles() {
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn('h-8 w-8 text-zinc-400 transition-all hover:bg-zinc-800')}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn('h-8 w-8 text-zinc-400 transition-all hover:bg-zinc-800')}
            onClick={toggleLevelMode}
            size="icon"
            variant="ghost"
          >
            <StackIcon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Levels: {levelMode === 'stacked' ? 'Stacked' : 'Exploded'} (L)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

