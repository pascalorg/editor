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

export function ViewToggles() {
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const levelMode = useViewer((state) => state.levelMode)
  const setLevelMode = useViewer((state) => state.setLevelMode)
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

  return (
    <div className="flex items-center gap-1">
      {/* Camera Mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-zinc-400 transition-all',
              cameraMode === 'orthographic'
                ? 'bg-violet-500/20 text-violet-400'
                : 'hover:bg-zinc-800',
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
              'h-8 w-8 text-zinc-400 transition-all',
              levelMode !== 'stacked'
                ? 'bg-amber-500/20 text-amber-400'
                : 'hover:bg-zinc-800',
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

      {/* Show Scans */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'h-8 w-8 text-zinc-400 transition-all',
              showScans
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'hover:bg-zinc-800',
            )}
            onClick={() => setShowScans(!showScans)}
            size="icon"
            variant="ghost"
          >
            <Box className="h-4 w-4" />
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
              'h-8 w-8 text-zinc-400 transition-all',
              showGuides
                ? 'bg-purple-500/20 text-purple-400'
                : 'hover:bg-zinc-800',
            )}
            onClick={() => setShowGuides(!showGuides)}
            size="icon"
            variant="ghost"
          >
            <Image className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Guides: {showGuides ? 'Visible' : 'Hidden'}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
