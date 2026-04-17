'use client'

import { Icon } from '@iconify/react'
import { type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type LucideIcon, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { ActionButton } from './action-button'

type ControlId = 'select' | 'box-select' | 'site-edit' | 'build' | 'furnish' | 'zone' | 'delete'

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
    imageSrc: '/icons/select.png',
    label: 'Select',
    shortcut: 'V',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'box-select',
    iconifyIcon: 'mdi:select-drag',
    label: 'Box select',
    color: 'hover:bg-white/5',
    activeColor: 'bg-white/10 hover:bg-white/10',
  },
  {
    id: 'site-edit',
    imageSrc: '/icons/site.png',
    label: 'Edit site',
    color: 'hover:bg-white/5',
    activeColor: 'bg-white/10 hover:bg-white/10',
  },
  {
    id: 'build',
    imageSrc: '/icons/build.png',
    label: 'Build',
    shortcut: 'B',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'furnish',
    imageSrc: '/icons/couch.png',
    label: 'Furnish',
    shortcut: 'F',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'zone',
    imageSrc: '/icons/zone.png',
    label: 'Zone',
    shortcut: 'Z',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'delete',
    icon: Trash2,
    label: 'Delete',
    shortcut: 'D',
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
  const levelId = useViewer((s) => s.selection.levelId)

  // Only subscribe to the primitive `level` number — when walls are added to
  // this level the object ref changes but this number doesn't, so Object.is
  // dedupes and we avoid a re-render.
  const levelIndex = useScene((state) => {
    if (!levelId) return null
    const node = state.nodes[levelId]
    return node?.type === 'level' ? (node as LevelNode).level : null
  })

  const isSiteEditing = phase === 'site'
  const isGroundFloor = levelIndex === 0
  const canEnterSiteEdit = isGroundFloor || isSiteEditing

  const structureLayer = useEditor((state) => state.structureLayer)

  const getIsActive = (id: ControlId): boolean => {
    if (isSiteEditing) return id === 'site-edit'
    if (id === 'select') return mode === 'select' && selectionTool === 'click'
    if (id === 'box-select') return mode === 'select' && selectionTool === 'marquee'
    if (id === 'site-edit') return false
    if (id === 'build')
      return mode === 'build' && phase === 'structure' && structureLayer === 'elements'
    if (id === 'furnish') return mode === 'build' && phase === 'furnish'
    if (id === 'zone')
      return mode === 'build' && phase === 'structure' && structureLayer === 'zones'
    return mode === id
  }

  const handleClick = (id: ControlId) => {
    if (id === 'site-edit') {
      if (isSiteEditing) {
        // Toggle off → back to structure/select
        setPhase('structure')
        setMode('select')
        setStructureLayer('elements')
      } else if (isGroundFloor) {
        // Enter site editing — set state directly to preserve level selection.
        // setPhase('site') calls viewer.resetSelection() which clears levelId,
        // breaking the 2D floorplan (it needs a level to render the SVG).
        useEditor.setState({ phase: 'site', mode: 'select', tool: null, catalogCategory: null })
      }
      return
    }

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
    } else if (id === 'build') {
      // Toggle: if already in structure build, go back to select
      if (getIsActive('build')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('elements')
        setMode('build')
      }
    } else if (id === 'furnish') {
      if (getIsActive('furnish')) {
        setMode('select')
      } else {
        setPhase('furnish')
        setMode('build')
      }
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
        const isSiteButton = c.id === 'site-edit'
        const isActive = getIsActive(c.id)
        const isDisabled = isSiteButton && !canEnterSiteEdit

        return (
          <ActionButton
            className={cn(
              'group text-muted-foreground',
              isSiteButton
                ? isActive
                  ? c.activeColor
                  : canEnterSiteEdit
                    ? 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                    : 'cursor-not-allowed opacity-35 grayscale'
                : !(isImageMode || isActive) && c.color,
              !(isSiteButton || isImageMode) && isActive && c.activeColor,
              !isSiteButton && isImageMode && isActive && 'bg-white/10 hover:bg-white/10',
              !isSiteButton && isImageMode && !isActive && 'hover:bg-white/5',
            )}
            disabled={isDisabled}
            key={c.id}
            label={
              isSiteButton
                ? isActive
                  ? 'Exit site editing'
                  : canEnterSiteEdit
                    ? 'Edit site'
                    : 'Site editing (ground level only)'
                : c.label
            }
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
                  isSiteButton
                    ? isActive
                      ? 'opacity-100 grayscale-0'
                      : ''
                    : isActive
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
