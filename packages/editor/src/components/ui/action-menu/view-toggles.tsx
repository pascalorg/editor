'use client'

import {
  type AnyNodeId,
  type GuideNode,
  type LevelNode,
  type ScanNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../../lib/utils'
import { SliderControl } from '../controls/slider-control'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { ActionButton } from './action-button'

// ── Helper: get guide images for the current level ──────────────────────────

function useLevelGuides(): GuideNode[] {
  const levelId = useViewer((s) => s.selection.levelId)
  return useScene(
    useShallow((state) => {
      if (!levelId) return [] as GuideNode[]
      const level = state.nodes[levelId]
      if (!level || level.type !== 'level') return [] as GuideNode[]
      return (level as LevelNode).children
        .map((id) => state.nodes[id])
        .filter((node): node is GuideNode => node?.type === 'guide')
    }),
  )
}

// ── Helper: get scans for the current level ─────────────────────────────────

function useLevelScans(): ScanNode[] {
  const levelId = useViewer((s) => s.selection.levelId)
  return useScene(
    useShallow((state) => {
      if (!levelId) return [] as ScanNode[]
      const level = state.nodes[levelId]
      if (!level || level.type !== 'level') return [] as ScanNode[]
      return (level as LevelNode).children
        .map((id) => state.nodes[id])
        .filter((node): node is ScanNode => node?.type === 'scan')
    }),
  )
}

// ── Guides toggle + dropdown ────────────────────────────────────────────────

function GuidesControl() {
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)
  const updateNode = useScene((state) => state.updateNode)
  const [isOpen, setIsOpen] = useState(false)

  const guides = useLevelGuides()
  const hasGuides = guides.length > 0

  const handleOpacityChange = useCallback(
    (guideId: GuideNode['id'], opacity: number) => {
      updateNode(guideId, { opacity: Math.round(Math.min(100, Math.max(0, opacity))) })
    },
    [updateNode],
  )

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center">
        {/* Toggle button */}
        <ActionButton
          className={cn(
            'rounded-r-none p-0',
            showGuides
              ? 'bg-white/10'
              : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
          )}
          label={`Guides: ${showGuides ? 'Visible' : 'Hidden'}`}
          onClick={() => setShowGuides(!showGuides)}
          size="icon"
          variant="ghost"
        >
          <img
            alt="Guides"
            className="h-[28px] w-[28px] object-contain"
            src="/icons/floorplan.png"
          />
        </ActionButton>

        {/* Dropdown chevron */}
        <PopoverTrigger asChild>
          <button
            aria-expanded={isOpen}
            aria-label="Guide image settings"
            className={cn(
              'flex h-11 w-6 items-center justify-center rounded-r-lg transition-colors',
              isOpen ? 'bg-white/10' : 'opacity-60 hover:bg-white/5 hover:opacity-100',
            )}
            type="button"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="center"
        className="w-72 rounded-xl border-border/45 bg-background/96 p-3 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.55),0_6px_16px_-10px_rgba(15,23,42,0.2)] backdrop-blur-xl"
        side="top"
        sideOffset={14}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/80">
              <img alt="" className="h-4 w-4 object-contain" src="/icons/floorplan.png" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm">Guide images</p>
              {hasGuides && (
                <p className="text-muted-foreground text-xs">
                  {guides.length} guide image{guides.length !== 1 ? 's' : ''} on this level
                </p>
              )}
            </div>
          </div>

          {hasGuides ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {guides.map((guide, index) => (
                <div
                  className="space-y-2 rounded-xl border border-border/45 bg-background/75 p-2.5"
                  key={guide.id}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      alt=""
                      className="h-3.5 w-3.5 shrink-0 object-contain opacity-70"
                      src="/icons/floorplan.png"
                    />
                    <p className="truncate font-medium text-foreground text-sm">
                      {guide.name || `Guide image ${index + 1}`}
                    </p>
                  </div>
                  <SliderControl
                    label="Opacity"
                    max={100}
                    min={0}
                    onChange={(value) => handleOpacityChange(guide.id, value)}
                    precision={0}
                    step={1}
                    unit="%"
                    value={guide.opacity}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border/45 border-dashed bg-background/60 px-3 py-4 text-muted-foreground text-sm">
              No guide images on this level yet.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Scans toggle + dropdown ─────────────────────────────────────────────────

function ScansControl() {
  const showScans = useViewer((state) => state.showScans)
  const setShowScans = useViewer((state) => state.setShowScans)
  const updateNode = useScene((state) => state.updateNode)
  const [isOpen, setIsOpen] = useState(false)

  const scans = useLevelScans()
  const hasScans = scans.length > 0

  const handleOpacityChange = useCallback(
    (scanId: ScanNode['id'], opacity: number) => {
      updateNode(scanId, { opacity: Math.round(Math.min(100, Math.max(0, opacity))) })
    },
    [updateNode],
  )

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center">
        {/* Toggle button */}
        <ActionButton
          className={cn(
            'rounded-r-none p-0',
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

        {/* Dropdown chevron */}
        <PopoverTrigger asChild>
          <button
            aria-expanded={isOpen}
            aria-label="Scan settings"
            className={cn(
              'flex h-11 w-6 items-center justify-center rounded-r-lg transition-colors',
              isOpen ? 'bg-white/10' : 'opacity-60 hover:bg-white/5 hover:opacity-100',
            )}
            type="button"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="center"
        className="w-72 rounded-xl border-border/45 bg-background/96 p-3 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.55),0_6px_16px_-10px_rgba(15,23,42,0.2)] backdrop-blur-xl"
        side="top"
        sideOffset={14}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/80">
              <img alt="" className="h-4 w-4 object-contain" src="/icons/mesh.png" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm">Scans</p>
              {hasScans && (
                <p className="text-muted-foreground text-xs">
                  {scans.length} scan{scans.length !== 1 ? 's' : ''} on this level
                </p>
              )}
            </div>
          </div>

          {hasScans ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {scans.map((scan, index) => (
                <div
                  className="space-y-2 rounded-xl border border-border/45 bg-background/75 p-2.5"
                  key={scan.id}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      alt=""
                      className="h-3.5 w-3.5 shrink-0 object-contain opacity-70"
                      src="/icons/mesh.png"
                    />
                    <p className="truncate font-medium text-foreground text-sm">
                      {scan.name || `Scan ${index + 1}`}
                    </p>
                  </div>
                  <SliderControl
                    label="Opacity"
                    max={100}
                    min={0}
                    onChange={(value) => handleOpacityChange(scan.id, value)}
                    precision={0}
                    step={1}
                    unit="%"
                    value={scan.opacity}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border/45 border-dashed bg-background/60 px-3 py-4 text-muted-foreground text-sm">
              No scans on this level yet.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Main ViewToggles ────────────────────────────────────────────────────────

export function ViewToggles() {
  return (
    <div className="flex items-center gap-1">
      {/* Scans (toggle + dropdown) */}
      <ScansControl />

      {/* Guides (toggle + dropdown) */}
      <GuidesControl />
    </div>
  )
}
