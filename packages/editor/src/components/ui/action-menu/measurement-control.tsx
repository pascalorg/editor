'use client'

import type {
  ConstructionDimensionChainMode,
  ConstructionDimensionMode,
} from '@pascal-app/core'
import {
  Box,
  Check,
  ChevronDown,
  CircleIcon,
  Crosshair,
  Grid2X2,
  Minus,
  Ruler,
  ScanSearch,
  Square,
  Triangle,
  Waypoints,
} from 'lucide-react'
import { useState } from 'react'
import type { CreatableMeasurementKind } from '../../../lib/measurement-kind'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { ActionButton } from './action-button'

const measurementOptions = [
  { kind: 'distance', label: 'Distance', icon: Ruler },
  { kind: 'angle', label: 'Angle', icon: Triangle },
  { kind: 'area', label: 'Area', icon: Square },
  { kind: 'perimeter', label: 'Perimeter', icon: Waypoints },
  { kind: 'volume', label: 'Volume', icon: Box },
] as const satisfies readonly {
  kind: CreatableMeasurementKind
  label: string
  icon: typeof Ruler
}[]

const measurementMenuOptions = [
  { kind: 'smart', label: 'Smart', icon: ScanSearch },
  ...measurementOptions,
] as const

const constructionDimensionOptions = [
  { mode: 'linear', chainMode: 'point-to-point', label: 'Linear dimension', icon: Ruler },
  { mode: 'linear', chainMode: 'continuous', label: 'Continuous dimension', icon: Waypoints },
  { mode: 'radius', chainMode: 'point-to-point', label: 'Radius dimension', icon: CircleIcon },
  { mode: 'diameter', chainMode: 'point-to-point', label: 'Diameter dimension', icon: CircleIcon },
  { mode: 'center-mark', chainMode: 'point-to-point', label: 'Center mark', icon: Crosshair },
  { mode: 'chord', chainMode: 'point-to-point', label: 'Chord dimension', icon: Minus },
  { mode: 'arc-length', chainMode: 'point-to-point', label: 'Arc length', icon: CircleIcon },
  { mode: 'angular', chainMode: 'point-to-point', label: 'Angular dimension', icon: Triangle },
  { mode: 'coordinate', chainMode: 'continuous', label: 'Coordinate dimensions', icon: Grid2X2 },
] as const satisfies readonly {
  mode: ConstructionDimensionMode
  chainMode: ConstructionDimensionChainMode
  label: string
  icon: typeof Ruler
}[]

