'use client'

import { Icon } from '@iconify/react'
import { useViewer } from '@pascal-app/viewer'
import { Diamond } from 'lucide-react'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { ActionButton } from './action-button'

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: 'Stacked',
  exploded: 'Exploded',
  solo: 'Solo',
}

const levelModeBadgeLabels: Record<'manual' | 'stacked' | 'exploded' | 'solo', string> = {
  manual: 'Stack',
  stacked: 'Stack',
  exploded: 'Exploded',
  solo: 'Solo',
}

const levelModeOrder: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']

type WallMode = 'up' | 'cutaway' | 'down'

const wallModeConfig: Record<
  WallMode,
  { icon: React.FC<React.ComponentProps<'img'>>; label: string }
> = {
  up: {
    icon: (props) => (
      <img alt="Full Height" height={20} src="/icons/room.png" width={20} {...props} />
    ),
    label: 'Full Height',
  },
  cutaway: {
    icon: (props) => (
      <img alt="Cutaway" height={20} src="/icons/wallcut.png" width={20} {...props} />
    ),
    label: 'Cutaway',
  },
  down: {
    icon: (props) => <img alt="Low" height={20} src="/icons/walllow.png" width={20} {...props} />,
    label: 'Low',
  },
}

const wallModeOrder: WallMode[] = ['cutaway', 'up', 'down']

export function ViewToggles() {
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const levelMode = useViewer((state) => state.levelMode)
  const setLevelMode = useViewer((state) => state.setLevelMode)
  const wallMode = useViewer((state) => state.wallMode)
  const setWallMode = useViewer((state) => state.setWallMode)
  const showScans = useViewer((state) => state.showScans)
  const setShowScans = useViewer((state) => state.setShowScans)
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)
  const isFloorplanOpen = useEditor((state) => state.isFloorplanOpen)
  const toggleFloorplanOpen = useEditor((state) => state.toggleFloorplanOpen)

  const toggleCameraMode = () => {
    setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
  }

  const cycleLevelMode = () => {
    if (levelMode === 'manual') {
      setLevelMode('stacked')
      return
    }
    const currentIndex = levelModeOrder.indexOf(levelMode as 'stacked' | 'exploded' | 'solo')
    const nextIndex = (currentIndex + 1) % levelModeOrder.length
    const nextMode = levelModeOrder[nextIndex]
    if (nextMode) setLevelMode(nextMode)
  }

  const cycleWallMode = () => {
    const currentIndex = wallModeOrder.indexOf(wallMode)
    const nextIndex = (currentIndex + 1) % wallModeOrder.length
    const nextMode = wallModeOrder[nextIndex]
    if (nextMode) setWallMode(nextMode)
  }

  return (
    <div className="flex items-center gap-1">
      {/* Camera Mode */}
      <ActionButton
        className={cn(
          cameraMode === 'orthographic'
            ? 'bg-violet-500/20 text-violet-400'
            : 'hover:text-violet-400',
        )}
        label={`Camera: ${cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}`}
        onClick={toggleCameraMode}
        size="icon"
        variant="ghost"
      >
        {cameraMode === 'perspective' ? (
          <Icon color="currentColor" height={24} icon="icon-park-outline:perspective" width={24} />
        ) : (
          <Icon color="currentColor" height={24} icon="vaadin:grid" width={24} />
        )}
      </ActionButton>

      {/* Level Mode */}
      <ActionButton
        className={cn(
          'p-0',
          levelMode === 'stacked' || levelMode === 'manual'
            ? 'text-muted-foreground/80 hover:bg-white/5 hover:text-foreground'
            : 'bg-white/10 text-foreground',
        )}
        label={`Levels: ${levelMode === 'manual' ? 'Manual' : levelModeLabels[levelMode as keyof typeof levelModeLabels]}`}
        onClick={cycleLevelMode}
        size="icon"
        variant="ghost"
      >
        <span className="relative flex h-full w-full items-center justify-center pb-1">
          {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
          {levelMode === 'exploded' && (
            <Icon color="currentColor" height={24} icon="charm:stack-pop" width={24} />
          )}
          {(levelMode === 'stacked' || levelMode === 'manual') && (
            <Icon color="currentColor" height={24} icon="charm:stack-push" width={24} />
          )}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1 bottom-1 left-1 rounded border border-border/50 bg-background/70 px-0.5 py-[2px] text-center font-medium font-pixel text-[8px] text-foreground/85 leading-none tracking-[-0.02em] backdrop-blur-sm"
          >
            {levelModeBadgeLabels[levelMode]}
          </span>
        </span>
      </ActionButton>

      {/* Wall Mode */}
      <ActionButton
        className={cn(
          'p-0',
          wallMode !== 'cutaway'
            ? 'bg-white/10'
            : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
        )}
        label={`Walls: ${wallModeConfig[wallMode].label}`}
        onClick={cycleWallMode}
        size="icon"
        variant="ghost"
      >
        {(() => {
          const Icon = wallModeConfig[wallMode].icon
          return <Icon className="h-[28px] w-[28px]" />
        })()}
      </ActionButton>

      {/* Show Scans */}
      <ActionButton
        className={cn(
          'p-0',
          showScans
            ? 'bg-white/10'
            : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
        )}
        label={`Scans: ${showScans ? 'Visible' : 'Hidden'}`}
        onClick={() => setShowScans(!showScans)}
        size="icon"
        variant="ghost"
      >
        <img alt="Scans" className="h-[28px] w-[28px] object-contain" src="/icons/mesh.png" />
      </ActionButton>

      {/* Show Guides */}
      <ActionButton
        className={cn(
          'p-0',
          showGuides
            ? 'bg-white/10'
            : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
        )}
        label={`Guides: ${showGuides ? 'Visible' : 'Hidden'}`}
        onClick={() => setShowGuides(!showGuides)}
        size="icon"
        variant="ghost"
      >
        <img alt="Guides" className="h-[28px] w-[28px] object-contain" src="/icons/floorplan.png" />
      </ActionButton>

      <ActionButton
        className={cn('overflow-visible p-0', isFloorplanOpen ? 'bg-white/10' : 'hover:bg-white/5')}
        label={`2D floor plan: ${isFloorplanOpen ? 'Visible' : 'Hidden'}`}
        onClick={toggleFloorplanOpen}
        size="icon"
        variant="ghost"
      >
        <span className="relative flex h-full w-full items-center justify-center pb-1">
          <img
            alt="2D floor plan"
            className={cn(
              'h-[28px] w-[28px] object-contain transition-[filter,opacity] duration-200',
              isFloorplanOpen ? 'opacity-100 grayscale-0' : 'opacity-60 grayscale',
            )}
            src="/icons/blueprint.png"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-1 -right-1 z-10 rounded-full border border-background/80 bg-emerald-600 px-1.5 py-0.5 font-semibold text-[7px] text-white leading-none shadow-[0_4px_10px_rgba(5,150,105,0.24)]"
          >
            New
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1 bottom-1 left-1 rounded border border-border/50 bg-background/70 px-0.5 py-[2px] text-center font-medium font-pixel text-[8px] text-foreground/85 leading-none tracking-[-0.02em] backdrop-blur-sm"
          >
            2D
          </span>
        </span>
      </ActionButton>
    </div>
  )
}
