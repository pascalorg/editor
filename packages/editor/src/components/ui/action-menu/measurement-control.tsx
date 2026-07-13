'use client'

import { useViewer } from '@pascal-app/viewer'
import { Box, Check, ChevronDown, Eye, EyeOff, Ruler, Square, Triangle, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { ActionButton } from './action-button'

type MeasurementKind = 'distance' | 'angle' | 'area' | 'perimeter' | 'volume'

const measurementOptions = [
  { kind: 'distance', label: 'Distance', icon: Ruler },
  { kind: 'angle', label: 'Angle', icon: Triangle },
  { kind: 'area', label: 'Area', icon: Square },
  { kind: 'perimeter', label: 'Perimeter', icon: Waypoints },
  { kind: 'volume', label: 'Volume', icon: Box },
] as const satisfies readonly {
  kind: MeasurementKind
  label: string
  icon: typeof Ruler
}[]

function isMeasurementKind(value: unknown): value is MeasurementKind {
  return (
    value === 'distance' ||
    value === 'angle' ||
    value === 'area' ||
    value === 'perimeter' ||
    value === 'volume'
  )
}

export function MeasurementControl() {
  const [isOpen, setIsOpen] = useState(false)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const storedKind = useEditor((state) => state.toolDefaults.measurement?.kind)
  const setMode = useEditor((state) => state.setMode)
  const setPhase = useEditor((state) => state.setPhase)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setTool = useEditor((state) => state.setTool)
  const setToolDefaults = useEditor((state) => state.setToolDefaults)
  const showMeasurements = useViewer((state) => state.showMeasurements)
  const setShowMeasurements = useViewer((state) => state.setShowMeasurements)

  const selectedKind = isMeasurementKind(storedKind) ? storedKind : 'distance'
  const selectedOption = measurementOptions.find((option) => option.kind === selectedKind)!
  const isActive = mode === 'build' && tool === 'measurement'

  const activateMeasurement = (kind: MeasurementKind) => {
    setPhase('structure')
    setStructureLayer('elements')
    setToolDefaults('measurement', { kind })
    setMode('build')
    setTool('measurement')
  }

  const handlePrimaryClick = () => {
    if (isActive) {
      setMode('select')
      return
    }
    activateMeasurement(selectedKind)
  }

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center">
        <ActionButton
          aria-label={`Measure: ${selectedOption.label}`}
          aria-pressed={isActive}
          className={cn(
            'rounded-r-none p-0 text-muted-foreground',
            isActive
              ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20'
              : 'hover:bg-cyan-500/15 hover:text-cyan-400',
          )}
          label={`Measure: ${selectedOption.label}`}
          onClick={handlePrimaryClick}
          shortcut="M"
          size="icon"
          variant="ghost"
        >
          <Ruler aria-hidden="true" className="h-5 w-5" />
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
        className="w-56 rounded-lg border-border/45 bg-background/96 p-2 shadow-elevation-3 backdrop-blur-xl"
        side="top"
        sideOffset={14}
      >
        <div aria-label="Measurement type" className="space-y-1" role="menu">
          {measurementOptions.map((option) => {
            const OptionIcon = option.icon
            const isSelected = option.kind === selectedKind
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
                  activateMeasurement(option.kind)
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

          <button
            aria-checked={showMeasurements}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-muted-foreground text-sm transition-colors hover:bg-white/8 hover:text-foreground"
            onClick={() => setShowMeasurements(!showMeasurements)}
            role="menuitemcheckbox"
            type="button"
          >
            {showMeasurements ? (
              <Eye aria-hidden="true" className="h-4 w-4" />
            ) : (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            )}
            <span>Show measurements</span>
            <span className="ml-auto text-xs">{showMeasurements ? 'On' : 'Off'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
