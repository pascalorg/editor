'use client'

import { Icon } from '@iconify/react'
import { type LucideIcon, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { ActionButton } from './action-button'

type ControlId = 'select' | 'box-select' | 'zone' | 'delete'

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
    id: 'zone',
    imageSrc: '/icons/zone.webp',
    label: 'Zone',
    shortcut: 'Z',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
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
  const phase = useEditor((state) => state.phase)
  const selectionTool = useEditor((state) => state.floorplanSelectionTool)
  const setMode = useEditor((state) => state.setMode)
  const setPhase = useEditor((state) => state.setPhase)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setSelectionTool = useEditor((state) => state.setFloorplanSelectionTool)

  const isSiteEditing = phase === 'site'

  const structureLayer = useEditor((state) => state.structureLayer)

  const getIsActive = (id: ControlId): boolean => {
    if (id === 'select') return mode === 'select' && selectionTool === 'click'
    if (id === 'box-select') return mode === 'select' && selectionTool === 'marquee'
    if (id === 'zone')
      return mode === 'build' && phase === 'structure' && structureLayer === 'zones'
    return mode === id
  }

  const handleClick = (id: ControlId) => {
    // Exit site editing first if needed
    if (isSiteEditing) {
      setPhase('structure')
      setStructureLayer('elements')
    }

    if (id === 'select') {
      setMode('select')
      setSelectionTool('click')
    } else if (id === 'box-select') {
      setMode('select')
      setSelectionTool('marquee')
    } else if (id === 'zone') {
      if (getIsActive('zone')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('zones')
        setMode('build')
      }
    } else {
      setMode(id)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {controls.map((c) => {
        const ModeIcon = c.icon
        const isImageMode = Boolean(c.imageSrc)
        const isActive = getIsActive(c.id)

        return (
          <ActionButton
            className={cn(
              'group text-muted-foreground',
              !(isImageMode || isActive) && c.color,
              !isImageMode && isActive && c.activeColor,
              isImageMode && isActive && 'bg-white/10 hover:bg-white/10',
              isImageMode && !isActive && 'hover:bg-white/5',
            )}
            key={c.id}
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
        )
      })}
    </div>
  )
}
