'use client'

import { emitter } from '@pascal-app/core'
import { RotateCcw, RotateCw, Rotate3D } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives/tooltip'

export function CameraActions() {
  const goToTopView = () => {
    emitter.emit('camera-controls:top-view')
  }

  const orbitCW = () => {
    emitter.emit('camera-controls:orbit-cw')
  }

  const orbitCCW = () => {
    emitter.emit('camera-controls:orbit-ccw')
  }

  return (
    <div className="flex items-center gap-1">
      {/* Orbit CCW */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="h-8 w-8 text-zinc-400 transition-all hover:text-sky-400"
            onClick={orbitCCW}
            size="icon"
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Orbit Left</p>
        </TooltipContent>
      </Tooltip>

      {/* Orbit CW */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="h-8 w-8 text-zinc-400 transition-all hover:text-sky-400"
            onClick={orbitCW}
            size="icon"
            variant="ghost"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Orbit Right</p>
        </TooltipContent>
      </Tooltip>

      {/* Top View */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="h-8 w-8 text-zinc-400 transition-all hover:text-sky-400"
            onClick={goToTopView}
            size="icon"
            variant="ghost"
          >
            <Rotate3D className="h-4 w-4 -rotate-90" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Top View</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
