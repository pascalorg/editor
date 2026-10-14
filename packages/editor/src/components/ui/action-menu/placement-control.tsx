'use client'

import { PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { ActionButton } from './action-button'
import { type ActionMenuPlacement, useActionMenuPlacement, useActionMenuPopupSide } from './placement'
import { useActionMenuPlacementPreference } from './placement-preference'

const PLACEMENT_OPTIONS: { value: ActionMenuPlacement; label: string; icon: typeof PanelBottom }[] =
  [
    { value: 'bottom', label: 'Bottom', icon: PanelBottom },
    { value: 'top', label: 'Top', icon: PanelTop },
    { value: 'left', label: 'Left', icon: PanelLeft },
    { value: 'right', label: 'Right', icon: PanelRight },
  ]

/** Lets the user dock the action menu to another edge of the viewer. */
export function PlacementControl() {
  const placement = useActionMenuPlacement()
  const popupSide = useActionMenuPopupSide()
  const setPlacement = useActionMenuPlacementPreference((state) => state.setPlacement)
  const [isOpen, setIsOpen] = useState(false)
  const CurrentIcon =
    PLACEMENT_OPTIONS.find((option) => option.value === placement)?.icon ?? PanelBottom

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <ActionButton
          className="group text-muted-foreground hover:bg-white/5"
          isActive={isOpen}
          label="Menu position"
          size="icon"
          variant="ghost"
        >
          <CurrentIcon aria-hidden="true" className="h-5 w-5" />
        </ActionButton>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-max min-w-36 rounded-lg border-border/45 bg-background/96 p-2 shadow-elevation-3 backdrop-blur-xl"
        side={popupSide}
        sideOffset={14}
      >
        <div aria-label="Menu position" className="space-y-1" role="menu">
          {PLACEMENT_OPTIONS.map((option) => {
            const OptionIcon = option.icon
            const isSelected = option.value === placement
            return (
              <button
                aria-checked={isSelected}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/8 hover:text-foreground',
                )}
                key={option.value}
                onClick={() => {
                  setPlacement(option.value)
                  setIsOpen(false)
                }}
                role="menuitemradio"
                type="button"
              >
                <OptionIcon aria-hidden="true" className="h-4 w-4" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
