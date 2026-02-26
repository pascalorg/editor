'use client'

import { useViewer } from '@pascal-app/viewer'
import { Box, Camera, Diamond, Image, Layers, Layers2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives/tooltip'
import { cn } from '@/lib/utils'

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: 'Stacked',
  exploded: 'Exploded',
  solo: 'Solo',
}

const levelModeOrder: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']

type WallMode = 'up' | 'cutaway' | 'down'

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

const wallModeOrder: WallMode[] = ['cutaway', 'up', 'down']

export function ViewToggles() {
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const levelMode = useViewer((state) => state.levelMode)
  const setLevelMode = useViewer((state) => state.setLevelMode)
  const wallMode = useViewer((state) => state.wallMode)
  const setWallMode = useViewer((state) => state.setWallMode)
  const showScans = useViewer((state) => state.showScans)
  const setShowScans = useViewer((state) => state.setShowScans)
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)

  const toggleCameraMode = () => {
    setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
  }

  const cycleLevelMode = () => {
    if (levelMode === 'manual') {
      setLevelMode('stacked')
      return
    }
    const currentIndex = levelModeOrder.indexOf(levelMode as 'stacked' | 'exploded' | 'solo')
    const nextIndex = (currentIndex + 1) % levelModeOrder.length
    const nextMode = levelModeOrder[nextIndex]
    if (nextMode) setLevelMode(nextMode)
  }

  const cycleWallMode = () => {
    const currentIndex = wallModeOrder.indexOf(wallMode)
    const nextIndex = (currentIndex + 1) % wallModeOrder.length
    const nextMode = wallModeOrder[nextIndex]
    if (nextMode) setWallMode(nextMode)
  }

  return (
    <div className="flex items-center gap-1">
      {/* Camera Mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-muted-foreground transition-all',
              cameraMode === 'orthographic'
                ? 'bg-violet-500/20 text-violet-400'
                : 'hover:text-violet-400',
            )}
            onClick={toggleCameraMode}
            size="icon"
            variant="ghost"
          >
            <Camera className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Camera: {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}</p>
        </TooltipContent>
      </Tooltip>

      {/* Level Mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-muted-foreground transition-all',
              levelMode !== 'stacked'
                ? 'bg-amber-500/20 text-amber-400'
                : 'hover:text-amber-400',
            )}
            onClick={cycleLevelMode}
            size="icon"
            variant="ghost"
          >
            {levelMode === 'solo' && <Diamond className="h-4 w-4" />}
            {levelMode === 'exploded' && <Layers2 className="h-4 w-4" />}
            {(levelMode === 'stacked' || levelMode === 'manual') && <Layers className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Levels: {levelMode === 'manual' ? 'Manual' : levelModeLabels[levelMode as keyof typeof levelModeLabels]}</p>
        </TooltipContent>
      </Tooltip>

      {/* Wall Mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-muted-foreground transition-all p-0',
              wallMode !== 'cutaway'
                ? 'bg-white/10'
                : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5',
            )}
            onClick={cycleWallMode}
            size="icon"
            variant="ghost"
          >
            {(() => {
              const Icon = wallModeConfig[wallMode].icon
              return <Icon className="h-5 w-5" />
            })()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Walls: {wallModeConfig[wallMode].label}</p>
        </TooltipContent>
      </Tooltip>

      {/* Show Scans */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-muted-foreground transition-all p-0',
              showScans
                ? 'bg-white/10'
                : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5',
            )}
            onClick={() => setShowScans(!showScans)}
            size="icon"
            variant="ghost"
          >
            <img alt="Scans" className="h-5 w-5 object-contain" src="/icons/mesh.png" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Scans: {showScans ? 'Visible' : 'Hidden'}</p>
        </TooltipContent>
      </Tooltip>

      {/* Show Guides */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-muted-foreground transition-all p-0',
              showGuides
                ? 'bg-white/10'
                : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5',
            )}
            onClick={() => setShowGuides(!showGuides)}
            size="icon"
            variant="ghost"
          >
            <img alt="Guides" className="h-5 w-5 object-contain" src="/icons/floorplan.png" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Guides: {showGuides ? 'Visible' : 'Hidden'}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
