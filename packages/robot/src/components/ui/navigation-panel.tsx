'use client'

import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Power } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'
import useNavigation from '../../store/use-navigation'
import { Tooltip, TooltipContent, TooltipTrigger } from './primitives/tooltip'

const PANEL_BUTTON_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45'

export function NavigationPanel() {
  const { robotMode, setRobotMode } = useNavigation(
    useShallow((state) => ({
      robotMode: state.robotMode,
      setRobotMode: state.setRobotMode,
    })),
  )
  const setSelection = useViewer((state) => state.setSelection)

  const clearViewerSelectionState = () => {
    const viewerState = useViewer.getState()
    viewerState.setHoveredId(null)
    viewerState.setPreviewSelectedIds([])
    viewerState.setSelection({ selectedIds: [], zoneId: null })
    viewerState.outliner.selectedObjects.length = 0
    viewerState.outliner.hoveredObjects.length = 0
  }

  const handleRobotOff = () => {
    emitter.emit('tool:cancel')
    clearViewerSelectionState()
    setSelection({ selectedIds: [], zoneId: null })
    setRobotMode(null)
  }

  if (!robotMode) {
    return null
  }

  const robotTooltip =
    robotMode === 'normal' ? 'Turn robot off (manual mode).' : 'Turn robot off (task mode).'

  return (
    <div data-testid="navigation-panel">
      <div className="pointer-events-auto fixed top-1/2 right-4 z-40 -translate-y-1/2">
        <div className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-sidebar/92 p-2 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.9)] backdrop-blur-xl">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Turn robot off"
                aria-pressed={true}
                className={cn(
                  PANEL_BUTTON_CLASS,
                  'border-red-400/50 bg-red-500/15 text-red-200 hover:border-red-300 hover:bg-red-500/20 hover:text-red-100',
                )}
                data-testid="navigation-toggle"
                onClick={handleRobotOff}
                type="button"
              >
                <Power className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{robotTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
