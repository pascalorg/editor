'use client'

import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { BuildingTools } from './building-tools'
import { ControlModes } from './control-modes'
import { ViewToggles } from './view-toggles'

export function ActionMenu({ className }: { className?: string }) {
  const controlMode = useEditor((state) => state.controlMode)
  const showBuildingTools = controlMode === 'building'

  // Delayed state for exit animation
  const [shouldRender, setShouldRender] = useState(showBuildingTools)
  const [isVisible, setIsVisible] = useState(showBuildingTools)

  useEffect(() => {
    if (showBuildingTools) {
      setShouldRender(true)
      // Small delay to trigger enter animation
      requestAnimationFrame(() => setIsVisible(true))
    } else {
      setIsVisible(false)
      // Wait for exit animation before unmounting
      const timeout = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showBuildingTools])

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed bottom-6 left-1/2 z-50',
          'rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md',
          'transition-all duration-200 ease-out', // Smooth container resizing
          className,
        )}
      >
        {/* Building Tools Row - Animated */}
        {shouldRender && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isVisible
                ? 'max-h-20 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <div className="w-max">
              <BuildingTools />
            </div>
          </div>
        )}

        {/* Control Mode Row - Always visible, centered */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          <ControlModes />
          <div className="mx-1 h-5 w-px bg-zinc-700" />
          <ViewToggles />
        </div>
      </div>
    </TooltipProvider>
  )
}
