'use client'

import { type SiteNode, useScene } from '@pascal-app/core'
import { useEffect, useSyncExternalStore } from 'react'
import useDrawingView, { EDITOR_DRAWING_TYPE_OPTIONS } from '../../../store/use-drawing-view'
import { cn } from '../../utils'
import { hasSitePlanContributors, subscribeSitePlanContributors } from './contributors'

/**
 * The site plan only has something to draw for a resolved lot (a parcel or
 * setbacks on the site) or when a plugin contributes site-plan content; every
 * other scene would get the default 30 m square.
 */
export function isSitePlanAvailable(
  site: Pick<SiteNode, 'parcel' | 'setbacks'> | null,
  pluginContributes: boolean,
): boolean {
  return pluginContributes || Boolean(site?.parcel || site?.setbacks)
}

export function useSitePlanAvailable(): boolean {
  const pluginContributes = useSyncExternalStore(
    subscribeSitePlanContributors,
    hasSitePlanContributors,
    hasSitePlanContributors,
  )
  const siteHasLot = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return isSitePlanAvailable(node as SiteNode, false)
    }
    return false
  })
  return pluginContributes || siteHasLot
}

/**
 * Floor plan ⇄ Site plan switch for the 2D editor.
 *
 * Sits with the other floating plan controls in the floor-plan viewport
 * (bottom-left, beside the compass). Theme tokens only. Hidden, and a
 * persisted site-plan choice reset to the floor plan, when the scene has no
 * site plan to show.
 */
export function FloorplanDrawingTypeSwitch({ className }: { className?: string }) {
  const drawingType = useDrawingView((s) => s.drawingType)
  const setDrawingType = useDrawingView((s) => s.setDrawingType)
  const available = useSitePlanAvailable()

  useEffect(() => {
    if (!available && drawingType === 'site-plan') setDrawingType('floor-plan')
  }, [available, drawingType, setDrawingType])

  if (!available) return null

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-3 left-14 z-30 flex items-center gap-0.5 rounded-full border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur-md',
        className,
      )}
    >
      {EDITOR_DRAWING_TYPE_OPTIONS.map((option) => (
        <button
          aria-pressed={drawingType === option.id}
          className={cn(
            'rounded-full px-2.5 py-1 font-medium text-xs transition',
            drawingType === option.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={option.id}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setDrawingType(option.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
