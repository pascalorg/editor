'use client'

import type React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'

export type FloorplanCompassButtonProps = {
  northRotationDeg: number
  onAlignNorth: () => void
  needleRef?: React.RefObject<SVGSVGElement | null>
}

export function FloorplanCompassButton({
  northRotationDeg,
  onAlignNorth,
  needleRef,
}: FloorplanCompassButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Align view to north"
          className="group pointer-events-auto absolute bottom-3 left-3 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/85 shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-neutral-900/85 dark:hover:bg-neutral-900"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onAlignNorth()
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          type="button"
        >
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-[#b8b8b8] shadow-inner dark:bg-neutral-700">
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              ref={needleRef}
              style={{ transform: `rotate(${northRotationDeg}deg)` }}
              viewBox="0 0 48 48"
            >
              <path d="M24 4.5 31.5 25 24 21.5 16.5 25Z" fill="#f15b5b" />
              <path d="M24 43.5 16.5 23 24 26.5 31.5 23Z" fill="#ffffff" />
            </svg>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Align view to north</TooltipContent>
    </Tooltip>
  )
}
