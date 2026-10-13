'use client'

import { useHasPointAskHandler } from '@pascal-app/core'
import { canPoint, enterPointMode, leavePointMode } from '../../../lib/point-ask/session'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { usePointAsk } from '../../../store/use-point-ask'
import { isViewVisible, VIEW_3D } from '../../../store/view-layout'
import { ActionButton } from './action-button'

/**
 * Point and ask (key C): the toolbar's way into the mode where hovering names what Pascal would
 * be told about and a click opens a bubble to ask. Offered only where a host answers asks. In
 * the 2D plan and the walkthrough it is disabled and says so (v1 works in the 3D view).
 */
export function PointAskButton() {
  const available = useHasPointAskHandler()
  const active = usePointAsk((s) => s.active)
  const sceneVisible = useEditor((s) => isViewVisible(s, VIEW_3D))
  const firstPerson = useEditor((s) => s.isFirstPersonMode)
  if (!(available || active)) return null
  const unavailable = !active && (!sceneVisible || firstPerson)
  return (
    <ActionButton
      className={cn(
        'group text-muted-foreground',
        active ? 'bg-[#a99bff]/20 text-[#c9c1ff]' : 'hover:bg-[#a99bff]/15 hover:text-[#c9c1ff]',
      )}
      data-guide-target="mode-point-ask"
      disabled={unavailable}
      isActive={active}
      label="Point and ask"
      onClick={() => {
        if (active) leavePointMode()
        else if (canPoint()) enterPointMode(true)
      }}
      shortcut="C"
      size="icon"
      tooltipContent={
        unavailable ? <p>Point and ask works in the 3D view</p> : <p>Point and ask (C)</p>
      }
      variant="ghost"
    >
      <svg aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
        <path d="M4.5 3.5l8.2 3.7-3.4 1.3-1.3 3.4z" fill="currentColor" fillOpacity="0.25" />
        <path d="M12.5 12.5h6.5a2 2 0 012 2v3a2 2 0 01-2 2h-2.2l-2.3 2v-2h-2a2 2 0 01-2-2v-3a2 2 0 012-2z" />
      </svg>
    </ActionButton>
  )
}
