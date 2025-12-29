'use client'

import { StackIcon } from '@phosphor-icons/react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor, type WallMode } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const wallModeConfig: Record<
  WallMode,
  { icon: React.FC<React.ComponentProps<'img'>>; label: string }
> = {
  up: {
    icon: (props) => (
      <img alt="Full Height" height={20} src="/icons/room.png" width={20} {...props} />
    ),
    label: 'Full Height',
  },
  cutaway: {
    icon: (props) => (
      <img alt="Cutaway" height={20} src="/icons/wallcut.png" width={20} {...props} />
    ),
    label: 'Cutaway',
  },
  down: {
    icon: (props) => <img alt="Low" height={20} src="/icons/walllow.png" width={20} {...props} />,
    label: 'Low',
  },
}

export function ViewToggles() {
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const wallMode = useEditor((state) => state.wallMode)
  const toggleWallMode = useEditor((state) => state.toggleWallMode)

  const WallModeIcon = wallModeConfig[wallMode].icon

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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn('h-8 w-8 text-zinc-400 transition-all hover:bg-zinc-800')}
            onClick={toggleWallMode}
            size="icon"
            variant="ghost"
          >
            <WallModeIcon className="size-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Walls: {wallModeConfig[wallMode].label} (W)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
