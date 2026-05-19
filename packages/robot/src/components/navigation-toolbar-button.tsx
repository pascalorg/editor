'use client'

import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Bot, Check, Shield } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '../lib/utils'
import useNavigation, {
  type NavigationRobotMode,
  type NavigationRobotModel,
} from '../store/use-navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/primitives/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/primitives/tooltip'

const TOOLBAR_BTN =
  'flex items-center justify-center w-8 text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90'

const ROBOT_MODE_OPTIONS: Array<{ label: string; mode: NavigationRobotMode }> = [
  { label: 'Manual mode', mode: 'normal' },
  { label: 'Task mode', mode: 'task' },
]

const ROBOT_MODEL_LABELS: Record<NavigationRobotModel, string> = {
  armored: 'Armored robot',
  pascal: 'Pascal robot',
}

const ROBOT_MODEL_OPTIONS: Array<{ label: string; model: NavigationRobotModel }> = [
  { label: ROBOT_MODEL_LABELS.pascal, model: 'pascal' },
  { label: ROBOT_MODEL_LABELS.armored, model: 'armored' },
]

export function NavigationToolbarButton() {
  const robotModel = useNavigation((state) => state.robotModel)
  const robotMode = useNavigation((state) => state.robotMode)
  const setRobotModel = useNavigation((state) => state.setRobotModel)
  const setFollowRobotEnabled = useNavigation((state) => state.setFollowRobotEnabled)
  const setRobotMode = useNavigation((state) => state.setRobotMode)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isTooltipOpen, setIsTooltipOpen] = useState(false)

  const activateRobotMode = useCallback(
    (mode: NavigationRobotMode) => {
      emitter.emit('tool:cancel')
      const viewerState = useViewer.getState()
      viewerState.setHoveredId(null)
      viewerState.setPreviewSelectedIds([])
      viewerState.setSelection({ selectedIds: [], zoneId: null })
      viewerState.outliner.selectedObjects.length = 0
      viewerState.outliner.hoveredObjects.length = 0

      setRobotMode(mode)
      setFollowRobotEnabled(false)
    },
    [setFollowRobotEnabled, setRobotMode],
  )

  const tooltipLabel =
    robotMode === 'normal'
      ? `Robot: manual mode (${ROBOT_MODEL_LABELS[robotModel]})`
      : robotMode === 'task'
        ? `Robot: task mode (${ROBOT_MODEL_LABELS[robotModel]})`
        : `Robot (${ROBOT_MODEL_LABELS[robotModel]})`

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setIsDropdownOpen(open)
        if (open) {
          setIsTooltipOpen(false)
        }
      }}
      open={isDropdownOpen}
    >
      <Tooltip
        onOpenChange={(open) => setIsTooltipOpen(open && !isDropdownOpen)}
        open={isTooltipOpen && !isDropdownOpen}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={tooltipLabel}
              className={cn(
                TOOLBAR_BTN,
                robotMode && 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20',
              )}
              type="button"
            >
              <Bot className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center" side="bottom">
        {ROBOT_MODE_OPTIONS.map((option) => {
          const isActive = robotMode === option.mode
          return (
            <DropdownMenuItem key={option.mode} onSelect={() => activateRobotMode(option.mode)}>
              <span className="flex min-w-28 items-center justify-between gap-3">
                <span>{option.label}</span>
                {isActive ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        {ROBOT_MODEL_OPTIONS.map((option) => {
          const isActive = robotModel === option.model
          const ModelIcon = option.model === 'armored' ? Shield : Bot

          return (
            <DropdownMenuItem key={option.model} onSelect={() => setRobotModel(option.model)}>
              <span className="flex min-w-28 items-center justify-between gap-3">
                <span>{option.label}</span>
                {isActive ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <ModelIcon className="h-3.5 w-3.5" />
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
