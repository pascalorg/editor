'use client'

import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from './../../../lib/utils'

export type SidebarTab = {
  id: string
  label: string
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
}

interface TabBarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
}

const FALLBACK_MORE_BUTTON_WIDTH = 78
const FALLBACK_TAB_WIDTH = 56
const TAB_GAP = 2

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})
  const [moreButtonWidth, setMoreButtonWidth] = useState(FALLBACK_MORE_BUTTON_WIDTH)
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const moreMeasureRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => setContainerWidth(element.clientWidth)
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const nextWidths: Record<string, number> = {}
    for (const tab of tabs) {
      nextWidths[tab.id] = measureRefs.current[tab.id]?.offsetWidth ?? FALLBACK_TAB_WIDTH
    }

    setTabWidths(nextWidths)
    setMoreButtonWidth(moreMeasureRef.current?.offsetWidth ?? FALLBACK_MORE_BUTTON_WIDTH)
  }, [tabs])

  const visibleCount = useMemo(() => {
    if (containerWidth <= 0) return tabs.length

    const availableWidth = Math.max(containerWidth - 12, 0)
    let usedWidth = 0
    let count = 0

    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index]
      if (!tab) continue

      const nextWidth = tabWidths[tab.id] ?? FALLBACK_TAB_WIDTH
      const hasHiddenTabsAfterThis = index < tabs.length - 1
      const visibleGapWidth = count > 0 ? TAB_GAP : 0
      const reservedMoreWidth = hasHiddenTabsAfterThis ? moreButtonWidth + TAB_GAP : 0

      if (usedWidth + visibleGapWidth + nextWidth + reservedMoreWidth <= availableWidth || count === 0) {
        usedWidth += visibleGapWidth + nextWidth
        count += 1
      } else {
        break
      }
    }

    return Math.min(count, tabs.length)
  }, [containerWidth, moreButtonWidth, tabs, tabWidths])

  const visibleTabs = tabs.slice(0, visibleCount)
  const overflowTabs = tabs.slice(visibleCount)
  const isOverflowActive = overflowTabs.some((tab) => tab.id === activeTab)

  const selectTab = (id: string) => {
    onTabChange(id)
    setIsOverflowOpen(false)
  }

  return (
    <div
      className="relative flex h-10 shrink-0 items-center gap-0.5 overflow-visible border-border/50 border-b pr-1 pl-2"
      ref={containerRef}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute invisible h-0 overflow-hidden whitespace-nowrap"
      >
        {tabs.map((tab) => (
          <span
            className="relative inline-flex h-7 items-center rounded-md px-2 font-medium text-sm"
            key={tab.id}
            ref={(element) => {
              measureRefs.current[tab.id] = element
            }}
          >
            {tab.label}
          </span>
        ))}
        <span
          className="relative inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-sm"
          ref={moreMeasureRef}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
          <span>More</span>
        </span>
      </div>
      {visibleTabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'relative h-7 min-w-0 rounded-md px-2 font-medium text-sm transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            type="button"
          >
            <span className="block truncate">{tab.label}</span>
          </button>
        )
      })}
      {overflowTabs.length > 0 ? (
        <div className="relative shrink-0">
          <button
            aria-expanded={isOverflowOpen}
            className={cn(
              'relative flex h-7 items-center gap-1 rounded-md px-2 font-medium text-sm transition-colors',
              isOverflowActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            onClick={() => setIsOverflowOpen((current) => !current)}
            type="button"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
            <span>More</span>
          </button>
          {isOverflowOpen ? (
            <div className="absolute top-8 right-0 z-50 min-w-32 rounded-md border border-border bg-popover p-1 shadow-lg">
              {overflowTabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    className={cn(
                      'flex h-8 w-full items-center rounded-sm px-2 text-left font-medium text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    key={tab.id}
                    onClick={() => selectTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
