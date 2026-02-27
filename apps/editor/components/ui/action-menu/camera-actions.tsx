'use client'

import { emitter } from '@pascal-app/core'
import Image from 'next/image'
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
            className="group h-9 w-9 text-muted-foreground transition-all hover:bg-white/5"
            onClick={orbitCCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt="Orbit Left"
              className="h-[30px] w-[30px] object-contain opacity-70 transition-opacity group-hover:opacity-100 -scale-x-100"
              height={30}
              src="/icons/rotate.png"
              width={30}
            />
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
            className="group h-9 w-9 text-muted-foreground transition-all hover:bg-white/5"
            onClick={orbitCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt="Orbit Right"
              className="h-[30px] w-[30px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={30}
              src="/icons/rotate.png"
              width={30}
            />
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
            className="group h-9 w-9 text-muted-foreground transition-all hover:bg-white/5"
            onClick={goToTopView}
            size="icon"
            variant="ghost"
          >
            <Image
              alt="Top View"
              className="h-[30px] w-[30px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={30}
              src="/icons/topview.png"
              width={30}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Top View</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
