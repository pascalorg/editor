'use client'

import { Icon } from '@iconify/react'
import { type LucideIcon, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { Fragment } from 'react'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { ActionButton } from './action-button'
import { MeasurementControl } from './measurement-control'
import { PointAskButton } from './point-ask-button'

type ControlId = 'select' | 'box-select' | 'delete'

type ControlConfig = {
  id: ControlId
  icon?: LucideIcon
  iconifyIcon?: string
  imageSrc?: string
  label: string
  shortcut?: string
  color: string
  activeColor: string
}

// Fixed set of controls — always visible, never morphs
const controls: ControlConfig[] = [
  {
    id: 'select',
    imageSrc: '/icons/select.webp',
    label: 'Select',
    shortcut: 'V',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'delete',
    icon: Trash2,
    label: 'Delete',
    shortcut: 'X',
    color: 'hover:bg-red-500/20 hover:text-red-400',
    activeColor: 'bg-red-500/20 text-red-400',
  },
]

export function ControlModes() {
  const mode = useEditor((state) => state.mode)
  const selectionTool = useEditor((state) => state.floorplanSelectionTool)
  const armToolMode = useEditor((state) => state.armToolMode)
  const setSelectionTool = useEditor((state) => state.setFloorplanSelectionTool)

  const getIsActive = (id: ControlId): boolean => {
    if (id === 'select') return mode === 'select' && selectionTool === 'click'
    if (id === 'box-select') return mode === 'select' && selectionTool === 'marquee'
    return mode === id
  }

  const handleClick = (id: ControlId) => {
    if (id === 'select') {
      armToolMode({ mode: 'select' })
      setSelectionTool('click')
    } else if (id === 'box-select') {
      armToolMode({ mode: 'select' })
      setSelectionTool('marquee')
    } else {
      armToolMode({ mode: id })
    }
  }

  return (
    <div className="flex items-center gap-1">
      {controls.map((c) => {
        const ModeIcon = c.icon
        const isImageMode = Boolean(c.imageSrc)
        const isActive = getIsActive(c.id)

        return (
          <Fragment key={c.id}>
            {c.id === 'delete' ? <MeasurementControl /> : null}
            {c.id === 'zone' ? <PointAskButton /> : null}
            <ActionButton
              className={cn(
                'group text-muted-foreground',
                !(isImageMode || isActive) && c.color,
                !isImageMode && isActive && c.activeColor,
                isImageMode && isActive && 'bg-white/10 hover:bg-white/10',
                isImageMode && !isActive && 'hover:bg-white/5',
              )}
              // A static hook for a host app that wants to point a first-run
              // tour at this button. Nothing here reads it.
              data-guide-target={c.id === 'select' ? 'mode-select' : undefined}
              isActive={isActive}
              label={c.label}
              onClick={() => handleClick(c.id)}
              shortcut={c.shortcut}
              size="icon"
              variant="ghost"
            >
              {c.imageSrc ? (
                <Image
                  alt={c.label}
                  className={cn(
                    'h-[28px] w-[28px] object-contain transition-[opacity,filter] duration-200',
                    isActive
                      ? 'opacity-100 grayscale-0'
                      : 'opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0',
                  )}
                  height={28}
                  src={c.imageSrc}
                  width={28}
                />
              ) : c.iconifyIcon ? (
                <Icon color="currentColor" height={18} icon={c.iconifyIcon} width={18} />
              ) : (
                ModeIcon && <ModeIcon className="h-5 w-5" />
              )}
            </ActionButton>
          </Fragment>
        )
      })}
    </div>
  )
}
