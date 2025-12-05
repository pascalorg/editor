'use client'

import { StackIcon } from '@phosphor-icons/react'
import { Box, Camera, Clock, Eye, Moon, ScanLine, Sun, Sunrise, Sunset } from 'lucide-react'
import SunCalc from 'suncalc'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const TIME_PRESETS = ['now', 'dawn', 'day', 'dusk', 'night'] as const
type TimePreset = (typeof TIME_PRESETS)[number]

const PRESET_ICONS: Record<TimePreset, React.ReactNode> = {
  now: <Clock className="h-4 w-4" />,
  dawn: <Sunrise className="h-4 w-4" />,
  day: <Sun className="h-4 w-4" />,
  dusk: <Sunset className="h-4 w-4" />,
  night: <Moon className="h-4 w-4" />,
}

const PRESET_LABELS: Record<TimePreset, string> = {
  now: 'Current Time',
  dawn: 'Dawn',
  day: 'Noon',
  dusk: 'Dusk',
  night: 'Night',
}

export function ViewerControls({ className }: { className?: string }) {
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)
  const setViewerDisplayMode = useEditor((state) => state.setViewerDisplayMode)

  const { timePreset, timeMode, latitude, longitude } = useEditor(
    useShallow((state) => {
      const env = state.scene.root.environment
      return {
        timePreset: env.timePreset,
        timeMode: env.timeMode,
        latitude: env.latitude,
        longitude: env.longitude,
      }
    }),
  )

  // Determine current preset - if timeMode is 'now' or no preset, default to 'now'
  const currentPreset: TimePreset =
    timeMode === 'now' || !timePreset ? 'now' : (timePreset as TimePreset)

  const cycleTimePreset = () => {
    const currentIndex = TIME_PRESETS.indexOf(currentPreset)
    const nextIndex = (currentIndex + 1) % TIME_PRESETS.length
    const nextPreset = TIME_PRESETS[nextIndex]

    if (nextPreset === 'now') {
      useEditor.setState((state) => ({
        scene: {
          ...state.scene,
          root: {
            ...state.scene.root,
            environment: {
              ...state.scene.root.environment,
              timeMode: 'now',
              timePreset: 'now',
            },
          },
        },
      }))
    } else {
      const times = SunCalc.getTimes(new Date(), latitude, longitude)
      const timeMap: Record<Exclude<TimePreset, 'now'>, number> = {
        dawn: times.dawn.getTime(),
        day: times.solarNoon.getTime(),
        dusk: times.dusk.getTime(),
        night: times.nadir.getTime(),
      }

      useEditor.setState((state) => ({
        scene: {
          ...state.scene,
          root: {
            ...state.scene.root,
            environment: {
              ...state.scene.root.environment,
              timeMode: 'custom',
              timePreset: nextPreset,
              staticTime: timeMap[nextPreset],
            },
          },
        },
      }))
    }
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed top-4 left-1/2 z-50 flex items-center gap-1 rounded-lg border p-1',
          'border-gray-800 bg-[#1b1c1f] shadow-lg backdrop-blur-sm',
          'text-white',
          'opacity-70 transition-opacity hover:opacity-100',
          className,
        )}
      >
        {/* Viewer Mode Label */}
        <div className="flex items-center gap-2 px-3">
          <Eye className="h-4 w-4 text-blue-400" />
          <span className="font-medium text-sm">Viewer</span>
        </div>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-gray-700" />

        {/* Camera toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
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

        {/* Exploded/Stacked toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
              onClick={toggleLevelMode}
              size="icon"
              variant="ghost"
            >
              <StackIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Level mode: {levelMode === 'stacked' ? 'Stacked' : 'Exploded'} (L)</p>
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-gray-700" />

        {/* Scans/3D Objects toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                viewerDisplayMode === 'scans' && 'bg-blue-600/20 text-blue-400',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
              onClick={() =>
                setViewerDisplayMode(viewerDisplayMode === 'scans' ? 'objects' : 'scans')
              }
              size="icon"
              variant="ghost"
            >
              {viewerDisplayMode === 'scans' ? (
                <ScanLine className="h-4 w-4" />
              ) : (
                <Box className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Display: {viewerDisplayMode === 'scans' ? 'Scans' : '3D Objects'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-gray-700" />

        {/* Time of day preset toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-8 w-8 transition-all',
                currentPreset !== 'now' && 'bg-amber-600/20 text-amber-400',
                'text-white hover:bg-gray-800 hover:text-white',
              )}
              onClick={cycleTimePreset}
              size="icon"
              variant="ghost"
            >
              {PRESET_ICONS[currentPreset]}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Time: {PRESET_LABELS[currentPreset]}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
