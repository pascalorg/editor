'use client'

import { useViewer } from '@pascal-app/viewer'
import { ChevronLeft, Pin, RotateCcw, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { cn } from '../../../lib/utils'
import { PanelSectionExpansionContext } from '../controls/panel-section'
import { DynamicInspector } from './dynamic-inspector/dynamic-inspector'

const INSPECTOR_SECTIONS_PINNED_KEY = 'pascal:inspector-sections-pinned'

type InspectorTab = 'basic' | 'dynamic'

interface PanelWrapperProps {
  title: string
  /** Either a URL path (legacy panels pass `/icons/floor.webp` etc.,
   *  rendered via next/image) OR a React node (registry-driven
   *  inspector renders `<Icon icon="lucide:fence" />` from
   *  `def.presentation.icon`). */
  icon?: string | React.ReactNode
  onClose?: () => void
  onReset?: () => void
  onBack?: () => void
  children: React.ReactNode
  className?: string
  showDynamicTab?: boolean
  width?: number | string
}

export function PanelWrapper({
  title,
  icon,
  onClose,
  onReset,
  onBack,
  children,
  className,
  showDynamicTab = true,
  width = 320, // default width
}: PanelWrapperProps) {
  const isMobile = useIsMobile()
  const [inspectorSectionsPinned, setInspectorSectionsPinned] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('basic')
  const resetKey = useViewer(
    (s) =>
      (s.selection.selectedIds[0] ??
        s.selection.zoneId ??
        s.selection.levelId ??
        s.selection.buildingId) ||
      'none',
  )

  useEffect(() => {
    setInspectorSectionsPinned(localStorage.getItem(INSPECTOR_SECTIONS_PINNED_KEY) === 'true')
  }, [])

  useEffect(() => {
    setInspectorTab('basic')
  }, [resetKey])

  useEffect(() => {
    if (!showDynamicTab && inspectorTab === 'dynamic') {
      setInspectorTab('basic')
    }
  }, [inspectorTab, showDynamicTab])

  const toggleInspectorSectionsPinned = () => {
    setInspectorSectionsPinned((current) => {
      const next = !current
      localStorage.setItem(INSPECTOR_SECTIONS_PINNED_KEY, String(next))
      return next
    })
  }
  return (
    <div
      className={cn(
        isMobile
          ? 'flex h-full w-full flex-col overflow-hidden bg-transparent dark:text-foreground'
          // Cap height at `100dvh - 154px` so a tall panel's bottom edge
          // aligns flush with the top of the floating bottom action bar.
          // Combined with `top-20` (80px), the panel's bottom sits at
          // `100dvh - 74px` — just clearing the bar without leaving a
          // visible gap. The inner `flex-1 overflow-y-auto` content area
          // (below) handles vertical scrolling when content exceeds the
          // cap.
          : 'pointer-events-auto fixed top-20 right-4 z-50 flex max-h-[calc(100dvh-154px)] flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-2xl backdrop-blur-xl dark:text-foreground',
        className,
      )}
      onMouseMove={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      style={isMobile ? undefined : { width }}
    >
      {/* Header — desktop only; mobile sheet provides its own header */}
      {!isMobile && (
        <div className="flex items-center justify-between border-border/50 border-b px-3 py-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onBack}
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {icon &&
              (typeof icon === 'string' ? (
                <Image
                  alt=""
                  className="shrink-0 object-contain"
                  height={16}
                  src={icon}
                  width={16}
                />
              ) : (
                <span className="flex shrink-0 items-center justify-center">{icon}</span>
              ))}
            <h2 className="truncate font-semibold text-foreground text-sm tracking-tight">
              {title}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            <button
              aria-label={
                inspectorSectionsPinned
                  ? 'Unpin inspector sections'
                  : 'Pin inspector sections open'
              }
              aria-pressed={inspectorSectionsPinned}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground',
                inspectorSectionsPinned && 'bg-foreground/15 text-foreground',
              )}
              onClick={toggleInspectorSectionsPinned}
              title={
                inspectorSectionsPinned
                  ? 'Pinned: new selections open expanded'
                  : 'Unpinned: new selections start collapsed'
              }
              type="button"
            >
              <Pin className={cn('h-4 w-4', inspectorSectionsPinned && 'fill-current')} />
            </button>
            {onReset && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onReset}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            {onClose && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-sidebar/70">
        <div
          className={cn('grid w-full bg-[#1F1F21]', showDynamicTab ? 'grid-cols-2' : 'grid-cols-1')}
        >
          {[
            { key: 'basic' as const, label: '基础' },
            { key: 'dynamic' as const, label: '动态' },
          ].map((tab) => {
            if (!showDynamicTab && tab.key === 'dynamic') return null
            const active = inspectorTab === tab.key
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'relative flex h-[26px] w-full items-center justify-center font-medium text-[11px] transition-all',
                  active
                    ? 'bg-[#3A3358] text-[#E8DEFF]'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                )}
                data-testid={`inspector-tab-${tab.key}`}
                key={tab.key}
                onClick={() => setInspectorTab(tab.key)}
                type="button"
              >
                {tab.key === 'dynamic' ? (
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#a684ff] shadow-[0_0_8px_rgba(166,132,255,0.9)]" />
                ) : null}
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <PanelSectionExpansionContext.Provider
        value={{
          pinned: inspectorTab === 'dynamic' ? true : inspectorSectionsPinned,
          resetKey: String(resetKey),
        }}
      >
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          {inspectorTab === 'dynamic' ? <DynamicInspector /> : children}
        </div>
      </PanelSectionExpansionContext.Provider>
    </div>
  )
}