export function MeasurementControl() {
  const [isOpen, setIsOpen] = useState(false)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const selectedKind = useEditor((state) => state.lastMeasurementKind)
  const activeToolKind = useEditor((state) => state.toolDefaults.measurement?.kind)
  const constructionDimensionChainMode = useEditor(
    (state) => state.toolDefaults['construction-dimension']?.chainMode,
  )
  const constructionDimensionMode = useEditor(
    (state) => state.toolDefaults['construction-dimension']?.mode,
  )
  const setMode = useEditor((state) => state.setMode)
  const setPhase = useEditor((state) => state.setPhase)
  const setLastMeasurementKind = useEditor((state) => state.setLastMeasurementKind)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setTool = useEditor((state) => state.setTool)
  const setToolDefaults = useEditor((state) => state.setToolDefaults)
  const setViewMode = useEditor((state) => state.setViewMode)

  const selectedOption =
    measurementOptions.find((option) => option.kind === selectedKind) ?? measurementOptions[0]
  const isActive = mode === 'build' && tool === 'measurement'
  const isConstructionDimensionActive = mode === 'build' && tool === 'construction-dimension'
  const activeConstructionDimensionOption = constructionDimensionOptions.find(
    (option) =>
      option.mode === (constructionDimensionMode ?? 'linear') &&
      option.chainMode === (constructionDimensionChainMode ?? 'point-to-point'),
  )
  const isControlActive = isActive || isConstructionDimensionActive
  const isSmartActive = isActive && activeToolKind === 'smart'
  const SelectedIcon = isConstructionDimensionActive
    ? (activeConstructionDimensionOption?.icon ?? Ruler)
    : isSmartActive
      ? ScanSearch
      : selectedOption.icon
  const selectedLabel = isConstructionDimensionActive
    ? (activeConstructionDimensionOption?.label ?? 'Linear dimension')
    : isSmartActive
      ? 'Smart'
      : selectedOption.label

  const activateMeasurement = (kind: CreatableMeasurementKind) => {
    setPhase('structure')
    setStructureLayer('elements')
    setLastMeasurementKind(kind)
    setToolDefaults('measurement', { kind })
    setMode('build')
    setTool('measurement')
  }

  const handlePrimaryClick = () => {
    if (isControlActive) {
      setMode('select')
      return
    }
    activateMeasurement(selectedKind)
  }

  const activateSmartMeasurement = () => {
    setPhase('structure')
    setStructureLayer('elements')
    setToolDefaults('measurement', { kind: 'smart' })
    setMode('build')
    setTool('measurement')
  }

  const activateConstructionDimension = (
    dimensionMode: ConstructionDimensionMode,
    chainMode: ConstructionDimensionChainMode,
  ) => {
    setPhase('structure')
    setStructureLayer('elements')
    setViewMode('2d')
    setToolDefaults('construction-dimension', { chainMode, mode: dimensionMode })
    setMode('build')
    setTool('construction-dimension')
  }

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center">
        <ActionButton
          aria-label={`Measure: ${selectedLabel}`}
          aria-pressed={isControlActive}
          className={cn(
            'rounded-r-none p-0 text-muted-foreground',
            isControlActive
              ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20'
              : 'hover:bg-cyan-500/15 hover:text-cyan-400',
          )}
          label={`Measure: ${selectedLabel}`}
          onClick={handlePrimaryClick}
          shortcut="M"
          size="icon"
          variant="ghost"
        >
          <SelectedIcon aria-hidden="true" className="h-5 w-5" />
        </ActionButton>

        <PopoverTrigger asChild>
          <button
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="Measurement options"
            className={cn(
              'flex h-11 w-6 items-center justify-center rounded-r-lg text-muted-foreground transition-colors',
              isOpen
                ? 'bg-cyan-500/15 text-cyan-400'
                : 'hover:bg-cyan-500/10 hover:text-cyan-400',
            )}
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')}
            />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="center"
        className="max-h-[70vh] w-64 overflow-y-auto rounded-lg border-border/45 bg-background/96 p-2 shadow-elevation-3 backdrop-blur-xl"
        side="top"
        sideOffset={14}
      >
        <div aria-label="Measurement type" className="space-y-1" role="menu">
          {measurementMenuOptions.map((option) => {
            const OptionIcon = option.icon
            const isSmart = option.kind === 'smart'
            const isSelected = isSmart
              ? isSmartActive
              : !isConstructionDimensionActive && !isSmartActive && option.kind === selectedKind
            return (
              <button
                aria-checked={isSelected}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/8 hover:text-foreground',
                )}
                key={option.kind}
                onClick={() => {
                  if (isSmart) activateSmartMeasurement()
                  else activateMeasurement(option.kind)
                  setIsOpen(false)
                }}
                role="menuitemradio"
                type="button"
              >
                <OptionIcon aria-hidden="true" className="h-4 w-4" />
                <span>{option.label}</span>
                {isSelected ? <Check aria-hidden="true" className="ml-auto h-4 w-4" /> : null}
              </button>
            )
          })}

          <div className="my-1.5 h-px bg-border/60" />
          <div className="px-2.5 pt-1 pb-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
            Floor plan
          </div>

          {constructionDimensionOptions.map((option) => {
            const OptionIcon = option.icon
            const isSelected =
              isConstructionDimensionActive && activeConstructionDimensionOption === option
            return (
              <button
                aria-checked={isSelected}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/8 hover:text-foreground',
                )}
                key={`${option.mode}-${option.chainMode}`}
                onClick={() => {
                  activateConstructionDimension(option.mode, option.chainMode)
                  setIsOpen(false)
                }}
                role="menuitemradio"
                type="button"
              >
                <OptionIcon aria-hidden="true" className="h-4 w-4" />
                <span>{option.label}</span>
                {isSelected ? <Check aria-hidden="true" className="ml-auto h-4 w-4" /> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
