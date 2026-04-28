'use client'

import {
  type AnyNodeId,
  type GuideNode,
  type LevelNode,
  type ScanNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import { useUploadStore } from '../../../store/use-upload'
import { SliderControl } from '../controls/slider-control'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { ActionButton } from './action-button'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
const ACCEPTED_FILE_TYPES = '.glb,.gltf,image/jpeg,image/png,image/webp,image/gif'
const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

function formatGridSnapStep(step: GridSnapStep) {
  return step.toFixed(2)
}

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

// ── Shared upload button for dropdowns ──────────────────────────────────────

function UploadButton() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const levelId = useViewer((s) => s.selection.levelId)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!(file && levelId)) return
      e.target.value = ''

      const { uploadHandler } = useUploadStore.getState()
      if (!uploadHandler) return

      if (file.size > MAX_FILE_SIZE) return

      const isScan =
        file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')
      const isImage = file.type.startsWith('image/')
      if (!(isScan || isImage)) return

      const type = isScan ? 'scan' : 'guide'

      const projectId = window.location.pathname.split('/editor/')[1]?.split('/')[0]
      if (!projectId) return

      useUploadStore.getState().clearUpload(levelId)
      uploadHandler(projectId, levelId, file, type)
    },
    [levelId],
  )

  return (
    <>
      <button
        aria-label="Upload scan or guide image"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/40 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        onClick={() => fileInputRef.current?.click()}
        type="button"
      >
        <Plus className="h-3 w-3" />
      </button>
      <input
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
    </>
  )
}

// ── Guides toggle + dropdown ────────────────────────────────────────────────

function GuidesControl() {
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
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
              ? 'bg-white/15'
              : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
          )}
          label={`Guides: ${showGuides ? 'Visible' : 'Hidden'}`}
          onClick={() => setShowGuides(!showGuides)}
          size="icon"
          variant="ghost"
        >
          <div className="relative">
            <img
              alt="Guides"
              className="h-[28px] w-[28px] object-contain"
              src="/icons/floorplan.png"
            />
            <span className="absolute -right-1.5 -bottom-1 min-w-[14px] rounded-full bg-white/20 px-[3px] text-center font-medium text-[9px] text-white/70 leading-[14px]">
              {guides.length}
            </span>
          </div>
        </ActionButton>

        {/* Dropdown chevron */}
        <PopoverTrigger asChild>
          <button
            aria-expanded={isOpen}
            aria-label="Guide image settings"
            className={cn(
              'flex h-11 w-6 items-center justify-center rounded-r-lg transition-colors',
              showGuides
                ? isOpen
                  ? 'bg-white/10'
                  : 'bg-white/5 hover:bg-white/8'
                : isOpen
                  ? 'bg-white/8'
                  : 'opacity-60 hover:bg-white/5 hover:opacity-100',
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
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground text-sm">Guide images</p>
              {hasGuides && (
                <p className="text-muted-foreground text-xs">
                  {guides.length} guide image{guides.length !== 1 ? 's' : ''} on this level
                </p>
              )}
            </div>
            <UploadButton />
          </div>

          {hasGuides ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {guides.map((guide, index) => (
                <div
                  className="group/item space-y-2 rounded-xl border border-border/45 bg-background/75 p-2.5"
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
                    <button
                      aria-label="Delete guide image"
                      className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/item:opacity-100"
                      onClick={() => deleteNode(guide.id)}
                      type="button"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
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

// ── Grid snap ──────────────────────────────────────────────────────────────

export function GridSnapControl() {
  const [isOpen, setIsOpen] = useState(false)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const setGridSnapStep = useEditor((state) => state.setGridSnapStep)

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-expanded={isOpen}
              aria-label={`Grid snap: ${formatGridSnapStep(gridSnapStep)}`}
              className={cn(
                'flex h-11 w-11 flex-col items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground',
                isOpen && 'bg-white/10 text-foreground',
              )}
              type="button"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zm-11 0h7v7H3v-7z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="mt-1 font-medium text-[9px] leading-none">
                {formatGridSnapStep(gridSnapStep)}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Grid snap: {formatGridSnapStep(gridSnapStep)}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="center"
        className="w-36 rounded-xl border-border/45 bg-background/96 p-2 shadow-elevation-3 backdrop-blur-xl"
        side="top"
        sideOffset={14}
      >
        <div className="space-y-1">
          {GRID_SNAP_STEPS.map((step) => {
            const isActive = step === gridSnapStep
            return (
              <button
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/8',
                  isActive && 'bg-white/10 text-foreground',
                )}
                key={step}
                onClick={() => {
                  setGridSnapStep(step)
                  setIsOpen(false)
                }}
                type="button"
              >
                <span>{formatGridSnapStep(step)}</span>
                {isActive ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              </button>
            )
          })}
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
  const deleteNode = useScene((state) => state.deleteNode)
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
              ? 'bg-white/15'
              : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0',
          )}
          label={`Scans: ${showScans ? 'Visible' : 'Hidden'}`}
          onClick={() => setShowScans(!showScans)}
          size="icon"
          variant="ghost"
        >
          <div className="relative">
            <img alt="Scans" className="h-[28px] w-[28px] object-contain" src="/icons/mesh.png" />
            <span className="absolute -right-1.5 -bottom-1 min-w-[14px] rounded-full bg-white/20 px-[3px] text-center font-medium text-[9px] text-white/70 leading-[14px]">
              {scans.length}
            </span>
          </div>
        </ActionButton>

        {/* Dropdown chevron */}
        <PopoverTrigger asChild>
          <button
            aria-expanded={isOpen}
            aria-label="Scan settings"
            className={cn(
              'flex h-11 w-6 items-center justify-center rounded-r-lg transition-colors',
              showScans
                ? isOpen
                  ? 'bg-white/10'
                  : 'bg-white/5 hover:bg-white/8'
                : isOpen
                  ? 'bg-white/8'
                  : 'opacity-60 hover:bg-white/5 hover:opacity-100',
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
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground text-sm">Scans</p>
              {hasScans && (
                <p className="text-muted-foreground text-xs">
                  {scans.length} scan{scans.length !== 1 ? 's' : ''} on this level
                </p>
              )}
            </div>
            <UploadButton />
          </div>

          {hasScans ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {scans.map((scan, index) => (
                <div
                  className="group/item space-y-2 rounded-xl border border-border/45 bg-background/75 p-2.5"
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
                    <button
                      aria-label="Delete scan"
                      className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/item:opacity-100"
                      onClick={() => deleteNode(scan.id)}
                      type="button"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
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

// Secondary toggles for mobile (grid snap + scans + guides)
export function SecondaryToggles() {
  return (
    <div className="flex items-center gap-1">
      <GridSnapControl />
      <ScansControl />
      <GuidesControl />
    </div>
  )
}
